import { Agent, applyPatchTool, run, setDefaultOpenAIKey, shellTool, type ShellAction } from "@openai/agents";
import { Editor, Shell } from "@cloudflare/sandbox/openai";
import { getSandbox, Sandbox } from "@cloudflare/sandbox";
import { z } from "zod";

export { Sandbox };

const MAX_JOB_BYTES = 1_000_000;
const MAX_ARCHIVE_BYTES = 50_000_000;
const MAX_CHANGED_BYTES = 5_000_000;
const WORKSPACE = "/workspace/repo";

const criterionSchema = z.object({
  id: z.string().regex(/^AC-[1-9][0-9]*$/),
  scenarioIds: z.array(z.string().regex(/^TEST-[1-9][0-9]*$/)).max(50),
});

const scenarioSchema = z.object({
  id: z.string().regex(/^TEST-[1-9][0-9]*$/),
  testLevel: z.enum(["unit", "integration", "api", "component", "end-to-end", "manual"]),
  criterionIds: z.array(z.string().regex(/^AC-[1-9][0-9]*$/)).min(1).max(30),
});

const jobSchema = z.object({
  schemaVersion: z.literal(1),
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
  acceptanceCriteria: z.array(criterionSchema).min(1).max(30),
  testScenarios: z.array(scenarioSchema).min(1).max(50),
  callbackUrl: z.string().url().max(2_000),
  expiresAt: z.string().datetime(),
  capabilities: z.array(z.enum(["repository:read", "repository:write", "tests:execute", "pull_requests:write:draft"])).min(1).max(4),
}).strict();

type AgentJob = z.infer<typeof jobSchema>;

const agentOutputSchema = z.object({
  summary: z.string().min(1).max(5_000),
  files: z.array(z.object({ path: z.string().min(1).max(500), reason: z.string().min(1).max(2_000) })).max(100),
  criteria: z.array(z.object({
    criterionId: z.string().regex(/^AC-[1-9][0-9]*$/),
    status: z.enum(["Passed", "Failed", "Pending manual", "Not verified"]),
    evidence: z.string().min(1).max(5_000),
    scenarioIds: z.array(z.string().regex(/^TEST-[1-9][0-9]*$/)).max(50),
  })).max(30),
  testFiles: z.array(z.string().min(1).max(500)).max(100),
  remainingRisks: z.array(z.string().min(1).max(2_000)).max(30),
  assumptions: z.array(z.string().min(1).max(2_000)).max(30),
  manualVerification: z.array(z.string().min(1).max(2_000)).max(30),
}).strict();

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
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
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

