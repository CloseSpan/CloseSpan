import { createHash, createHmac, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  SessionExpiredError,
  SessionNotFoundError,
  TenkiSandbox,
} from "@tenkicloud/sandbox";

const projectRoot = process.cwd();
const runnerSourcePath = path.join(projectRoot, "services/pdd-runner/server.py");
const stateDirectory = path.join(projectRoot, ".tenki");
const statePath = path.join(stateDirectory, "pdd-runner.json");
const port = 8080;
const pddVersion = "0.0.309";
const runnerReleaseSchema = "4";
const runnerHealthAttempts = 90;
const managedMetadata = {
  purpose: "pdd-test-generation",
  service: "closespan-pdd-runner",
  environment: "production",
  managedBy: "closespan-pdd-rotation",
};

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

function nonNegativeInteger(name, fallback, maximum) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw new Error(`${name} must be a non-negative integer no greater than ${maximum}`);
  return value;
}

export function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function credentialFreeOrigin(value) {
  const normalized = value.trim().replace(/\/$/, "");
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("CLOSESPAN_CALLBACK_ORIGIN or CLOSESPAN_INTERNAL_BASE_URL must be a valid origin");
  }
  const local = parsed.protocol === "http:" && parsed.hostname === "localhost" && parsed.port;
  if ((!local && parsed.protocol !== "https:") || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash)
    throw new Error("CLOSESPAN_CALLBACK_ORIGIN or CLOSESPAN_INTERNAL_BASE_URL must be a credential-free origin");
  return parsed.origin;
}

function decoded(result) {
  return [new TextDecoder().decode(result.stdout), new TextDecoder().decode(result.stderr)]
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function run(session, command, args, timeoutMs, env) {
  const result = await session.exec(command, { args, timeoutMs, env });
  if (result.status !== "SUCCEEDED" || result.exitCode !== 0)
    throw new Error(`${command} failed: ${decoded(result).slice(-4_000)}`);
  return result;
}

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function assertSlug(value) {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(value))
    throw new Error("PDD_RUNNER_STABLE_SLUG must be a 3-63 character lowercase DNS label");
  return value;
}

function releaseId(source) {
  return createHash("sha256")
    .update(source)
    .update("\0")
    .update(pddVersion)
    .update("\0")
    .update(runnerReleaseSchema)
    .digest("hex");
}

async function configuration() {
  const callbackOrigin = credentialFreeOrigin(
    process.env.CLOSESPAN_CALLBACK_ORIGIN
      ?? process.env.CLOSESPAN_INTERNAL_BASE_URL
      ?? "",
  );
  const executionMode = (process.env.PDD_EXECUTION_MODE?.trim() || "cloud").toLowerCase();
  if (!["cloud", "local"].includes(executionMode))
    throw new Error("PDD_EXECUTION_MODE must be cloud or local");
  const localFallbackEnabled = enabled(process.env.PDD_CLOUD_FALLBACK_ENABLED ?? "true");
  const jwtToken = process.env.PDD_JWT_TOKEN?.trim() || null;
  const refreshToken = process.env.PDD_REFRESH_TOKEN?.trim() || null;
  if (executionMode === "cloud" && !jwtToken && !refreshToken)
    throw new Error("PDD_REFRESH_TOKEN or PDD_JWT_TOKEN is required when PDD_EXECUTION_MODE=cloud");
  const providerKeys = [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "OPENROUTER_API_KEY",
    "XAI_API_KEY",
  ].flatMap((name) => process.env[name]?.trim() ? [[name, process.env[name].trim()]] : []);
  if ((executionMode === "local" || localFallbackEnabled) && providerKeys.length === 0)
    throw new Error("A PDD-supported model provider credential is required for local mode or fallback");

  const source = await fs.readFile(runnerSourcePath);
  return {
    apiKey: required("TENKI_API_KEY"),
    sharedSecret: required("PDD_RUNNER_SHARED_SECRET"),
    callbackOrigin,
    executionMode,
    localFallbackEnabled,
    jwtToken,
    refreshToken,
    providerKeys,
    source,
    releaseId: releaseId(source),
    stableSlug: assertSlug(process.env.PDD_RUNNER_STABLE_SLUG?.trim() || "closespan-pdd-production"),
    force: enabled(process.env.PDD_RUNNER_FORCE_ROTATION),
    maxAgeDays: positiveInteger("PDD_RUNNER_ROTATION_MAX_AGE_DAYS", 21, 365),
    drainMs: nonNegativeInteger("PDD_RUNNER_DRAIN_MS", 300_000, 15 * 60_000),
    applicationOrigin: credentialFreeOrigin(
      process.env.CLOSESPAN_INTERNAL_BASE_URL ?? callbackOrigin,
    ),
    statusProbeSecret: process.env.STATUS_PROBE_SECRET?.trim() || null,
    maxDurationMs: positiveInteger(
      "TENKI_PDD_RUNNER_MAX_DURATION_MS",
      30 * 24 * 60 * 60_000,
      30 * 24 * 60 * 60_000,
    ),
  };
}

