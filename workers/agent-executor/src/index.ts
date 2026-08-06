import { z } from "zod";

const MAX_JOB_BYTES = 1_000_000;

const criterionSchema = z.object({
  id: z.string().regex(/^AC-[1-9][0-9]*$/),
  scenarioIds: z.array(z.string().regex(/^TEST-[1-9][0-9]*$/)).max(50),
});

const scenarioSchema = z.object({
  id: z.string().regex(/^TEST-[1-9][0-9]*$/),
  testLevel: z.enum(["unit", "integration", "api", "component", "end-to-end", "manual"]),
  criterionIds: z.array(z.string().regex(/^AC-[1-9][0-9]*$/)).min(1).max(30),
});

const generatedTestSchema = z.object({
  path: z.string().min(1).max(500),
  content: z.string().min(1).max(750_000),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  command: z.string().min(1).max(500),
}).strict();

const executionProfileBaseShape = {
  language: z.string().min(1).max(80),
  framework: z.string().min(1).max(120).nullable(),
  packageManager: z.string().min(1).max(80),
  runtimeVersion: z.string().min(1).max(120).nullable(),
  workingDirectory: z.string().min(1).max(500),
  installCommands: z.array(z.string().min(1).max(1_000)).max(30),
  buildCommands: z.array(z.string().min(1).max(1_000)).max(30),
  testCommands: z.array(z.string().min(1).max(1_000)).max(30),
  typecheckCommands: z.array(z.string().min(1).max(1_000)).max(30),
  permittedPaths: z.array(z.string().min(1).max(500)).max(100),
  tenkiImage: z.string().min(1).max(500).nullable(),
  tenkiSnapshotId: z.string().min(1).max(500).nullable(),
  cpuCores: z.number().int().min(1).max(32),
  memoryMb: z.number().int().min(512).max(131_072),
  allowInbound: z.boolean(),
  allowOutbound: z.boolean(),
  maxDurationMs: z.number().int().min(60_000).max(86_400_000),
  idleTimeoutMinutes: z.number().int().min(1).max(1_440),
};

function validateExecutionProfileBootSource(
  value: { tenkiImage: string | null; tenkiSnapshotId: string | null },
  context: z.RefinementCtx,
): void {
  if (value.tenkiImage && value.tenkiSnapshotId) {
    context.addIssue({
      code: "custom",
      path: ["tenkiSnapshotId"],
      message: "Configure either a Tenki image or snapshot, not both",
    });
  }
}

const executionProfileConfigV1Schema = z.object({
  schemaVersion: z.literal(1),
  ...executionProfileBaseShape,
}).strict().superRefine(validateExecutionProfileBootSource);

const executionProfileConfigV2Schema = z.object({
  schemaVersion: z.literal(2),
  ...executionProfileBaseShape,
  automaticInstall: z.boolean(),
  automaticBuild: z.boolean(),
  publicEnvironment: z.array(z.object({
    name: z.string().regex(/^[A-Z_][A-Z0-9_]{0,127}$/),
    value: z.string().max(4_000),
  }).strict()).max(100),
  secretBindings: z.array(z.object({
    envName: z.string().regex(/^[A-Z_][A-Z0-9_]{0,127}$/),
    secretId: z.string().uuid(),
    secretVersion: z.number().int().positive(),
    exposure: z.enum(["setup", "runtime", "test"]),
  }).strict()).max(100),
  startCommand: z.string().min(1).max(1_000).nullable(),
  applicationPort: z.number().int().min(1_024).max(65_535).nullable(),
  healthCheckPath: z.string().min(1).max(500).nullable(),
  healthCheckTimeoutMs: z.number().int().min(5_000).max(600_000),
  previewEnabled: z.boolean(),
  previewTtlMs: z.number().int().min(60_000).max(900_000),
  runtimeTools: z.object({
    http: z.boolean(),
    browser: z.boolean(),
    logs: z.boolean(),
  }).strict(),
}).strict().superRefine(validateExecutionProfileBootSource);

// Zod v3 discriminatedUnion reads object shapes eagerly and cannot unwrap the
// ZodEffects produced by superRefine. A plain union preserves the boot-source
// refinements and is safe during Cloudflare's module-startup validation.
const executionProfileConfigSchema = z.union([
  executionProfileConfigV1Schema,
  executionProfileConfigV2Schema,
]);

const executionProfileSnapshotSchema = z.object({
  profileId: z.string().uuid(),
  version: z.number().int().positive(),
  source: z.enum(["detected", "confirmed", "override", "safe_generic"]),
  repository: z.string().max(300),
  workspaceRoot: z.string().min(1).max(500),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  config: executionProfileConfigSchema,
}).strict();

const commonJobFields = {
  orgId: z.string().min(1).max(200),
  runId: z.string().uuid(),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  baseSha: z.string().regex(/^[a-f0-9]{40}$/),
  promptHash: z.string().regex(/^[a-f0-9]{64}$/),
  promptContent: z.string().min(1).max(750_000),
  promptArtifactPath: z.string().regex(/^\.prompt\/tickets\/[A-Za-z0-9._-]+\.prompt\.md$/),
  repositoryArchiveUrl: z.string().url().max(4_000),
  requiredCommands: z.array(z.string().min(1).max(500)).min(1).max(30),
  permittedPaths: z.array(z.string().min(1).max(500)).min(1).max(100),
  generatedTests: z.array(generatedTestSchema).max(20).optional(),
  acceptanceCriteria: z.array(criterionSchema).min(1).max(30),
  testScenarios: z.array(scenarioSchema).min(1).max(50),
  callbackUrl: z.string().url().max(2_000),
  expiresAt: z.string().datetime(),
  capabilities: z.array(z.enum(["repository:read", "repository:write", "tests:execute", "pull_requests:write:draft"])).min(1).max(4),
};

