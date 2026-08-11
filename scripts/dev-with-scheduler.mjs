import { spawn } from "node:child_process";

const port = Number(process.env.PORT ?? 3000);
const intervalMs = Math.max(5_000, Number(process.env.DEV_SCHEDULER_INTERVAL_MS ?? 15_000));
const secret = process.env.CRON_SECRET?.trim();
const nextBin = process.platform === "win32" ? "node_modules/.bin/next.cmd" : "node_modules/.bin/next";
const app = spawn(nextBin, ["dev", "-p", String(port)], { stdio: "inherit" });

let active = false;
async function tick() {
  if (!secret || active) return;
  active = true;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/internal/workflow/automation`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    if (!response.ok)
      console.warn(`[local-scheduler] tick returned HTTP ${response.status}`);
  } catch (error) {
    console.warn(`[local-scheduler] ${error instanceof Error ? error.message : "tick failed"}`);
  } finally {
    active = false;
  }
}

const timer = secret
  ? setInterval(tick, intervalMs)
  : null;
if (secret) {
  setTimeout(tick, 3_000);
  console.log(`[local-scheduler] enabled every ${intervalMs}ms`);
} else {
  console.log("[local-scheduler] disabled because CRON_SECRET is not configured");
}

function stop(signal) {
  if (timer) clearInterval(timer);
  app.kill(signal);
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
app.on("exit", (code) => {
  if (timer) clearInterval(timer);
  process.exit(code ?? 0);
});