function isActive(session) {
  return !["TERMINATED", "TERMINATING"].includes(session.state);
}

function isPddRunner(session) {
  return session.tags.includes("pdd-runner")
    && session.metadata.purpose === managedMetadata.purpose
    && (!session.metadata.service || session.metadata.service === managedMetadata.service)
    && (!session.metadata.environment || session.metadata.environment === managedMetadata.environment);
}

function assertPddRunner(session) {
  if (!isPddRunner(session))
    throw new Error(`Stable PreviewUrl is bound to an unmanaged session (${session.id}); refusing rotation`);
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(statePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeState(route, session, deployedAt = session.metadata.deployedAt ?? null) {
  const state = {
    provider: "Tenki",
    routeType: "stable-preview-url",
    stableSlug: route.slug,
    previewUrlId: route.id,
    sessionId: session.id,
    runnerUrl: route.previewUrl.replace(/\/$/, ""),
    expiresAt: null,
    pddVersion,
    releaseId: session.metadata.releaseId ?? null,
    deployedAt,
    updatedAt: new Date().toISOString(),
  };
  await fs.mkdir(stateDirectory, { recursive: true });
  const temporary = `${statePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, statePath);
  return state;
}

function healthIsAttested(payload, expectedMode = process.env.PDD_EXECUTION_MODE?.trim() || "cloud") {
  return payload?.status === "ok"
    && payload.pddVersion === pddVersion
    && payload.executionMode === expectedMode
    && Array.isArray(payload.executionProfileSchemaVersions)
    && payload.executionProfileSchemaVersions.includes(1)
    && payload.executionProfileSchemaVersions.includes(2)
    && payload.executionProfileSchemaVersions.includes(3);
}

async function externalHealth(baseUrl, attempts = 60) {
  let lastError = "health check did not return an attested response";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
      const payload = response.ok ? await response.json() : null;
      if (response.ok && healthIsAttested(payload)) return payload;
      lastError = `health returned HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt + 1 < attempts) await sleep(1_000);
  }
  throw new Error(`PDD runner public health failed: ${lastError}`);
}

async function signedSecretAttestation(baseUrl, secret) {
  const body = "{}";
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/verifications`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-closespan-signature": signature,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (response.body) await response.body.cancel();
  if (response.status !== 400)
    throw new Error(`PDD runner secret attestation expected HTTP 400 and received ${response.status}`);
}

async function applicationAttestation(config) {
  if (!config.statusProbeSecret) {
    console.warn(JSON.stringify({ event: "application-attestation-skipped", reason: "STATUS_PROBE_SECRET-not-configured" }));
    return;
  }
  const response = await fetch(`${config.applicationOrigin}/api/health/components?component=pdd`, {
    headers: { authorization: `Bearer ${config.statusProbeSecret}`, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.status !== "ok" || payload?.component !== "pdd")
    throw new Error(`CloseSpan application PDD attestation failed with HTTP ${response.status}`);
}

async function internalHealth(session) {
  const result = await session.exec("/home/tenki/pdd-runner-venv/bin/python", {
    args: [
      "-c",
      `import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:${port}/health', timeout=3).read().decode())`,
    ],
    timeoutMs: 6_000,
  });
  if (result.status !== "SUCCEEDED" || result.exitCode !== 0) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(result.stdout).trim());
    return healthIsAttested(payload) ? payload : null;
  } catch {
    return null;
  }
}

