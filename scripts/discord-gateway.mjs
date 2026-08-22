const token = process.env.DISCORD_BOT_TOKEN?.trim();
const forwardSecret = process.env.DISCORD_GATEWAY_FORWARD_SECRET?.trim();
const baseUrl = (process.env.DISCORD_GATEWAY_FORWARD_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

if (!token || !forwardSecret || !baseUrl) {
  console.error("DISCORD_BOT_TOKEN, DISCORD_GATEWAY_FORWARD_SECRET, and DISCORD_GATEWAY_FORWARD_URL are required.");
  process.exit(1);
}
if (typeof WebSocket === "undefined") {
  console.error("The Discord Gateway worker requires Node.js 22 or newer.");
  process.exit(1);
}

const INTENTS = 1 | 512 | 32768;
let socket;
let heartbeat;
let sequence = null;
let sessionId = null;
let resumeUrl = null;
let reconnectDelay = 1_000;
let stopping = false;

async function gatewayUrl() {
  const response = await fetch("https://discord.com/api/v10/gateway/bot", {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Discord gateway discovery failed with HTTP ${response.status}`);
  const payload = await response.json();
  return payload.url;
}

async function forwardMessage(data) {
  const response = await fetch(`${baseUrl}/api/integrations/discord/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${forwardSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "MESSAGE_CREATE", data }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) console.warn("CloseSpan rejected a Discord event", { status: response.status });
}

function send(payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function startHeartbeat(interval) {
  clearInterval(heartbeat);
  heartbeat = setInterval(() => send({ op: 1, d: sequence }), interval);
  setTimeout(() => send({ op: 1, d: sequence }), Math.floor(Math.random() * interval));
}

async function connect() {
  try {
    const url = resumeUrl || await gatewayUrl();
    socket = new WebSocket(`${url}?v=10&encoding=json`);
    socket.addEventListener("message", (event) => {
      const packet = JSON.parse(String(event.data));
      if (packet.s !== null && packet.s !== undefined) sequence = packet.s;
      if (packet.op === 10) {
        startHeartbeat(packet.d.heartbeat_interval);
        if (sessionId && resumeUrl) {
          send({ op: 6, d: { token, session_id: sessionId, seq: sequence } });
        } else {
          send({ op: 2, d: {
            token,
            intents: INTENTS,
            properties: { os: process.platform, browser: "CloseSpan", device: "CloseSpan" },
          } });
        }
      } else if (packet.op === 7) {
        socket.close(4000, "Gateway requested reconnect");
      } else if (packet.op === 9) {
        if (!packet.d) { sessionId = null; resumeUrl = null; sequence = null; }
        socket.close(4000, "Invalid session");
      } else if (packet.op === 0 && packet.t === "READY") {
        sessionId = packet.d.session_id;
        resumeUrl = packet.d.resume_gateway_url;
        reconnectDelay = 1_000;
        console.info("CloseSpan Discord community listener is ready", { guilds: packet.d.guilds?.length ?? 0 });
      } else if (packet.op === 0 && packet.t === "MESSAGE_CREATE") {
        void forwardMessage(packet.d).catch((error) => console.error("Discord event forwarding failed", { error }));
      }
    });
    socket.addEventListener("close", () => {
      clearInterval(heartbeat);
      if (!stopping) {
        setTimeout(() => void connect(), reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
      }
    });
    socket.addEventListener("error", (error) => console.error("Discord Gateway connection error", { error }));
  } catch (error) {
    console.error("Discord Gateway startup failed", { error });
    if (!stopping) setTimeout(() => void connect(), reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    clearInterval(heartbeat);
    socket?.close(1000, "CloseSpan worker stopping");
    process.exit(0);
  });
}

await connect();
