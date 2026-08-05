import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { TenkiSandbox } from "@tenkicloud/sandbox";

const projectRoot = process.cwd();
const runnerSource = path.join(projectRoot, "services/pdd-runner/server.py");
const stateDirectory = path.join(projectRoot, ".tenki");
const statePath = path.join(stateDirectory, "pdd-runner.json");
const port = 8080;
const pddVersion = "0.0.306";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(name, fallback, maximum) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum)
    throw new Error(`${name} must be a positive integer no greater than ${maximum}`);
  return value;
}

function decoded(result) {
  return [new TextDecoder().decode(result.stdout), new TextDecoder().decode(result.stderr)]
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function run(session, command, args, timeoutMs) {
  const result = await session.exec(command, { args, timeoutMs });
  if (result.status !== "SUCCEEDED" || result.exitCode !== 0)
    throw new Error(`${command} failed: ${decoded(result).slice(-4_000)}`);
}

const tenkiApiKey = required("TENKI_API_KEY");
const sharedSecret = required("PDD_RUNNER_SHARED_SECRET");
const callbackOrigin = (
  process.env.CLOSESPAN_CALLBACK_ORIGIN
  ?? process.env.CLOSESPAN_INTERNAL_BASE_URL
  ?? ""
).trim().replace(/\/$/, "");
if (!/^https:\/\/[^/]+$/.test(callbackOrigin) && !/^http:\/\/localhost:\d+$/.test(callbackOrigin))
  throw new Error("CLOSESPAN_CALLBACK_ORIGIN or CLOSESPAN_INTERNAL_BASE_URL must be a credential-free origin");

const providerKeys = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
  "XAI_API_KEY",
].flatMap((name) => process.env[name]?.trim() ? [[name, process.env[name].trim()]] : []);
if (providerKeys.length === 0)
  throw new Error("At least one PDD-supported model provider credential is required");

const maxDurationMs = positiveInteger("TENKI_PDD_RUNNER_MAX_DURATION_MS", 7 * 24 * 60 * 60_000, 30 * 24 * 60 * 60_000);
const previewTtlMs = positiveInteger("TENKI_PDD_RUNNER_URL_TTL_MS", maxDurationMs, 30 * 24 * 60 * 60_000);
const client = new TenkiSandbox({
  authToken: tenkiApiKey,
  timeoutMs: 60_000,
  dataPlaneReadyTimeoutMs: 60_000,
});
let session;
let succeeded = false;

try {
  session = await client.createAndWait({
    name: "closespan-pdd-runner",
    allowInbound: true,
    allowOutbound: true,
    sticky: true,
    maxDurationMs,
    cpuCores: 2,
    memoryMb: 4_096,
    diskSizeGb: 10,
    tags: ["closespan", "pdd-runner", `pdd-${pddVersion}`],
    metadata: { purpose: "pdd-test-generation", pddVersion },
  });
  if (!session.inboundEnabled || !session.outboundEnabled)
    throw new Error("Tenki did not enable the networking required by the PDD runner");

  await run(session, "python3", ["-m", "venv", "/home/tenki/pdd-runner-venv"], 120_000);
  await run(
    session,
    "/home/tenki/pdd-runner-venv/bin/python",
    ["-m", "pip", "install", "--no-cache-dir", `pdd-cli==${pddVersion}`],
    15 * 60_000,
  );
  await session.writeFile("/home/tenki/pdd-runner.py", await fs.readFile(runnerSource));

  const runtimeEnvironment = Object.fromEntries([
    ["PORT", String(port)],
    ["PYTHONUNBUFFERED", "1"],
    ["PATH", "/home/tenki/pdd-runner-venv/bin:/usr/local/bin:/usr/bin:/bin"],
    ["PDD_RUNNER_SHARED_SECRET", sharedSecret],
    ["CLOSESPAN_CALLBACK_ORIGIN", callbackOrigin],
    ["PDD_MODEL", process.env.PDD_MODEL?.trim() ?? ""],
    ["PDD_RUNNER_CONCURRENCY", process.env.PDD_RUNNER_CONCURRENCY?.trim() || "2"],
    ["PDD_FORCE_LOCAL", "1"],
    ["PDD_CLOUD_RUN", "false"],
    ...providerKeys,
  ]);
  // Redirect every inherited stream before detaching. Without this, the
  // long-lived HTTP server keeps the exec RPC's stdout/stderr pipes open and
  // deployment never advances to the health check or preview-route creation.
  const launch = await session.exec("sh", {
    args: [
      "-lc",
      "nohup /home/tenki/pdd-runner-venv/bin/python /home/tenki/pdd-runner.py </dev/null >/home/tenki/pdd-runner.log 2>&1 &",
    ],
    timeoutMs: 15_000,
    env: runtimeEnvironment,
  });
  if (launch.status !== "SUCCEEDED" || launch.exitCode !== 0)
    throw new Error(`PDD runner did not start: ${decoded(launch).slice(-4_000)}`);

  let healthy = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const health = await session.exec("/home/tenki/pdd-runner-venv/bin/python", {
      args: ["-c", `import urllib.request; urllib.request.urlopen('http://127.0.0.1:${port}/health', timeout=2).read()`],
      timeoutMs: 5_000,
    });
    if (health.status === "SUCCEEDED" && health.exitCode === 0) {
      healthy = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (!healthy) throw new Error("PDD runner did not become healthy inside Tenki");

  const exposed = await session.exposePort(port, {
    ttlMs: previewTtlMs,
  });
  const state = {
    provider: "Tenki",
    sessionId: session.id,
    runnerUrl: exposed.previewUrl.replace(/\/$/, ""),
    expiresAt: exposed.expiresAt?.toISOString() ?? null,
    pddVersion,
    deployedAt: new Date().toISOString(),
  };
  await fs.mkdir(stateDirectory, { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(state, null, 2));
  console.log("Set PDD_RUNNER_URL to runnerUrl in the CloseSpan application environment.");
  succeeded = true;
} finally {
  if (!succeeded && session) await session.closeIfOpen().catch(() => undefined);
  client.close();
}

// The Tenki transport may retain keep-alive handles after close(). At this
// point every durable write and user-facing line has completed, so terminate
// the one-shot deploy process explicitly instead of leaving CI hanging.
process.exit(0);