async function waitForInternalHealth(session) {
  for (let attempt = 0; attempt < runnerHealthAttempts; attempt += 1) {
    const health = await internalHealth(session);
    if (health) return health;
    if (attempt + 1 < runnerHealthAttempts) await sleep(1_000);
  }
  let logTail = "startup log was unavailable";
  try {
    const log = new TextDecoder().decode(await session.readFile("/home/tenki/pdd-runner.log")).trim();
    if (log) logTail = log.slice(-4_000);
  } catch {
    // The generic message remains useful if the session cannot return its log.
  }
  throw new Error(`PDD runner did not become healthy inside Tenki: ${logTail}`);
}

async function assertCandidateCapacity(client) {
  const usage = await client.getUsage();
  const active = usage.find((item) => item.key === "active_sessions");
  if (active?.max !== undefined && active.current >= active.max)
    throw new Error(`Tenki active-session quota is full (${active.current}/${active.max}); zero-downtime rotation needs one temporary slot`);
  console.log(JSON.stringify({ event: "tenki-capacity", activeSessions: active?.current ?? null, maximum: active?.max ?? null }));
}

async function provisionRunner(client, config) {
  await assertCandidateCapacity(client);
  const deployedAt = new Date().toISOString();
  const rotationId = randomUUID();
  let session;
  try {
    session = await client.createAndWait({
      name: "closespan-pdd-runner",
      allowInbound: true,
      allowOutbound: true,
      sticky: true,
      maxDurationMs: config.maxDurationMs,
      cpuCores: 2,
      memoryMb: 4_096,
      diskSizeGb: 10,
      tags: ["closespan", "pdd-runner", `pdd-${pddVersion}`, "rotation-managed"],
      metadata: {
        ...managedMetadata,
        pddVersion,
        releaseId: config.releaseId,
        releaseSchema: runnerReleaseSchema,
        deployedAt,
        rotationId,
      },
    });
    if (!session.inboundEnabled || !session.outboundEnabled)
      throw new Error("Tenki did not enable the networking required by the PDD runner");

    console.log(JSON.stringify({ event: "candidate-created", sessionId: session.id, rotationId }));
    await run(session, "python3", ["-m", "venv", "/home/tenki/pdd-runner-venv"], 120_000);
    await run(
      session,
      "/home/tenki/pdd-runner-venv/bin/python",
      ["-m", "pip", "install", "--no-cache-dir", `pdd-cli==${pddVersion}`],
      15 * 60_000,
    );
    await session.writeFile("/home/tenki/pdd-runner.py", config.source);

    const runtimeEnvironment = Object.fromEntries([
      ["PORT", String(port)],
      ["PYTHONUNBUFFERED", "1"],
      ["PATH", "/home/tenki/pdd-runner-venv/bin:/usr/local/bin:/usr/bin:/bin"],
      ["PDD_RUNNER_SHARED_SECRET", config.sharedSecret],
      ["CLOSESPAN_CALLBACK_ORIGIN", config.callbackOrigin],
      ["PDD_MODEL", process.env.PDD_MODEL?.trim() ?? ""],
      ["PDD_RUNNER_CONCURRENCY", process.env.PDD_RUNNER_CONCURRENCY?.trim() || "2"],
      ["PDD_EXECUTION_MODE", config.executionMode],
      ["PDD_CLOUD_FALLBACK_ENABLED", String(config.localFallbackEnabled)],
      ["PDD_JWT_TOKEN", config.jwtToken ?? ""],
      ["PDD_REFRESH_TOKEN", config.refreshToken ?? ""],
      ["PDD_CLOUD_TIMEOUT", process.env.PDD_CLOUD_TIMEOUT?.trim() || "600"],
      ["PYTHON_KEYRING_BACKEND", "keyrings.alt.file.PlaintextKeyring"],
      ...config.providerKeys,
    ]);
    await run(
      session,
      "sh",
      [
        "-lc",
        "nohup /home/tenki/pdd-runner-venv/bin/python /home/tenki/pdd-runner.py </dev/null >/home/tenki/pdd-runner.log 2>&1 &",
      ],
      15_000,
      runtimeEnvironment,
    );
    await waitForInternalHealth(session);

    const canary = await session.exposePort(port, { ttlMs: 10 * 60_000 });
    try {
      await externalHealth(canary.previewUrl);
      await signedSecretAttestation(canary.previewUrl, config.sharedSecret);
    } finally {
      await session.unexposePort(port).catch(() => undefined);
    }
    console.log(JSON.stringify({ event: "candidate-attested", sessionId: session.id }));
    return session;
  } catch (error) {
    if (session) await session.closeIfOpen().catch(() => undefined);
    throw error;
  }
}