async function healthResponse(env: Env): Promise<Response> {
  if (!env.OPENAI_API_KEY || !env.AGENT_EXECUTOR_SHARED_SECRET) {
    return Response.json({ status: "degraded", canary: "not_configured", timestamp: new Date().toISOString() }, {
      status: 503,
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  }
  const sandbox = getSandbox(env.Sandbox, "status-health-canary", { sleepAfter: "1m", keepAlive: false });
  try {
    const result = await sandbox.exec("printf ready", { timeout: 15_000 });
    const healthy = result.success && result.stdout.trim() === "ready";
    return Response.json({ status: healthy ? "ok" : "degraded", canary: healthy ? "ready" : "failed", timestamp: new Date().toISOString() }, {
      status: healthy ? 200 : 503,
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "executor_health_failed", error: error instanceof Error ? error.name : "unknown" }));
    return Response.json({ status: "degraded", canary: "failed", timestamp: new Date().toISOString() }, {
      status: 503,
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  } finally {
    await Promise.race([sandbox.destroy(), new Promise<void>((resolve) => setTimeout(resolve, 30_000))]);
  }
}

function pathMatches(pattern: string, path: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("**", "\u0000").replaceAll("*", "[^/]*").replaceAll("\u0000", ".*");
  return new RegExp(`^${escaped}$`).test(path);
}

function allowedPath(job: AgentJob, path: string): boolean {
  return !path.startsWith("/")
    && !path.split("/").includes("..")
    && path !== job.promptArtifactPath
    && path !== ".prompt/README.md"
    && path !== ".prompt/template.prompt.md"
    && !path.startsWith(".github/workflows/")
    && job.permittedPaths.some((pattern) => pathMatches(pattern, path));
}

function quote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function inspectionCommand(command: string): boolean {
  if (/[;&|`$><\n\r]/.test(command)) return false;
  if (/(?:^|\s)\//.test(command) || /(?:^|\s)\S*\.\.(?:\/|\s|$)/.test(command) || /(?:^|\s)--pre(?:=|\s|$)/.test(command)) return false;
  return /^(pwd|ls(?:\s+[-A-Za-z0-9_./*]+)*|find\s+\.\s+-maxdepth\s+[1-6]\s+-type\s+[fd]|git\s+(?:status(?:\s+--short)?|diff(?:\s+--(?:stat|name-only))?|log\s+-n\s+[1-9][0-9]?|show\s+--stat)|cat\s+[A-Za-z0-9_./*-]+|sed\s+-n\s+[0-9,]+p\s+[A-Za-z0-9_./*-]+|rg(?:\s+[-A-Za-z0-9_./*:=]+){1,12})$/.test(command.trim());
}

function networkIsolatedCommand(command: string): string {
  return [
    "bwrap --unshare-net --die-with-parent",
    "--ro-bind / /",
    `--bind ${WORKSPACE} ${WORKSPACE}`,
    "--bind /tmp /tmp",
    "--setenv HOME /tmp/closespan-home",
    "--setenv npm_config_cache /tmp/npm-cache",
    `--chdir ${WORKSPACE}`,
    "/bin/sh -lc",
    quote(command),
  ].join(" ");
}

class RestrictedShell {
  readonly results: Shell["results"] = [];
  constructor(private readonly delegate: Shell, private readonly job: AgentJob) {}

  async run(action: ShellAction) {
    if (action.commands.length > 6) throw new Error("Too many commands in one shell action");
    for (const command of action.commands) {
      if (!inspectionCommand(command) && !this.job.requiredCommands.includes(command.trim()))
        throw new Error(`Command is outside the approved shell capability: ${command}`);
    }
    const bounded = { ...action, commands: action.commands.map((command) => networkIsolatedCommand(command)), timeoutMs: Math.min(action.timeoutMs ?? 120_000, 300_000), maxOutputLength: 20_000 };
    const result = await this.delegate.run(bounded);
    this.results.push(...this.delegate.results.splice(0));
    return result;
  }
}

class RestrictedEditor {
  constructor(private readonly delegate: Editor, private readonly job: AgentJob) {}
  private verify(path: string) {
    const relative = path.startsWith(`${WORKSPACE}/`) ? path.slice(WORKSPACE.length + 1) : path;
    if (!allowedPath(this.job, relative)) throw new Error(`File operation is outside the approved paths: ${relative}`);
  }
  async createFile(operation: Parameters<Editor["createFile"]>[0]) { this.verify(operation.path); return this.delegate.createFile(operation); }
  async updateFile(operation: Parameters<Editor["updateFile"]>[0]) { this.verify(operation.path); return this.delegate.updateFile(operation); }
  async deleteFile(operation: Parameters<Editor["deleteFile"]>[0]) { this.verify(operation.path); return this.delegate.deleteFile(operation); }
}

async function callback(env: Env, job: AgentJob, payload: Record<string, unknown>): Promise<void> {
  const body = JSON.stringify({ orgId: job.orgId, ...payload });
  const response = await fetch(job.callbackUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-closespan-signature": await hmac(env.AGENT_EXECUTOR_SHARED_SECRET, body) },
    body,
  });
  if (!response.ok) throw new Error(`CloseSpan callback failed with HTTP ${response.status}`);
}

async function boundedArchive(url: string): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body) throw new Error(`Repository archive download failed with HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_ARCHIVE_BYTES) throw new Error("Repository archive exceeds the 50 MB limit");
  let received = 0;
  return response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > MAX_ARCHIVE_BYTES) throw new Error("Repository archive exceeds the 50 MB limit");
      controller.enqueue(chunk);
    },
  }));
}

async function sha256(content: string): Promise<string> {
  return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content)));
}

