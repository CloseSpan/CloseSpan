import { sanitizeIssueConversationText } from "./issue-conversation";
import type { IssueVoiceLine } from "./issue-voice";

/** Whitelist speech only. Never relay provider metadata, tools, prompts, or error bodies. */
export function mergeVoiceTranscript(existing: IssueVoiceLine[], input: unknown): IssueVoiceLine[] {
  if (!Array.isArray(input)) return existing;
  const lines = new Map(existing.map((line) => [line.id, line]));
  for (const item of input.slice(0, 150)) {
    if (!item || typeof item !== "object" || !["user", "agent"].includes(item.role)
      || typeof item.content !== "string" || typeof item.id !== "string" || item.id.length > 200) continue;
    lines.set(item.id, { id: item.id, role: item.role, content: sanitizeIssueConversationText(item.content, 1500),
      time: Number.isFinite(item.time_sec) ? item.time_sec : 0 });
  }
  return [...lines.values()].sort((a, b) => a.time - b.time).slice(-100);
}

/** A bounded, authenticated server stream keeps the Retell API key out of the browser. */
export function voiceTranscriptStream(callId: string, apiKey: string, signal: AbortSignal): ReadableStream<Uint8Array> {
  let cleanup = () => {};
  return new ReadableStream({
    start(controller) {
      let closed = false;
      let socket: WebSocket | undefined;
      let retry: ReturnType<typeof setTimeout> | undefined;
      let failures = 0;
      let lines: IssueVoiceLine[] = [];
      const encoder = new TextEncoder();
      const send = (data: unknown) => { if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(data)}\n`)); };
      const finish = (cancelled = false) => {
        if (closed) return;
        closed = true;
        clearTimeout(retry); clearTimeout(timeout); clearInterval(heartbeat);
        signal.removeEventListener("abort", abort);
        if (socket) { socket.onclose = null; socket.onerror = () => {}; socket.close(); }
        if (!cancelled) controller.close();
      };
      const abort = () => finish();
      cleanup = () => finish(true);
      const timeout = setTimeout(() => finish(), 300_000);
      const heartbeat = setInterval(() => send({ type: "heartbeat" }), 15_000);
      signal.addEventListener("abort", abort, { once: true });
      const open = () => {
        if (closed) return;
        socket = new WebSocket(`wss://api.retellai.com/v2/monitor-call/${encodeURIComponent(callId)}`, ["bearer", apiKey]);
        socket.onmessage = (event) => {
          if (closed || typeof event.data !== "string" || event.data.length > 250_000) return;
          try {
            const message = JSON.parse(event.data);
            if (message.type === "call_ended") { send({ type: "ended" }); finish(); return; }
            lines = mergeVoiceTranscript(lines, message.transcript ?? message.transcripts);
            if (lines.length) send({ type: "transcript", lines });
          } catch { /* Ignore malformed frames. */ }
        };
        socket.onerror = () => {}; // Close handles bounded retries, without exposing credentials.
        socket.onclose = (event) => {
          if (closed) return;
          // A monitor disconnect is not proof that the media call ended.
          if (event.code === 1000) { send({ type: "unavailable" }); finish(); return; }
          if ((event.code < 4000 || event.code === 4004) && failures++ < 4) {
            retry = setTimeout(open, Math.min(8000, 1000 * 2 ** failures));
          } else { send({ type: "unavailable" }); finish(); }
        };
      };
      if (signal.aborted) finish(); else open();
    },
    cancel() { cleanup(); },
  });
}