function findRoute(routes, slug) {
  const matches = routes.filter((route) => route.slug === slug);
  if (matches.length > 1)
    throw new Error(`Tenki returned multiple PreviewUrls for exact slug ${slug}; refusing ambiguous cutover`);
  return matches[0] ?? null;
}

async function safeGetSession(client, sessionId) {
  try {
    return await client.get(sessionId);
  } catch (error) {
    if (error instanceof SessionNotFoundError || error instanceof SessionExpiredError) return null;
    throw error;
  }
}

export function rotationReason({ current, release, maxAgeDays, healthy, force, now = Date.now() }) {
  if (force) return "operator-forced";
  if (!current) return "no-routed-runner";
  if (current.state !== "RUNNING") return `runner-state-${current.state.toLowerCase()}`;
  if (!healthy) return "health-check-failed";
  if (current.metadata.releaseId !== release) return "runner-release-changed";
  if (current.metadata.pddVersion !== pddVersion) return "pdd-version-changed";
  const deployedAt = Date.parse(current.metadata.deployedAt ?? "");
  if (!Number.isFinite(deployedAt)) return "runner-age-unknown";
  if (now - deployedAt >= maxAgeDays * 24 * 60 * 60_000) return "runner-max-age-reached";
  return null;
}

function chooseBootstrapSession(sessions, state) {
  const candidates = sessions.filter((session) => isActive(session) && isPddRunner(session));
  const recorded = candidates.find((session) => session.id === state?.sessionId);
  if (recorded) return recorded;
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1)
    throw new Error("Multiple active PDD runners exist and no stable route identifies the current one; refusing to guess");
  return null;
}

async function drainAndRetire(session, drainMs) {
  if (!session || !isActive(session)) return { retired: false, reason: "already-terminal" };
  if (drainMs === 0) {
    await session.closeIfOpen();
    return { retired: true, reason: "drain-disabled" };
  }

  const deadline = Date.now() + drainMs;
  let supportsCounters = false;
  while (Date.now() < deadline) {
    const health = await internalHealth(session);
    const activeJobs = health?.activeJobs;
    const queuedJobs = health?.queuedJobs;
    if (Number.isInteger(activeJobs) && Number.isInteger(queuedJobs)) {
      supportsCounters = true;
      if (activeJobs === 0 && queuedJobs === 0) {
        await session.closeIfOpen();
        return { retired: true, reason: "drained" };
      }
    }
    await sleep(Math.min(5_000, Math.max(1, deadline - Date.now())));
  }

  if (!supportsCounters) {
    await session.closeIfOpen();
    return { retired: true, reason: "legacy-fixed-drain" };
  }
  return { retired: false, reason: "jobs-still-running" };
}

async function verifyRouteBinding(client, route, sessionId, secret) {
  const refreshed = await client.previewUrls.get(route.id);
  if (refreshed.sessionId !== sessionId || refreshed.port !== port)
    throw new Error("Tenki stable PreviewUrl binding does not match the promoted runner");
  await externalHealth(refreshed.previewUrl);
  await signedSecretAttestation(refreshed.previewUrl, secret);
  return refreshed;
}

async function replaceRouteBinding(client, route, sessionId) {
  const current = await client.previewUrls.get(route.id);
  if (current.sessionId === sessionId && current.port === port) return current;
  if (current.sessionId) await client.previewUrls.unbind(route.id);
  return client.previewUrls.bind(route.id, sessionId, port);
}