async function collectChangedFiles(sandbox: Sandbox, job: AgentJob, reasons: Map<string, string>) {
  const intent = await sandbox.exec(`git -C ${WORKSPACE} add -N -- .`, { timeout: 30_000 });
  if (!intent.success) throw new Error(`Unable to enumerate newly created files: ${intent.stderr}`);
  const diff = await sandbox.exec(`git -C ${WORKSPACE} diff --name-status --no-renames -z HEAD`, { timeout: 30_000 });
  if (!diff.success) throw new Error(`Unable to inspect final diff: ${diff.stderr}`);
  const fields = diff.stdout.split("\0").filter(Boolean);
  const files: Array<{ path: string; contentBase64: string | null; reason: string }> = [];
  let total = 0;
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index];
    const path = fields[index + 1];
    if (!status || !path || !/^[AMD]$/.test(status)) throw new Error("Unsupported or malformed change in final diff");
    if (!allowedPath(job, path)) throw new Error(`Final diff includes prohibited path ${path}`);
    let contentBase64: string | null = null;
    if (status !== "D") {
      const fileType = await sandbox.exec(`test -f ${quote(`${WORKSPACE}/${path}`)} && test ! -L ${quote(`${WORKSPACE}/${path}`)}`);
      if (!fileType.success) throw new Error(`Only regular, non-symlink files may be published: ${path}`);
      const file = await sandbox.readFile(`${WORKSPACE}/${path}`, { encoding: "base64" });
      if (file.isBinary) throw new Error(`Binary change is prohibited: ${path}`);
      if (file.content.length > 1_500_000) throw new Error(`Changed file exceeds the per-file publication limit: ${path}`);
      total += file.size ?? Math.ceil(file.content.length * 0.75);
      if (total > MAX_CHANGED_BYTES) throw new Error("Final diff exceeds the 5 MB limit");
      contentBase64 = file.content;
    }
    files.push({ path, contentBase64, reason: reasons.get(path) ?? "Changed to satisfy the approved ticket." });
  }
  return files;
}

async function executeJob(env: Env, job: AgentJob): Promise<void> {
  const deadline = Date.now() + 15 * 60_000;
  if (Date.parse(job.expiresAt) <= Date.now()) throw new Error("Approval expired before execution began");
  if (!job.capabilities.includes("repository:read") || !job.capabilities.includes("repository:write") || !job.capabilities.includes("tests:execute"))
    throw new Error("Approval does not include the required executor capabilities");
  const sandboxId = `run-${job.runId}`;
  const sandbox = getSandbox(env.Sandbox, sandboxId, { sleepAfter: "10m", keepAlive: false });
  try {
    await callback(env, job, { event: "started", sandboxId });
    await sandbox.mkdir(WORKSPACE, { recursive: true });
    await sandbox.writeFile("/tmp/repository.tar.gz", await boundedArchive(job.repositoryArchiveUrl));
    const extract = await sandbox.exec(`tar -xzf /tmp/repository.tar.gz -C ${WORKSPACE} --strip-components=1 && rm /tmp/repository.tar.gz`, { timeout: 60_000 });
    if (!extract.success) throw new Error(`Repository extraction failed: ${extract.stderr}`);
    await sandbox.mkdir(`${WORKSPACE}/.prompt/tickets`, { recursive: true });
    await sandbox.writeFile(`${WORKSPACE}/${job.promptArtifactPath}`, job.promptContent);
    const snapshot = await sandbox.exec(`git -C ${WORKSPACE} init -q && git -C ${WORKSPACE} config user.name CloseSpan && git -C ${WORKSPACE} config user.email agent@closespan.com && git -C ${WORKSPACE} add -A && git -C ${WORKSPACE} commit -q -m approved-base`, { timeout: 60_000 });
    if (!snapshot.success) throw new Error(`Unable to create isolated base snapshot: ${snapshot.stderr}`);
    const isolation = await sandbox.exec(networkIsolatedCommand("ip route"), { timeout: 30_000 });
    if (!isolation.success || isolation.stdout.trim())
      throw new Error("Network isolation preflight failed; refusing to execute repository code");

    setDefaultOpenAIKey(env.OPENAI_API_KEY);
    const shell = new RestrictedShell(new Shell(sandbox), job);
    const editor = new RestrictedEditor(new Editor(sandbox, WORKSPACE), job);
    const agent = new Agent({
      name: "CloseSpan implementation agent",
      model: env.OPENAI_MODEL || "gpt-5.1-codex-mini",
      instructions: [
        "Implement exactly one approved CloseSpan ticket in the isolated repository.",
        `The repository root is ${WORKSPACE}. Read the approved prompt at ${job.promptArtifactPath} and obey repository instructions.`,
        "Do not change the approved prompt, workflow files, deployments, production systems, or files outside the permitted paths.",
        "Use apply_patch for all code changes. Shell access is limited to inspection and the explicitly approved validation commands.",
        "Return criterion-level evidence honestly. Manual scenarios must remain Pending manual. Do not fabricate test evidence.",
      ].join("\n"),
      tools: [
        shellTool({ shell, needsApproval: false }),
        applyPatchTool({ editor, needsApproval: false }),
      ],
      outputType: agentOutputSchema,
    });
    const agentBudget = Math.min(10 * 60_000, deadline - Date.now());
    if (agentBudget <= 0) throw new Error("Agent run exceeded the 15 minute approval duration");
    const result = await run(agent, job.promptContent, { maxTurns: 80, signal: AbortSignal.timeout(agentBudget) });
    if (!result.finalOutput) throw new Error("Coding agent did not return an implementation report");
    const agentReport = agentOutputSchema.parse(result.finalOutput);

    const prompt = await sandbox.readFile(`${WORKSPACE}/${job.promptArtifactPath}`);
    const promptArtifactHash = await sha256(prompt.content);
    if (promptArtifactHash !== job.promptHash) throw new Error("Approved prompt artifact changed during execution");

    const tests = [];
    for (const command of job.requiredCommands) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Agent run exceeded the 15 minute approval duration");
      const result = await sandbox.exec(networkIsolatedCommand(command), { timeout: Math.min(300_000, remaining) });
      tests.push({ command, status: result.success ? "passed" as const : "failed" as const, output: `${result.stdout}\n${result.stderr}`.slice(-20_000) });
    }
    const allTestsPassed = tests.every((test) => test.status === "passed");
    const reportedCriteria = new Map(agentReport.criteria.map((item) => [item.criterionId, item]));
    const criteria = job.acceptanceCriteria.map((criterion) => {
      const reported = reportedCriteria.get(criterion.id);
      const scenarios = job.testScenarios.filter((scenario) => scenario.criterionIds.includes(criterion.id));
      const automated = scenarios.some((scenario) => scenario.testLevel !== "manual");
      return {
        criterionId: criterion.id,
        status: automated && allTestsPassed && reported?.status === "Passed" ? "Passed" as const : !automated ? "Pending manual" as const : "Failed" as const,
        evidence: reported?.evidence ?? (automated ? "The coding agent did not provide criterion evidence." : "Release-level manual verification remains required."),
        scenarioIds: scenarios.map((scenario) => scenario.id),
      };
    });
    const changedFiles = await collectChangedFiles(sandbox, job, new Map(agentReport.files.map((file) => [file.path, file.reason])));
    const changedPaths = new Set(changedFiles.map((file) => file.path));
    const testFiles = [...new Set(agentReport.testFiles)].filter((path) => changedPaths.has(path));
    const successful = allTestsPassed
      && criteria.every((criterion) => criterion.status === "Passed" || criterion.status === "Pending manual")
      && (!job.testScenarios.some((scenario) => scenario.testLevel !== "manual") || testFiles.length > 0);
    await callback(env, job, {
      event: "completed",
      report: {
        schemaVersion: 1,
        runId: job.runId,
        promptHash: job.promptHash,
        promptArtifactHash,
        baseSha: job.baseSha,
        status: changedFiles.length === 0 ? "No changes" : successful ? "Tests passed" : "Failed",
        summary: agentReport.summary,
        changedFiles,
        testFiles,
        tests,
        criteria,
        remainingRisks: agentReport.remainingRisks,
        assumptions: agentReport.assumptions,
        manualVerification: agentReport.manualVerification,
        logs: shell.results.slice(-200).map((entry) => `${entry.command}\n${entry.stdout}\n${entry.stderr}`.slice(-5_000)),
      },
    });
  } finally {
    await Promise.race([sandbox.destroy(), new Promise<void>((resolve) => setTimeout(resolve, 30_000))]);
  }
}