const legacyJobSchema = z.object({
  schemaVersion: z.literal(1),
  ...commonJobFields,
}).strict();

const profiledJobSchema = z.object({
  schemaVersion: z.literal(2),
  ...commonJobFields,
  executionProfileId: z.string().uuid(),
  executionProfileHash: z.string().regex(/^[a-f0-9]{64}$/),
  executionProfileSnapshot: executionProfileSnapshotSchema,
}).strict();

const jobSchema = z.discriminatedUnion("schemaVersion", [
  legacyJobSchema,
  profiledJobSchema,
]);

type AgentJob = z.infer<typeof jobSchema>;

function profileBindingMatches(job: AgentJob): boolean {
  return job.schemaVersion === 1 || (
    job.executionProfileSnapshot.profileId === job.executionProfileId
    && job.executionProfileSnapshot.contentHash === job.executionProfileHash
  );
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
}

async function validSignature(secret: string, body: string, provided: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(provided)) return false;
  const expected = await hmac(secret, body);
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1)
    mismatch |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  return mismatch === 0;
}

async function validBearer(secret: string, provided: string): Promise<boolean> {
  const value = provided.startsWith("Bearer ") ? provided.slice(7).trim() : "";
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
  ]);
  const actualBytes = new Uint8Array(actual);
  const expectedBytes = new Uint8Array(expected);
  let mismatch = 0;
  for (let index = 0; index < expectedBytes.length; index += 1)
    mismatch |= actualBytes[index]! ^ expectedBytes[index]!;
  return mismatch === 0;
}

function executorUrl(env: Env): string {
  return env.TENKI_EXECUTOR_URL.trim().replace(/\/$/, "");
}

async function proxyJob(env: Env, job: AgentJob): Promise<void> {
  const body = JSON.stringify(job);
  const response = await fetch(executorUrl(env), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-closespan-signature": await hmac(env.AGENT_EXECUTOR_SHARED_SECRET, body),
    },
    body,
    signal: AbortSignal.timeout(13 * 60_000),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json() as { error?: unknown };
      if (typeof payload.error === "string") {
        detail = payload.error.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500);
      }
    } catch {
      // Preserve the status-only fallback for non-JSON upstream responses.
    }
    throw new Error(
      `Tenki executor rejected the queued run with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
    );
  }
}

async function healthResponse(env: Env): Promise<Response> {
  if (!env.TENKI_EXECUTOR_URL || !env.AGENT_EXECUTOR_SHARED_SECRET) {
    return Response.json({ status: "degraded", canary: "not_configured", timestamp: new Date().toISOString() }, { status: 503 });
  }
  try {
    const response = await fetch(`${executorUrl(env)}/health`, {
      headers: { "x-closespan-signature": await hmac(env.AGENT_EXECUTOR_SHARED_SECRET, "") },
      signal: AbortSignal.timeout(90_000),
    });
    return Response.json({
      status: response.ok ? "ok" : "degraded",
      canary: response.ok ? "ready" : "failed",
      timestamp: new Date().toISOString(),
    }, {
      status: response.ok ? 200 : 503,
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "executor_health_failed", error: error instanceof Error ? error.name : "unknown" }));
    return Response.json({ status: "degraded", canary: "failed", timestamp: new Date().toISOString() }, { status: 503 });
  }
}

async function queueJob(env: Env, message: Message<unknown>): Promise<void> {
  try {
    const job = jobSchema.parse(message.body);
    if (!profileBindingMatches(job)) throw new Error("Execution profile binding does not match the signed job");
    await proxyJob(env, job);
    message.ack();
  } catch (error) {
    console.error(JSON.stringify({ event: "tenki_executor_dispatch_failed", error: error instanceof Error ? error.message : "unknown" }));
    message.retry({ delaySeconds: message.attempts >= 2 ? 300 : 60 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      if (!env.STATUS_PROBE_SECRET || !await validBearer(env.STATUS_PROBE_SECRET, request.headers.get("authorization") ?? ""))
        return new Response("Not found", { status: 404 });
      return healthResponse(env);
    }
    if (request.method !== "POST" || url.pathname !== "/runs") return new Response("Not found", { status: 404 });
    if (!env.TENKI_EXECUTOR_URL || !env.AGENT_EXECUTOR_SHARED_SECRET)
      return Response.json({ error: "Tenki executor is not configured" }, { status: 503 });
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_JOB_BYTES) return Response.json({ error: "Job is too large" }, { status: 413 });
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_JOB_BYTES) return Response.json({ error: "Job is too large" }, { status: 413 });
    if (!await validSignature(env.AGENT_EXECUTOR_SHARED_SECRET, body, request.headers.get("x-closespan-signature") ?? ""))
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    let job: AgentJob;
    try {
      job = jobSchema.parse(JSON.parse(body));
    } catch {
      return Response.json({ error: "Invalid job" }, { status: 400 });
    }
    if (!profileBindingMatches(job)) return Response.json({ error: "Invalid execution profile binding" }, { status: 400 });
    if (Date.parse(job.expiresAt) <= Date.now()) return Response.json({ error: "Approval expired" }, { status: 409 });
    await env.AGENT_RUNS.send(job);
    return Response.json({ accepted: true, runId: job.runId }, { status: 202 });
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    for (const message of batch.messages) await queueJob(env, message);
  },
} satisfies ExportedHandler<Env>;