async function rollback(client, route, previous) {
  if (!route) return;
  if (!previous) {
    await client.previewUrls.unbind(route.id).catch(() => undefined);
    return;
  }
  await replaceRouteBinding(client, route, previous.id);
  await externalHealth(route.previewUrl);
}

export async function rotatePddRunner(options = {}) {
  const config = await configuration();
  const force = options.force ?? config.force;
  const client = new TenkiSandbox({
    authToken: config.apiKey,
    timeoutMs: 60_000,
    dataPlaneReadyTimeoutMs: 60_000,
  });
  let candidate = null;
  try {
    const [routes, sessions, localState] = await Promise.all([
      client.previewUrls.list(),
      client.list({ tags: ["pdd-runner"] }),
      readState(),
    ]);
    let route = findRoute(routes, config.stableSlug);
    let current = route?.sessionId ? await safeGetSession(client, route.sessionId) : null;
    if (current) assertPddRunner(current);
    let bootstrapped = false;

    if (!current) {
      const bootstrap = chooseBootstrapSession(sessions, localState);
      if (bootstrap) {
        route = route
          ? await replaceRouteBinding(client, route, bootstrap.id)
          : await client.previewUrls.create(config.stableSlug, { sessionId: bootstrap.id, port });
        current = bootstrap;
        bootstrapped = true;
        route = await verifyRouteBinding(client, route, current.id, config.sharedSecret);
        await writeState(route, current, localState?.deployedAt ?? null);
        console.log(JSON.stringify({
          event: "stable-route-bootstrapped",
          stableSlug: route.slug,
          runnerUrl: route.previewUrl,
          sessionId: current.id,
        }));
        if (!force) return { action: "bootstrapped", route, session: current };
      }
    }

    let healthy = false;
    if (route && current?.state === "RUNNING") {
      try {
        await verifyRouteBinding(client, route, current.id, config.sharedSecret);
        healthy = true;
      } catch (error) {
        console.warn(JSON.stringify({
          event: "routed-runner-unhealthy",
          sessionId: current.id,
          errorType: error instanceof Error ? error.name : "UnknownError",
        }));
      }
    }
    const reason = rotationReason({
      current,
      release: config.releaseId,
      maxAgeDays: config.maxAgeDays,
      healthy,
      force,
    });
    if (!reason) {
      await writeState(route, current);
      console.log(JSON.stringify({
        event: "rotation-not-needed",
        stableSlug: route.slug,
        runnerUrl: route.previewUrl,
        sessionId: current.id,
      }));
      return { action: "unchanged", route, session: current };
    }

    console.log(JSON.stringify({ event: "rotation-started", reason, previousSessionId: current?.id ?? null }));
    candidate = await provisionRunner(client, config);
    const previous = current;
    let routeCreated = false;
    try {
      if (route) route = await replaceRouteBinding(client, route, candidate.id);
      else {
        route = await client.previewUrls.create(config.stableSlug, { sessionId: candidate.id, port });
        routeCreated = true;
      }
      route = await verifyRouteBinding(client, route, candidate.id, config.sharedSecret);
      await applicationAttestation(config);
    } catch (error) {
      await rollback(client, route, previous).catch((rollbackError) => {
        console.error(JSON.stringify({
          event: "rotation-rollback-failed",
          errorType: rollbackError instanceof Error ? rollbackError.name : "UnknownError",
        }));
      });
      if (routeCreated && !previous) await client.previewUrls.delete(route.id).catch(() => undefined);
      await candidate.closeIfOpen().catch(() => undefined);
      candidate = null;
      throw error;
    }

    const state = await writeState(route, candidate);
    console.log(JSON.stringify({
      event: "rotation-promoted",
      reason,
      stableSlug: route.slug,
      runnerUrl: route.previewUrl,
      sessionId: candidate.id,
      previousSessionId: previous?.id ?? null,
      releaseId: config.releaseId,
    }));

    const retirement = await drainAndRetire(previous, config.drainMs);
    console.log(JSON.stringify({
      event: "previous-runner-retirement",
      previousSessionId: previous?.id ?? null,
      ...retirement,
    }));
    return { action: bootstrapped ? "bootstrapped-and-rotated" : "rotated", route, session: candidate, state, retirement };
  } finally {
    client.close();
  }
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  rotatePddRunner()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