async function queueJob(env: Env, message: Message<unknown>): Promise<void> {
  let job: AgentJob | undefined;
  try {
    job = jobSchema.parse(message.body);
    await executeJob(env, job);
    message.ack();
  } catch (error) {
    if (job) {
      try {
        await callback(env, job, { event: "failed", code: "executor_failed", message: error instanceof Error ? error.message : "Executor failed" });
      } catch (callbackError) {
        console.error("Could not report executor failure", callbackError);
      }
    }
    message.ack();
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
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_JOB_BYTES) return Response.json({ error: "Job is too large" }, { status: 413 });
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_JOB_BYTES) return Response.json({ error: "Job is too large" }, { status: 413 });
    if (!await validSignature(env.AGENT_EXECUTOR_SHARED_SECRET, body, request.headers.get("x-closespan-signature") ?? ""))
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    let job: AgentJob;
    try { job = jobSchema.parse(JSON.parse(body)); } catch { return Response.json({ error: "Invalid job" }, { status: 400 }); }
    if (Date.parse(job.expiresAt) <= Date.now()) return Response.json({ error: "Approval expired" }, { status: 409 });
    await env.AGENT_RUNS.send(job);
    return Response.json({ accepted: true, runId: job.runId }, { status: 202 });
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    for (const message of batch.messages) await queueJob(env, message);
  },
} satisfies ExportedHandler<Env>;
