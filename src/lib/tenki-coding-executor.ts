import { Buffer } from "node:buffer";
import {
  Agent,
  MaxTurnsExceededError,
  OpenAIProvider,
  Runner,
  applyDiff,
  applyPatchTool,
  tool,
  type ApplyPatchResult,
  type Editor,
  type Shell,
  type ShellAction,
  type ShellResult,
} from "@openai/agents";
import {
  TenkiSandbox,
  type ExecResult,
  type Session,
} from "@tenkicloud/sandbox";
import { z } from "zod/v3";
import { agentImplementationReportSchema, type AgentImplementationReport } from "./agent-run-verification";
import {
  assertExecutionProfileNarrowing,
  assertExecutionProfileScopeBoundary,
  hashExecutionProfileConfig,
  sanitizeExecutionProfileConfig,
  type ExecutionProfileConfig,
  type ExecutionProfileConfigV2,
  type ExecutionProfileSnapshot,
} from "./execution-profile";
import { createRuntimeSecretRedactor } from "./runtime-secret-redaction";
import {
  attestTenkiBootSource,
  type TenkiBootSourceEvidence,
} from "./tenki-boot-source-attestation";
import {
  pddGeneratedTestsReferenceLiveApplication,
  pddScenariosRequireLiveApplication,
} from "./pdd-verification";
import {
  createTenkiRuntimeEnvironment,
  type TenkiRuntimeEnvironment,
} from "./tenki-runtime-environment";
import { runTenkiHostCommand } from "./tenki-host-command";
import { TenkiLiveReplayWitness } from "./tenki-live-replay-witness";

const MAX_ARCHIVE_BYTES = 50_000_000;
const MAX_CHANGED_BYTES = 5_000_000;
const REPOSITORY_ROOT = "/home/tenki/repo";
const ARCHIVE_PATH = "/home/tenki/closespan-repository.tar.gz";
const CREATE_TIMEOUT_MS = 60_000;
// Keep the entire execution, report callback, and sandbox cleanup inside
// Vercel Hobby's five-minute function ceiling.
const RUN_DURATION_MS = 4 * 60_000;
// Reserve half of the VM lease for rebuilding, immutable PDD replay,
// independent verification, publication, callbacks, and cleanup.
const AGENT_DURATION_MS = 2 * 60_000;
const AGENT_MAX_TURNS = 24;
const PRE_EDIT_TOOL_BUDGET = 8;
const COMMAND_TIMEOUT_MS = 300_000;
const OUTPUT_LIMIT = 20_000;
const MAX_SHELL_OUTPUT_LIMIT = 30_000;

export const TENKI_RUNTIME_GIT_EXCLUDES = [
  ".closespan/",
  ".cache/",
  ".next/",
  ".turbo/",
  ".venv/",
  ".gradle/",
  ".pytest_cache/",
  ".mypy_cache/",
  ".ruff_cache/",
  "__pycache__/",
  "node_modules/",
  "coverage/",
  "dist/",
  "build/",
  "target/",
  "venv/",
  "*.log",
] as const;

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

const executionProfileSnapshotSchema = z.object({
  profileId: z.string().uuid(),
  version: z.number().int().positive(),
  source: z.enum(["detected", "confirmed", "override", "safe_generic"]),
  repository: z.string().max(300),
  workspaceRoot: z.string().min(1).max(500),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  // The app-level sanitizer below is authoritative and preserves immutable
  // v1 hashes while allowing newer versioned runtime contracts.
  config: z.unknown(),
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

const legacyTenkiAgentJobSchema = z.object({
  schemaVersion: z.literal(1),
  ...commonJobFields,
}).strict();

const profiledTenkiAgentJobSchema = z.object({
  schemaVersion: z.literal(2),
  ...commonJobFields,
  executionProfileId: z.string().uuid(),
  executionProfileHash: z.string().regex(/^[a-f0-9]{64}$/),
  executionProfileSnapshot: executionProfileSnapshotSchema,
}).strict();

export const tenkiAgentJobSchema = z.discriminatedUnion("schemaVersion", [
  legacyTenkiAgentJobSchema,
  profiledTenkiAgentJobSchema,
]);

export type TenkiAgentJob = z.infer<typeof tenkiAgentJobSchema>;

function executionProfileForJob(job: TenkiAgentJob): ExecutionProfileConfig | null {
  if (job.schemaVersion !== 2) return null;
  const snapshot = job.executionProfileSnapshot as ExecutionProfileSnapshot;
  if (snapshot.source === "detected") {
    throw new Error("An unconfirmed detected execution profile cannot run code");
  }
  const config = sanitizeExecutionProfileConfig(snapshot.config);
  if (
    (snapshot.source === "safe_generic" && snapshot.repository !== "")
    || (snapshot.source !== "safe_generic" && snapshot.repository !== job.repository)
  ) {
    throw new Error("Execution profile belongs to another repository");
  }
  assertExecutionProfileScopeBoundary(
    { repository: snapshot.repository, workspaceRoot: snapshot.workspaceRoot },
    config,
  );
  assertExecutionProfileNarrowing(config, {
    permittedPaths: job.permittedPaths,
    requiredCommands: job.requiredCommands,
  });
  const contentHash = hashExecutionProfileConfig(config);
  if (
    snapshot.profileId !== job.executionProfileId
    || snapshot.contentHash !== job.executionProfileHash
    || contentHash !== job.executionProfileHash
  ) {
    throw new Error("Execution profile binding does not match its immutable content hash");
  }
  return config;
}

export function assertTenkiExecutionProfileBinding(
  job: TenkiAgentJob,
): asserts job is Extract<TenkiAgentJob, { schemaVersion: 2 }> {
  if (job.schemaVersion !== 2) {
    throw new Error("New executor jobs require an immutable execution profile binding");
  }
  executionProfileForJob(job);
}

function workingDirectory(job: TenkiAgentJob): string {
  const configured = executionProfileForJob(job)?.workingDirectory ?? ".";
  return configured === "." ? REPOSITORY_ROOT : `${REPOSITORY_ROOT}/${configured}`;
}

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

type AgentOutput = z.infer<typeof agentOutputSchema>;

export function boundedAgentProgressOutput(
  job: TenkiAgentJob,
  changedPaths: readonly string[],
  provider: ExecutorAiConfiguration["provider"],
  model: string,
  toolCalls: number,
): AgentOutput | null {
  const implementationPaths = [...new Set(changedPaths)]
    .filter((path) => tenkiExecutorAllowsPath(job, path));
  if (implementationPaths.length === 0) return null;
  return agentOutputSchema.parse({
    summary: `The ${provider} coding agent (${model}) changed ${implementationPaths.length} approved implementation path(s) before its bounded tool loop ended; CloseSpan continued only to sealed validation.`,
    files: implementationPaths.map((path) => ({
      path,
      reason: "Changed by the coding agent before the bounded model loop ended.",
    })),
    criteria: job.acceptanceCriteria.map((criterion) => ({
      criterionId: criterion.id,
      status: "Passed" as const,
      evidence: "Provisional agent progress; CloseSpan accepts this criterion only if every bound validation command passes afterward.",
      scenarioIds: job.testScenarios
        .filter((scenario) => scenario.criterionIds.includes(criterion.id))
        .map((scenario) => scenario.id),
    })),
    testFiles: implementationPaths.filter(
      (path) => /(^|\/)(?:test|tests|__tests__)(\/|$)|\.(?:test|spec)\.[^.]+$/.test(path),
    ),
    remainingRisks: [
      `The coding-model loop reached its bounded limit after ${toolCalls} tool call(s); all approved commands and independent verification remain mandatory.`,
    ],
    assumptions: [],
    manualVerification: job.testScenarios
      .filter((scenario) => scenario.testLevel === "manual")
      .map((scenario) => `Complete ${scenario.id} after release.`),
  });
}

export interface TenkiCodingExecutorEvents {
  started(sessionId: string): Promise<void>;
}

export interface TenkiResolvedRuntimeEnvironment {
  setup: Readonly<Record<string, string>>;
  runtime: Readonly<Record<string, string>>;
  test: Readonly<Record<string, string>>;
  redactionValues: readonly string[];
}

export function runtimeToolsForAgent(
  configuredTools: ExecutionProfileConfigV2["runtimeTools"],
  runtimeHealthy: boolean,
): ExecutionProfileConfigV2["runtimeTools"] {
  if (runtimeHealthy) return configuredTools;
  return {
    http: false,
    browser: false,
    logs: configuredTools.logs,
  };
}

interface ExecutorDependencies {
  apiKey?: string;
  openAiApiKey?: string;
  aiBaseUrl?: string;
  aiModel?: string;
  runtimeEnvironment?: TenkiResolvedRuntimeEnvironment;
  createClient?: (apiKey: string) => TenkiSandbox;
  runAgent?: (input: {
    job: TenkiAgentJob;
    shell: RestrictedShell;
    editor: RestrictedEditor;
    runtime?: TenkiRuntimeEnvironment;
    runtimeHealthy?: boolean;
    runtimeTools?: ExecutionProfileConfigV2["runtimeTools"];
    restartAllowed?: boolean;
    runtimeInteractions: NonNullable<AgentImplementationReport["runtimeEvidence"]>["interactions"];
    signal: AbortSignal;
    ai: ExecutorAiConfiguration;
  }) => Promise<AgentOutput>;
}

interface ExecutorAiConfiguration {
  apiKey: string;
  baseUrl?: string;
  model: string;
  provider: "OpenAI" | "xAI";
}

export function executorImplementationModelSettings(
  provider: ExecutorAiConfiguration["provider"],
) {
  return {
    toolChoice: "required" as const,
    parallelToolCalls: false,
    store: false,
    ...(provider === "OpenAI" ? {
      // Coding runs are bounded by both the Tenki lease and Vercel's function
      // ceiling. Explicit medium reasoning plus terse responses keeps the
      // agent useful without allowing an implicit high-effort model default to
      // consume the entire approval window before it can use a repository tool.
      reasoning: { effort: "medium" as const },
      text: { verbosity: "low" as const },
      maxTokens: 12_000,
    } : {}),
  };
}

function optionalHttpsBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const url = new URL(trimmed);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("The coding-agent AI base URL must be a credential-free HTTPS origin or path");
  return url.toString().replace(/\/$/, "");
}

export function resolveExecutorAiConfiguration(
  dependencies: Pick<ExecutorDependencies, "openAiApiKey" | "aiBaseUrl" | "aiModel"> = {},
): ExecutorAiConfiguration {
  const openAiApiKey = dependencies.openAiApiKey ?? process.env.OPENAI_API_KEY?.trim();
  if (openAiApiKey) {
    return {
      apiKey: openAiApiKey,
      baseUrl: optionalHttpsBaseUrl(dependencies.aiBaseUrl ?? process.env.OPENAI_BASE_URL),
      model: dependencies.aiModel?.trim()
        || process.env.AGENT_EXECUTOR_MODEL?.trim()
        || process.env.OPENAI_MODEL?.trim()
        || "gpt-5.6-terra",
      provider: "OpenAI",
    };
  }
  const xaiApiKey = process.env.XAI_API_KEY?.trim();
  if (!xaiApiKey) throw new Error("OPENAI_API_KEY or XAI_API_KEY is required for the coding agent");
  const model = dependencies.aiModel?.trim() || process.env.XAI_MODEL?.trim();
  if (!model) throw new Error("XAI_MODEL is required when the coding agent uses xAI");
  return {
    apiKey: xaiApiKey,
    baseUrl: optionalHttpsBaseUrl(dependencies.aiBaseUrl ?? process.env.XAI_BASE_URL) ?? "https://api.x.ai/v1",
    model,
    provider: "xAI",
  };
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function succeeded(result: ExecResult): boolean {
  return result.status === "SUCCEEDED" && result.exitCode === 0;
}

function combinedOutput(result: ExecResult, limit = OUTPUT_LIMIT): string {
  return [decode(result.stdout).trim(), decode(result.stderr).trim()]
    .filter(Boolean)
    .join("\n")
    .slice(-limit);
}

function pathMatches(pattern: string, path: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*");
  return new RegExp(`^${escaped}$`).test(path);
}

export function tenkiExecutorAllowsPath(job: Pick<TenkiAgentJob, "permittedPaths" | "promptArtifactPath" | "generatedTests">, path: string): boolean {
  return !path.startsWith("/")
    && !path.split("/").includes("..")
    && path !== job.promptArtifactPath
    && path !== ".prompt/README.md"
    && path !== ".prompt/template.prompt.md"
    && !path.startsWith(".github/workflows/")
    && !(job.generatedTests ?? []).some((test) => test.path === path)
    && job.permittedPaths.some((pattern) => pathMatches(pattern, path));
}

function tenkiExecutorAllowsPublishedPath(job: TenkiAgentJob, path: string): boolean {
  return (job.generatedTests ?? []).some((test) => test.path === path)
    || tenkiExecutorAllowsPath(job, path);
}

export function tenkiExecutorAllowsInspectionCommand(command: string): boolean {
  if (/[;&|`$><\n\r]/.test(command)) return false;
  if (/(?:^|\s)\//.test(command) || /(?:^|\s)\S*\.\.(?:\/|\s|$)/.test(command) || /(?:^|\s)--pre(?:=|\s|$)/.test(command)) return false;
  return /^(pwd|ls(?:\s+[-A-Za-z0-9_./*]+)*|find\s+\.\s+(?:(?:-maxdepth\s+[1-6]\s+)?-type\s+[fd]|(?:-maxdepth\s+[1-6]\s+)?-name\s+AGENTS\.md\s+-print)|git\s+(?:status(?:\s+--short)?|diff(?:\s+--(?:stat|name-only|check))?|log\s+-n\s+[1-9][0-9]?|show\s+--stat)|cat\s+[A-Za-z0-9_./*-]+|sed\s+-n\s+[0-9,]+p\s+[A-Za-z0-9_./*-]+|rg(?:\s+[-A-Za-z0-9_./*:=]+){1,12})$/.test(command.trim());
}

interface CommandLog {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

type CreateFileOperation = { type: "create_file"; path: string; diff: string };
type UpdateFileOperation = { type: "update_file"; path: string; diff: string };
type DeleteFileOperation = { type: "delete_file"; path: string };

export class RestrictedShell implements Shell {
  readonly results: CommandLog[] = [];
  private readonly redactor: ReturnType<typeof createRuntimeSecretRedactor>;

  constructor(
    private readonly session: Session,
    private readonly job: TenkiAgentJob,
    private readonly options: {
      testEnvironment?: Readonly<Record<string, string>>;
      redactionValues?: readonly string[];
    } = {},
  ) {
    this.redactor = createRuntimeSecretRedactor(options.redactionValues ?? []);
  }

  async run(action: ShellAction): Promise<ShellResult> {
    if (action.commands.length > 6) throw new Error("Too many commands in one shell action");
    const outputLimit = action.maxOutputLength ?? OUTPUT_LIMIT;
    if (!Number.isInteger(outputLimit) || outputLimit < 0 || outputLimit > MAX_SHELL_OUTPUT_LIMIT)
      throw new Error(`Shell output limit must be between 0 and ${MAX_SHELL_OUTPUT_LIMIT}`);
    for (const command of action.commands) {
      if (!tenkiExecutorAllowsInspectionCommand(command) && !this.job.requiredCommands.includes(command.trim()))
        throw new Error(`Command is outside the approved shell capability: ${command}`);
    }
    const output: ShellResult["output"] = [];
    for (const command of action.commands) {
      try {
        const approvedValidation = this.job.requiredCommands.includes(command.trim());
        const result = await runTenkiHostCommand(this.session, ["bash", "-c", command], {
          cwd: workingDirectory(this.job),
          timeoutMs: Math.min(action.timeoutMs ?? 120_000, COMMAND_TIMEOUT_MS),
          env: approvedValidation
            ? { CI: "true", ...(this.options.testEnvironment ?? {}) }
            : { CI: "true" },
        });
        const stdout = outputLimit === 0
          ? ""
          : this.redactor.redact(decode(result.stdout)).slice(-outputLimit);
        const stderr = outputLimit === 0
          ? ""
          : this.redactor.redact(decode(result.stderr)).slice(-outputLimit);
        this.results.push({ command, stdout, stderr, exitCode: result.exitCode });
        output.push({
          command,
          stdout,
          stderr,
          outcome: result.timedOut ? { type: "timeout" } : { type: "exit", exitCode: result.exitCode },
        });
        if (result.timedOut) break;
      } catch (error) {
        const stderr = this.redactor.redact(
          error instanceof Error ? error.message : "Tenki command failed",
        );
        this.results.push({ command, stdout: "", stderr, exitCode: 1 });
        output.push({ command, stdout: "", stderr, outcome: { type: "exit", exitCode: 1 } });
      }
    }
    return { output, maxOutputLength: outputLimit, providerData: { provider: "Tenki Sandbox", working_directory: workingDirectory(this.job) } };
  }

  async changedPaths(): Promise<string[]> {
    await requireCommand(this.session, "git", { args: ["add", "-N", "--", "."], cwd: REPOSITORY_ROOT, timeoutMs: 30_000 }, "Unable to enumerate agent changes");
    const result = await requireCommand(this.session, "git", { args: ["diff", "--name-only", "--no-renames", "HEAD"], cwd: REPOSITORY_ROOT, timeoutMs: 30_000 }, "Unable to inspect agent changes");
    return decode(result.stdout).split("\n").map((path) => path.trim()).filter(Boolean);
  }
}

export class RestrictedEditor implements Editor {
  private mutationCount = 0;

  constructor(private readonly session: Session, private readonly job: TenkiAgentJob) {}

  get approvedMutationCount(): number {
    return this.mutationCount;
  }

  private resolve(path: string): string {
    const supplied = path.startsWith(`${REPOSITORY_ROOT}/`) ? path.slice(REPOSITORY_ROOT.length + 1) : path;
    const relative = supplied.replace(/^\.\//, "");
    const profileDirectory = executionProfileForJob(this.job)?.workingDirectory ?? ".";
    const repositoryPath = tenkiExecutorAllowsPath(this.job, relative)
      ? relative
      : profileDirectory !== "." && tenkiExecutorAllowsPath(this.job, `${profileDirectory}/${relative}`)
        ? `${profileDirectory}/${relative}`
        : null;
    if (!repositoryPath) throw new Error(`File operation is outside the approved paths: ${relative}`);
    return `${REPOSITORY_ROOT}/${repositoryPath}`;
  }

  private async prepareParent(target: string): Promise<void> {
    const directory = target.slice(0, target.lastIndexOf("/")) || REPOSITORY_ROOT;
    const result = await this.session.exec("mkdir", { args: ["-p", "--", directory], timeoutMs: 10_000 });
    if (!succeeded(result)) throw new Error(`Could not prepare ${directory}`);
  }

  async createFile(operation: CreateFileOperation): Promise<ApplyPatchResult> {
    const target = this.resolve(operation.path);
    await this.prepareParent(target);
    await this.session.writeFile(target, applyDiff("", operation.diff, "create"));
    this.mutationCount += 1;
    return { status: "completed", output: `Created ${operation.path}` };
  }

  async updateFile(operation: UpdateFileOperation): Promise<ApplyPatchResult> {
    const target = this.resolve(operation.path);
    const original = decode(await this.session.readFile(target));
    const updated = applyDiff(original, operation.diff);
    if (updated === original) {
      return { status: "completed", output: `No change required for ${operation.path}` };
    }
    await this.session.writeFile(target, updated);
    this.mutationCount += 1;
    return { status: "completed", output: `Updated ${operation.path}` };
  }

  async deleteFile(operation: DeleteFileOperation): Promise<ApplyPatchResult> {
    const target = this.resolve(operation.path);
    await this.session.remove(target);
    this.mutationCount += 1;
    return { status: "completed", output: `Deleted ${operation.path}` };
  }

  async writeApprovedTextFile(path: string, content: string): Promise<string> {
    const bytes = new TextEncoder().encode(content);
    if (bytes.byteLength > 1_000_000) throw new Error(`File content exceeds the editor limit: ${path}`);
    const target = this.resolve(path);
    await this.prepareParent(target);
    try {
      const existing = await this.session.readFile(target);
      if (Buffer.from(existing).equals(Buffer.from(bytes))) return `No change required for ${path}`;
    } catch {
      // A missing approved file is expected when the agent creates new source.
    }
    await this.session.writeFile(target, bytes);
    this.mutationCount += 1;
    return `Wrote ${path}`;
  }

  async deleteApprovedFile(path: string): Promise<string> {
    const target = this.resolve(path);
    await this.session.remove(target);
    this.mutationCount += 1;
    return `Deleted ${path}`;
  }
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

async function requireCommand(
  session: Session,
  command: string,
  options: Parameters<Session["exec"]>[1],
  failureMessage: string,
): Promise<ExecResult> {
  const result = await session.exec(command, options);
  if (!succeeded(result)) throw new Error(`${failureMessage}: ${combinedOutput(result)}`);
  return result;
}

async function sha256(content: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function assertRuntimeSecretPublicationSafe(
  path: string,
  content: string | null,
  runtimeRedactor: ReturnType<typeof createRuntimeSecretRedactor>,
): void {
  if (runtimeRedactor.contains(path)) {
    throw new Error("Final diff includes a path derived from a resolved runtime secret");
  }
  if (content !== null && runtimeRedactor.contains(content)) {
    throw new Error(`Final diff includes a resolved runtime secret or encoded secret in ${path}`);
  }
}

async function collectChangedFiles(
  session: Session,
  job: TenkiAgentJob,
  reasons: Map<string, string>,
  runtimeRedactor: ReturnType<typeof createRuntimeSecretRedactor>,
) {
  await requireCommand(session, "git", { args: ["add", "-N", "--", "."], cwd: REPOSITORY_ROOT, timeoutMs: 30_000 }, "Unable to enumerate newly created files");
  const diff = await requireCommand(session, "git", { args: ["diff", "--name-status", "--no-renames", "-z", "HEAD"], cwd: REPOSITORY_ROOT, timeoutMs: 30_000 }, "Unable to inspect the final diff");
  const fields = decode(diff.stdout).split("\0").filter(Boolean);
  const files: AgentImplementationReport["changedFiles"] = [];
  let total = 0;
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index];
    const path = fields[index + 1];
    if (!status || !path || !/^[AMD]$/.test(status)) throw new Error("Unsupported or malformed change in final diff");
    assertRuntimeSecretPublicationSafe(path, null, runtimeRedactor);
    if (!tenkiExecutorAllowsPublishedPath(job, path)) throw new Error(`Final diff includes prohibited path ${path}`);
    let contentBase64: string | null = null;
    if (status !== "D") {
      const target = `${REPOSITORY_ROOT}/${path}`;
      const info = await session.stat(target);
      if (info.isDir || info.isSymlink) throw new Error(`Only regular, non-symlink files may be published: ${path}`);
      const file = await session.readFile(target);
      if (file.includes(0)) throw new Error(`Binary change is prohibited: ${path}`);
      const text = new TextDecoder().decode(file);
      assertRuntimeSecretPublicationSafe(path, text, runtimeRedactor);
      contentBase64 = Buffer.from(file).toString("base64");
      if (contentBase64.length > 1_500_000) throw new Error(`Changed file exceeds the per-file publication limit: ${path}`);
      total += file.byteLength;
      if (total > MAX_CHANGED_BYTES) throw new Error("Final diff exceeds the 5 MB limit");
    }
    files.push({ path, contentBase64, reason: reasons.get(path) ?? "Changed to satisfy the approved ticket." });
  }
  return files;
}

async function defaultRunAgent(input: {
  job: TenkiAgentJob;
  shell: RestrictedShell;
  editor: RestrictedEditor;
  runtime?: TenkiRuntimeEnvironment;
  runtimeHealthy?: boolean;
  runtimeTools?: ExecutionProfileConfigV2["runtimeTools"];
  restartAllowed?: boolean;
  runtimeInteractions: NonNullable<AgentImplementationReport["runtimeEvidence"]>["interactions"];
  signal: AbortSignal;
  ai: ExecutorAiConfiguration;
}): Promise<AgentOutput> {
  const modelProvider = new OpenAIProvider({
    apiKey: input.ai.apiKey,
    baseURL: input.ai.baseUrl,
    useResponses: input.ai.provider === "OpenAI",
  });
  const runner = new Runner({
    modelProvider,
    tracingDisabled: true,
    traceIncludeSensitiveData: false,
    workflowName: "CloseSpan approval-bound implementation",
  });
  let toolCalls = 0;
  const toolNames: string[] = [];
  const progressController = new AbortController();
  let preEditBudgetExceeded = false;
  runner.on("agent_tool_start", (_context, _agent, selectedTool) => {
    toolCalls += 1;
    toolNames.push(selectedTool.name);
    if (toolNames.length > AGENT_MAX_TURNS) toolNames.shift();
  });
  runner.on("agent_tool_end", () => {
    if (
      toolCalls >= PRE_EDIT_TOOL_BUDGET
      && input.editor.approvedMutationCount === 0
      && !progressController.signal.aborted
    ) {
      preEditBudgetExceeded = true;
      progressController.abort();
    }
  });
  const agentSignal = AbortSignal.any([input.signal, progressController.signal]);
  const recoverBoundedProgress = async (error: unknown): Promise<AgentOutput> => {
    const bounded = input.signal.aborted
      || progressController.signal.aborted
      || error instanceof MaxTurnsExceededError
      || (error instanceof Error && error.message === "Request was aborted.");
    if (!bounded) throw error;
    const changedPaths = await input.shell.changedPaths();
    const recovered = boundedAgentProgressOutput(
      input.job,
      changedPaths,
      input.ai.provider,
      input.ai.model,
      toolCalls,
    );
    if (recovered) return recovered;
    const recentTools = toolNames.slice(-8).join(",") || "none";
    const recentCommands = input.shell.results
      .slice(-5)
      .map((entry) => entry.command.replace(/\s+/g, " ").slice(0, 120))
      .join(" | ") || "none";
    if (preEditBudgetExceeded) {
      throw new Error(
        `Coding agent reached the ${PRE_EDIT_TOOL_BUDGET}-call pre-edit budget without changing an approved implementation path; recent tools: ${recentTools}; recent commands: ${recentCommands}`,
        { cause: error },
      );
    }
    throw new Error(
      `Coding agent exhausted its bounded tool loop after ${toolCalls} tool call(s) without changing an approved implementation path; recent tools: ${recentTools}; recent commands: ${recentCommands}`,
      { cause: error },
    );
  };
  const instructions = [
    "Implement exactly one approved CloseSpan ticket in the isolated Tenki microVM.",
    `The repository root is ${REPOSITORY_ROOT}; run commands from ${workingDirectory(input.job)}. Read the approved prompt at ${input.job.promptArtifactPath} and obey repository instructions.`,
    "When editing, use repository-relative paths even when commands run from a nested workspace directory.",
    "Do not change the approved prompt, workflow files, deployments, production systems, or files outside the permitted paths.",
    input.ai.provider === "OpenAI"
      ? "Use apply_patch or the approved text-file tools for code changes. Command access is limited to inspection and explicitly approved validation commands."
      : "Use the approved text-file tools for code changes. Command access is limited to inspection and explicitly approved validation commands.",
    "Pass each inspection or validation command as a separate commands-array item. Shell operators, cd, absolute paths, parent traversal, and compound commands are prohibited; the executor already sets the approved working directory.",
    "Use no more than six read-only inspection calls before making the first approved source change. If the ticket is small and the target is clear, edit immediately, then validate.",
    "Do not stop after describing your plan. Inspect the repository, make the approved code and test changes, and run the approved validation commands before finishing.",
    input.runtime
      ? input.restartAllowed === false
        ? "A baseline application is available for read-only inspection. Resolved runtime secrets are never re-injected into agent-modified code; CloseSpan will restart and verify the sealed implementation after the publication payload is captured."
        : input.runtimeHealthy === false
        ? "The configured baseline application did not become healthy. HTTP and browser tools are intentionally unavailable; use only the provided logs and restart recovery tools until the code is fixed, then rely on the approved validation commands."
        : input.runtimeTools?.http || input.runtimeTools?.browser
          ? "A healthy running application is configured in the same VM. Use the provided runtime tools to inspect behavior, logs, and approved localhost endpoints."
          : "A healthy running application is configured, but this profile permits only its provided recovery or log tools. Rely on the approved validation commands for other evidence."
      : "No running application is configured for this execution profile; rely on the approved repository and validation commands.",
    "Return criterion-level evidence honestly. Manual scenarios must remain Pending manual. Do not fabricate test evidence.",
  ].join("\n");

  const recordRuntimeInteraction = (
    toolName: "http" | "browser" | "logs" | "restart",
    target: string,
    status: string,
    evidence: string,
  ) => {
    input.runtimeInteractions.push({
      stage: "implementation",
      tool: toolName,
      target: target.slice(0, 1_000),
      status: status.slice(0, 200),
      evidence: evidence.slice(0, 5_000),
    });
  };
  const liveTools: ReturnType<typeof tool>[] = [];
  if (input.runtime && input.runtimeTools?.http) {
    liveTools.push(tool({
      name: "request_running_application",
      description: "Make a bounded HTTP request to the configured application on its fixed localhost port. Paths cannot target another host.",
      parameters: z.object({
        method: z.enum(["GET", "HEAD", "OPTIONS"]),
        path: z.string().min(1).max(2_000),
      }).strict(),
      execute: async ({ method, path }) => {
        try {
          const response = await input.runtime!.request({ method, path });
          recordRuntimeInteraction("http", `${method} ${path}`, `HTTP ${response.statusCode}`, response.body);
          return JSON.stringify(response);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Runtime HTTP request failed";
          recordRuntimeInteraction("http", `${method} ${path}`, "failed", message);
          throw error;
        }
      },
    }));
  }
  if (input.runtime && input.runtimeTools?.browser) {
    liveTools.push(tool({
      name: "inspect_running_page",
      description: "Open the running application in a real headless Playwright browser for read-only inspection and return a bounded DOM snapshot plus the short-lived preview URL.",
      parameters: z.object({
        path: z.string().min(1).max(2_000).default("/"),
      }).strict(),
      execute: async ({ path }) => {
        try {
          const [status, page] = await Promise.all([
            input.runtime!.status(),
            input.runtime!.browser({ path, actions: [] }),
          ]);
          const result = { previewUrl: status.previewUrl ?? null, ...page };
          recordRuntimeInteraction("browser", path, "browser interaction passed", `${status.previewUrl ?? "localhost-only"}\n${page.title}\n${page.text}`);
          return JSON.stringify(result);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Runtime page inspection failed";
          recordRuntimeInteraction("browser", path, "failed", message);
          throw error;
        }
      },
    }));
  }
  if (input.runtime && input.runtimeTools?.logs) {
    liveTools.push(tool({
      name: "read_running_application_logs",
      description: "Read the bounded, secret-redacted tail of the running application's logs.",
      parameters: z.object({ maxBytes: z.number().int().min(1_000).max(128_000).default(20_000) }).strict(),
      execute: async ({ maxBytes }) => {
        const logs = input.runtime!.logs(maxBytes);
        recordRuntimeInteraction("logs", "application log tail", "read", logs);
        return logs || "The running application has not emitted logs.";
      },
    }));
  }
  if (input.runtime && input.restartAllowed !== false) {
    liveTools.push(tool({
      name: "restart_running_application",
      description: "Restart the configured application after code changes and optionally rerun approved build commands without trusted bootstrap secrets.",
      parameters: z.object({
        runBuild: z.boolean().default(true),
      }).strict(),
      execute: async ({ runBuild }) => {
        try {
          const status = await input.runtime!.restart({ runInstall: false, runBuild });
          recordRuntimeInteraction("restart", "running application", status.healthy ? "healthy" : status.state, JSON.stringify(status));
          return JSON.stringify(status);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Runtime restart failed";
          recordRuntimeInteraction("restart", "running application", "failed", message);
          throw error;
        }
      },
    }));
  }

  const approvedCommandTool = tool({
    name: "run_approved_commands",
    description: "Run repository inspection commands or exact approved validation commands in the isolated workspace. Put each command in a separate array item; never use shell operators or cd.",
    parameters: z.object({ commands: z.array(z.string().min(1).max(500)).min(1).max(6) }).strict(),
    execute: async ({ commands }) => JSON.stringify(await input.shell.run({ commands })),
  });
  const approvedWriteTool = tool({
    name: "write_approved_text_file",
    description: "Create or completely replace one UTF-8 text file inside the ticket's approved paths.",
    parameters: z.object({ path: z.string().min(1).max(500), content: z.string().max(500_000) }).strict(),
    execute: async ({ path, content }) => input.editor.writeApprovedTextFile(path, content),
  });
  const approvedDeleteTool = tool({
    name: "delete_approved_file",
    description: "Delete one file inside the ticket's approved paths.",
    parameters: z.object({ path: z.string().min(1).max(500) }).strict(),
    execute: async ({ path }) => input.editor.deleteApprovedFile(path),
  });

  if (input.ai.provider === "xAI") {
    const compatibleTools = [
      approvedCommandTool,
      approvedWriteTool,
      approvedDeleteTool,
      ...liveTools,
    ];
    const implementationAgent = new Agent({
      name: "CloseSpan implementation agent",
      model: input.ai.model,
      instructions,
      tools: compatibleTools,
      modelSettings: executorImplementationModelSettings(input.ai.provider),
      resetToolChoice: true,
    });
    let changedPaths: string[] = [];
    try {
      for (let attempt = 0; attempt < 4 && changedPaths.length === 0; attempt += 1) {
        const feedback = attempt === 0
          ? input.job.promptContent
          : `${input.job.promptContent}\n\nExecutor feedback: no repository files have changed yet. Continue now by using the approved write tool to implement the ticket and its automated test.`;
        await runner.run(implementationAgent, feedback, { maxTurns: AGENT_MAX_TURNS, signal: agentSignal });
        changedPaths = (await input.shell.changedPaths())
          .filter((path) => tenkiExecutorAllowsPath(input.job, path));
      }
    } catch (error) {
      return recoverBoundedProgress(error);
    }
    return {
      summary: changedPaths.length
        ? `Implemented the approved ticket with ${input.ai.provider} in an isolated Tenki session.`
        : "The coding agent completed without changing an approved repository file.",
      files: changedPaths.map((path) => ({ path, reason: "Changed to satisfy the approved ticket." })),
      criteria: input.job.acceptanceCriteria.map((criterion) => ({
        criterionId: criterion.id,
        status: "Passed" as const,
        evidence: "The executor will accept this criterion only if every approved validation command passes independently.",
        scenarioIds: input.job.testScenarios.filter((scenario) => scenario.criterionIds.includes(criterion.id)).map((scenario) => scenario.id),
      })),
      testFiles: changedPaths.filter((path) => /(^|\/)(?:test|tests|__tests__)(\/|$)|\.(?:test|spec)\.[^.]+$/.test(path)),
      remainingRisks: [],
      assumptions: [],
      manualVerification: input.job.testScenarios.filter((scenario) => scenario.testLevel === "manual").map((scenario) => `Complete ${scenario.id} after release.`),
    };
  }

  const agent = new Agent({
    name: "CloseSpan implementation agent",
    model: input.ai.model,
    instructions,
    tools: [
      approvedCommandTool,
      applyPatchTool({ editor: input.editor, needsApproval: false }),
      approvedWriteTool,
      approvedDeleteTool,
      ...liveTools,
    ],
    outputType: agentOutputSchema,
    modelSettings: executorImplementationModelSettings(input.ai.provider),
    resetToolChoice: true,
  });
  try {
    const result = await runner.run(agent, input.job.promptContent, {
      maxTurns: AGENT_MAX_TURNS,
      signal: agentSignal,
    });
    if (!result.finalOutput) throw new Error("Coding agent did not return an implementation report");
    const implementationPaths = (await input.shell.changedPaths())
      .filter((path) => tenkiExecutorAllowsPath(input.job, path));
    if (implementationPaths.length === 0) {
      throw new Error("Coding agent completed without changing an approved implementation path");
    }
    return agentOutputSchema.parse(result.finalOutput);
  } catch (error) {
    return recoverBoundedProgress(error);
  }
}

export function tenkiSandboxCreateOptions(job: TenkiAgentJob) {
  const profile = executionProfileForJob(job);
  // Environment-level image selection is retained only for already-queued v1
  // jobs. Every new v2 job is fully defined by its immutable profile snapshot.
  const image = profile?.tenkiImage ?? (job.schemaVersion === 1 ? process.env.TENKI_SANDBOX_IMAGE?.trim() : undefined);
  const snapshotId = profile?.tenkiSnapshotId ?? (job.schemaVersion === 1 ? process.env.TENKI_SANDBOX_SNAPSHOT_ID?.trim() : undefined);
  if (image && snapshotId) throw new Error("Configure either TENKI_SANDBOX_IMAGE or TENKI_SANDBOX_SNAPSHOT_ID, not both");
  const maxDurationMs = Math.min(profile?.maxDurationMs ?? RUN_DURATION_MS, RUN_DURATION_MS);
  return {
    name: `closespan-run-${job.runId.slice(0, 8)}`,
    cpuCores: profile?.cpuCores ?? 2,
    memoryMb: profile?.memoryMb ?? 4096,
    allowInbound: profile?.allowInbound ?? false,
    allowOutbound: profile?.allowOutbound ?? false,
    maxDurationMs,
    idleTimeoutMinutes: profile?.idleTimeoutMinutes ?? 2,
    metadata: {
      purpose: "closespan-coding-agent",
      runId: job.runId,
      orgId: job.orgId,
      promptHash: job.promptHash,
      ...(job.schemaVersion === 2 ? {
        executionProfileId: job.executionProfileId,
        executionProfileHash: job.executionProfileHash,
      } : {}),
    },
    timeoutMs: CREATE_TIMEOUT_MS,
    ...(image ? { image } : {}),
    ...(snapshotId ? { snapshotId } : {}),
  };
}

const EMPTY_RESOLVED_RUNTIME_ENVIRONMENT: TenkiResolvedRuntimeEnvironment = {
  setup: {},
  runtime: {},
  test: {},
  redactionValues: [],
};

function environmentRecord(
  profile: ExecutionProfileConfigV2,
): Record<string, string> {
  return Object.fromEntries(
    profile.publicEnvironment.map(({ name, value }) => [name, value]),
  );
}

export function tenkiRuntimeEnvironmentForProfile(
  profile: ExecutionProfileConfigV2,
  resolved: TenkiResolvedRuntimeEnvironment,
) {
  const phaseMaps = {
    setup: resolved.setup,
    runtime: resolved.runtime,
    test: resolved.test,
  } as const;
  for (const exposure of ["setup", "runtime", "test"] as const) {
    const expected = new Set(
      profile.secretBindings
        .filter((binding) => binding.exposure === exposure)
        .map((binding) => binding.envName),
    );
    const actual = new Set(Object.keys(phaseMaps[exposure]));
    if (
      expected.size !== actual.size
      || [...expected].some((name) => !actual.has(name))
    ) {
      throw new Error(
        `Coding execution did not receive the exact ${exposure} secret bindings from the immutable execution profile`,
      );
    }
  }
  const publicEnvironment = environmentRecord(profile);
  const applicationUrl = profile.applicationPort === null
    ? undefined
    : `http://127.0.0.1:${profile.applicationPort}`;
  return {
    setup: {
      ...publicEnvironment,
      ...resolved.setup,
      CI: "true",
    },
    runtime: {
      ...publicEnvironment,
      ...resolved.runtime,
      ...(profile.applicationPort === null
        ? {}
        : { PORT: String(profile.applicationPort) }),
    },
    test: {
      ...publicEnvironment,
      ...resolved.test,
      CI: "true",
      ...(applicationUrl ? { CLOSESPAN_APP_URL: applicationUrl } : {}),
    },
    redactionValues: resolved.redactionValues,
  };
}

export async function executeTenkiCodingJob(
  input: unknown,
  events: TenkiCodingExecutorEvents,
  dependencies: ExecutorDependencies = {},
): Promise<AgentImplementationReport> {
  const job = tenkiAgentJobSchema.parse(input);
  if (job.schemaVersion === 2) assertTenkiExecutionProfileBinding(job);
  if (Date.parse(job.expiresAt) <= Date.now()) throw new Error("Approval expired before execution began");
  if (!job.capabilities.includes("repository:read") || !job.capabilities.includes("repository:write") || !job.capabilities.includes("tests:execute"))
    throw new Error("Approval does not include the required executor capabilities");
  const apiKey = dependencies.apiKey ?? process.env.TENKI_API_KEY?.trim();
  const ai = resolveExecutorAiConfiguration(dependencies);
  if (!apiKey) throw new Error("TENKI_API_KEY is required for coding execution");
  const executionProfile = executionProfileForJob(job);
  const runtimeProfile = executionProfile?.schemaVersion === 2
    ? executionProfile
    : null;
  const generatedTests = job.generatedTests ?? [];
  const liveReplayRequired = generatedTests.length > 0
    && pddScenariosRequireLiveApplication(job.testScenarios);
  if (
    liveReplayRequired
    && !pddGeneratedTestsReferenceLiveApplication(generatedTests)
  ) {
    throw new Error(
      "The approved PDD live test does not reference CLOSESPAN_APP_URL",
    );
  }
  if (
    liveReplayRequired
    && (
      !runtimeProfile?.startCommand
      || !runtimeProfile.applicationPort
      || !runtimeProfile.healthCheckPath
    )
  ) {
    throw new Error(
      "The approved PDD live test requires a configured running application",
    );
  }
  if (
    runtimeProfile?.secretBindings.length
    && !dependencies.runtimeEnvironment
  ) {
    throw new Error("The execution profile requires resolved runtime secret bindings");
  }
  const resolvedRuntime = dependencies.runtimeEnvironment
    ?? EMPTY_RESOLVED_RUNTIME_ENVIRONMENT;
  const runtimeEnvironment = runtimeProfile
    ? tenkiRuntimeEnvironmentForProfile(runtimeProfile, resolvedRuntime)
    : null;
  const runtimeRedactor = createRuntimeSecretRedactor(
    runtimeEnvironment?.redactionValues ?? [],
  );

  const options = tenkiSandboxCreateOptions(job);
  const deadline = Date.now() + options.maxDurationMs;
  const client = (dependencies.createClient ?? ((key) => new TenkiSandbox({
    authToken: key,
    timeoutMs: CREATE_TIMEOUT_MS,
    dataPlaneReadyTimeoutMs: CREATE_TIMEOUT_MS,
  })))(apiKey);
  let session: Session | undefined;
  let observedBootSource: TenkiBootSourceEvidence = {
    sourceSnapshotId: null,
    sourceRegistryImageId: null,
    sourceRegistryWorkspaceId: null,
    sourceRegistryRef: null,
  };
  let applicationRuntime: TenkiRuntimeEnvironment | undefined;
  let liveReplayWitness: TenkiLiveReplayWitness | undefined;
  let cleanupError: unknown;
  try {
    session = await client.createAndWait(options);
    observedBootSource = attestTenkiBootSource(session, {
      tenkiSnapshotId: executionProfile?.tenkiSnapshotId,
      tenkiImage: executionProfile?.tenkiImage,
    });
    if (
      session.outboundEnabled !== options.allowOutbound
      || session.inboundEnabled !== options.allowInbound
    ) {
      throw new Error("Tenki session networking does not match the immutable execution profile");
    }
    await events.started(session.id);
    await requireCommand(session, "mkdir", { args: ["-p", "--", REPOSITORY_ROOT], timeoutMs: 10_000 }, "Could not prepare the Tenki workspace");
    await session.writeFileStream(ARCHIVE_PATH, await boundedArchive(job.repositoryArchiveUrl));
    await requireCommand(session, "tar", { args: ["-xzf", ARCHIVE_PATH, "-C", REPOSITORY_ROOT, "--strip-components=1"], timeoutMs: 60_000 }, "Repository extraction failed");
    await session.remove(ARCHIVE_PATH);
    await requireCommand(session, "mkdir", { args: ["-p", "--", `${REPOSITORY_ROOT}/.prompt/tickets`, workingDirectory(job)], timeoutMs: 10_000 }, "Could not prepare the approved workspace");
    await session.writeFile(`${REPOSITORY_ROOT}/${job.promptArtifactPath}`, job.promptContent);
    await requireCommand(session, "git", { args: ["init", "-q"], cwd: REPOSITORY_ROOT, timeoutMs: 30_000 }, "Could not initialize the isolated repository");
    await requireCommand(session, "git", { args: ["config", "user.name", "CloseSpan"], cwd: REPOSITORY_ROOT, timeoutMs: 10_000 }, "Could not configure the isolated repository");
    await requireCommand(session, "git", { args: ["config", "user.email", "agent@closespan.com"], cwd: REPOSITORY_ROOT, timeoutMs: 10_000 }, "Could not configure the isolated repository");
    await requireCommand(session, "git", { args: ["add", "-A"], cwd: REPOSITORY_ROOT, timeoutMs: 30_000 }, "Could not capture the approved base snapshot");
    await requireCommand(session, "git", { args: ["commit", "-q", "-m", "approved-base"], cwd: REPOSITORY_ROOT, timeoutMs: 30_000 }, "Could not capture the approved base snapshot");
    // Automatic install/build/start commands may create large dependency and
    // compiler artifacts after the approved base commit. Keep those available
    // inside the VM while preventing them from entering Git diff discovery or
    // the publication payload. Existing tracked files are never hidden by
    // .git/info/exclude, so deliberate changes to repository source remain
    // visible and subject to the normal permitted-path boundary.
    await session.writeFile(
      `${REPOSITORY_ROOT}/.git/info/exclude`,
      new TextEncoder().encode(`${TENKI_RUNTIME_GIT_EXCLUDES.join("\n")}\n`),
    );

    for (const generatedTest of job.generatedTests ?? []) {
      if (await sha256(generatedTest.content) !== generatedTest.contentHash)
        throw new Error(`PDD test content hash does not match for ${generatedTest.path}`);
      if (!tenkiExecutorAllowsPublishedPath(job, generatedTest.path))
        throw new Error(`PDD test path is outside the approved ticket: ${generatedTest.path}`);
      const target = `${REPOSITORY_ROOT}/${generatedTest.path}`;
      const directory = target.slice(0, target.lastIndexOf("/"));
      await requireCommand(session, "mkdir", { args: ["-p", "--", directory], timeoutMs: 10_000 }, "Could not prepare the PDD test directory");
      await session.writeFile(target, generatedTest.content);
    }

    const runtimeInteractions: NonNullable<AgentImplementationReport["runtimeEvidence"]>["interactions"] = [];
    let runtimeStatus: Awaited<ReturnType<TenkiRuntimeEnvironment["status"]>> | undefined;
    if (
      runtimeProfile
      && runtimeEnvironment
      && (
        runtimeProfile.automaticInstall
        || runtimeProfile.automaticBuild
        || runtimeProfile.startCommand !== null
      )
    ) {
      applicationRuntime = createTenkiRuntimeEnvironment(
        session,
        {
          workingDirectory: workingDirectory(job),
          install: {
            enabled: runtimeProfile.automaticInstall,
            commands: runtimeProfile.installCommands,
          },
          build: {
            enabled: runtimeProfile.automaticBuild,
            commands: runtimeProfile.buildCommands,
          },
          startCommand: runtimeProfile.startCommand,
          port: runtimeProfile.applicationPort,
          healthPath: runtimeProfile.healthCheckPath,
          preview: {
            allowed: runtimeProfile.previewEnabled && runtimeProfile.allowInbound,
            ttlMs: Math.min(runtimeProfile.previewTtlMs, 15 * 60_000),
            slug: `closespan-${job.runId.slice(0, 8)}`,
          },
          commandTimeoutMs: Math.min(COMMAND_TIMEOUT_MS, options.maxDurationMs),
          startupTimeoutMs: runtimeProfile.healthCheckTimeoutMs,
          requestTimeoutMs: 10_000,
          terminationGraceMs: 5_000,
          maxLogBytes: 128_000,
          maxResponseBytes: 128_000,
        },
        {
          setupEnv: runtimeEnvironment.setup,
          rerunEnv: {
            ...environmentRecord(runtimeProfile),
            CI: "true",
          },
          runtimeEnv: runtimeEnvironment.runtime,
          redactionValues: runtimeEnvironment.redactionValues,
        },
      );
      try {
        await applicationRuntime.prepare();
        if (runtimeProfile.startCommand !== null) {
          runtimeStatus = await applicationRuntime.start();
        }
        runtimeInteractions.push({
          stage: "implementation",
          tool: runtimeProfile.startCommand === null ? "setup" : "restart",
          target: runtimeProfile.startCommand === null
            ? "automatic setup"
            : runtimeProfile.healthCheckPath ?? "/",
          status: runtimeStatus?.healthy ? "healthy" : "setup passed",
          evidence: runtimeStatus?.previewUrl
            ? `Application became healthy; short-lived preview: ${runtimeStatus.previewUrl}`
            : runtimeProfile.startCommand
              ? "Application became healthy on its fixed localhost port."
              : "Automatic install and build completed before the coding agent started.",
        });
      } catch (error) {
        runtimeInteractions.push({
          stage: "implementation",
          tool: runtimeProfile.startCommand === null ? "setup" : "restart",
          target: runtimeProfile.healthCheckPath ?? "automatic setup",
          status: "baseline failed",
          evidence: runtimeRedactor.redact(
            error instanceof Error ? error.message : "The baseline runtime could not start.",
          ).slice(0, 5_000),
        });
      }
    }

    const shell = new RestrictedShell(session, job, {
      testEnvironment: runtimeProfile
        ? environmentRecord(runtimeProfile)
        : undefined,
      redactionValues: runtimeEnvironment?.redactionValues,
    });
    const editor = new RestrictedEditor(session, job);
    const agentBudget = Math.min(AGENT_DURATION_MS, deadline - Date.now());
    if (agentBudget <= 0) throw new Error("Agent run exceeded the approval duration");
    const agentReport = await (dependencies.runAgent ?? defaultRunAgent)({
      job,
      shell,
      editor,
      ...(runtimeProfile?.startCommand && applicationRuntime
        ? {
            runtime: applicationRuntime,
            runtimeHealthy: runtimeStatus?.healthy === true,
            runtimeTools: runtimeToolsForAgent(
              runtimeProfile.runtimeTools,
              runtimeStatus?.healthy === true,
            ),
            restartAllowed: !runtimeProfile.secretBindings.some(
              (binding) => binding.exposure === "runtime",
            ),
          }
        : {}),
      runtimeInteractions,
      signal: AbortSignal.timeout(agentBudget),
      ai,
    });

    const prompt = decode(await session.readFile(`${REPOSITORY_ROOT}/${job.promptArtifactPath}`));
    const promptArtifactHash = await sha256(prompt);
    if (promptArtifactHash !== job.promptHash) throw new Error("Approved prompt artifact changed during execution");
    for (const generatedTest of job.generatedTests ?? []) {
      const content = decode(await session.readFile(`${REPOSITORY_ROOT}/${generatedTest.path}`));
      if (await sha256(content) !== generatedTest.contentHash)
        throw new Error(`The immutable PDD acceptance test changed during execution: ${generatedTest.path}`);
    }
    // Capture the exact publication payload before agent-modified processes
    // receive any runtime or test secret. Later checks run against mutable VM
    // state, while publication and independent verification use these bytes.
    const changedFiles = await collectChangedFiles(
      session,
      job,
      new Map(agentReport.files.map((file) => [file.path, file.reason])),
      runtimeRedactor,
    );

    if (runtimeProfile?.startCommand && applicationRuntime) {
      runtimeStatus = await applicationRuntime.restart({
        runInstall: false,
        runBuild: runtimeProfile.automaticBuild,
      });
      runtimeInteractions.push({
        stage: "implementation",
        tool: "restart",
        target: runtimeProfile.healthCheckPath ?? "/",
        status: runtimeStatus.healthy ? "healthy" : runtimeStatus.state,
        evidence: "Rebuilt and restarted the changed application before immutable acceptance replay.",
      });
    } else if (
      runtimeProfile
      && applicationRuntime
      && (runtimeProfile.automaticInstall || runtimeProfile.automaticBuild)
    ) {
      await applicationRuntime.prepare({
        runInstall: false,
        runBuild: runtimeProfile.automaticBuild,
      });
      runtimeInteractions.push({
        stage: "implementation",
        tool: "setup",
        target: "automatic setup",
        status: "passed",
        evidence: "Re-ran approved build commands after the agent changes without trusted bootstrap secrets.",
      });
    }

    let liveReplayRequestCount = 0;
    let acceptanceEnvironment = runtimeEnvironment?.test ?? { CI: "true" };
    if (liveReplayRequired) {
      liveReplayWitness = new TenkiLiveReplayWitness(
        session,
        runtimeProfile!.applicationPort!,
        runtimeProfile!.healthCheckPath!,
        workingDirectory(job),
        runtimeEnvironment?.redactionValues ?? [],
      );
      const witnessedApplicationUrl = await liveReplayWitness.start();
      acceptanceEnvironment = {
        ...acceptanceEnvironment,
        CLOSESPAN_APP_URL: witnessedApplicationUrl,
      };
    }

    const tests: AgentImplementationReport["tests"] = [];
    for (const command of job.requiredCommands) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Agent run exceeded the approval duration");
      const result = await runTenkiHostCommand(session, ["bash", "-c", command], {
        cwd: workingDirectory(job),
        env: acceptanceEnvironment,
        timeoutMs: Math.min(COMMAND_TIMEOUT_MS, remaining),
      });
      const commandPassed = result.exitCode === 0 && !result.signal && !result.timedOut;
      tests.push({
        command,
        status: commandPassed ? "passed" : "failed",
        output: runtimeRedactor.redact(
          [decode(result.stdout).trim(), decode(result.stderr).trim()]
            .filter(Boolean)
            .join("\n")
            .slice(-OUTPUT_LIMIT),
        ) || (commandPassed ? "Command passed without output." : "Command failed without output."),
      });
    }
    if (liveReplayWitness) {
      liveReplayRequestCount = await liveReplayWitness.requestCount();
      await liveReplayWitness.close();
      liveReplayWitness = undefined;
    }
    const allTestsPassed = tests.every((test) => test.status === "passed");
    const userStoryReplayPassed = generatedTests.length > 0
      && allTestsPassed
      && (
        !liveReplayRequired
        || (
          runtimeStatus?.healthy === true
          && liveReplayRequestCount > 0
        )
      );
    if (liveReplayRequired) {
      runtimeInteractions.push({
        stage: "implementation",
        tool: "http",
        target: "CLOSESPAN_APP_URL",
        status: userStoryReplayPassed ? "PDD live replay passed" : "PDD live replay failed",
        evidence: userStoryReplayPassed
          ? `The immutable PDD test made ${liveReplayRequestCount} witnessed request(s) to the healthy VM-local application and its approved command passed.`
          : "The immutable PDD live test did not make a witnessed VM-local request, or the application/test did not pass.",
      });
    }
    const reportedCriteria = new Map(agentReport.criteria.map((item) => [item.criterionId, item]));
    const criteria: AgentImplementationReport["criteria"] = job.acceptanceCriteria.map((criterion) => {
      const reported = reportedCriteria.get(criterion.id);
      const scenarios = job.testScenarios.filter((scenario) => scenario.criterionIds.includes(criterion.id));
      const automated = scenarios.some((scenario) => scenario.testLevel !== "manual");
      return {
        criterionId: criterion.id,
        status: automated && allTestsPassed && reported?.status === "Passed" ? "Passed" : !automated ? "Pending manual" : "Failed",
        evidence: reported?.evidence ?? (automated ? "The coding agent did not provide criterion evidence." : "Release-level manual verification remains required."),
        scenarioIds: scenarios.map((scenario) => scenario.id),
      };
    });
    const changedPaths = new Set(changedFiles.map((file) => file.path));
    const testFiles = [...new Set([
      ...agentReport.testFiles,
      ...(job.generatedTests ?? []).map((test) => test.path),
    ])].filter((path) => changedPaths.has(path));
    const successful = allTestsPassed
      && criteria.every((criterion) => criterion.status === "Passed" || criterion.status === "Pending manual")
      && (!job.testScenarios.some((scenario) => scenario.testLevel !== "manual") || testFiles.length > 0);
    return agentImplementationReportSchema.parse({
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
      ...(runtimeProfile
        ? {
            runtimeEvidence: {
              configured: runtimeProfile.startCommand !== null,
              healthStatus: runtimeProfile.startCommand === null
                ? "not_configured"
                : runtimeStatus?.healthy
                  ? "passed"
                  : "failed",
              applicationPort: runtimeProfile.applicationPort,
              previewUrl: runtimeStatus?.previewUrl ?? null,
              ...observedBootSource,
              interactions: runtimeInteractions,
              logExcerpt: applicationRuntime
                ? applicationRuntime.logs(20_000).split("\n").filter(Boolean).slice(-100)
                : [],
              userStoryReplay: generatedTests.length === 0
                ? "not_required"
                : userStoryReplayPassed
                  ? "passed"
                  : "failed",
              userStoryReplayMode: generatedTests.length === 0
                ? "not_required"
                : liveReplayRequired
                  ? "live_application"
                  : "contract",
            },
          }
        : {}),
    });
  } finally {
    if (session) {
      try {
        await liveReplayWitness?.close();
      } catch (error) {
        cleanupError = error;
      }
      try {
        await applicationRuntime?.close();
      } catch (error) {
        cleanupError = error;
      }
      try {
        await session.close();
      } catch (error) {
        cleanupError ??= error;
      }
    }
    client.close();
    if (cleanupError) throw new Error("Tenki coding execution completed, but CloseSpan could not confirm sandbox cleanup");
  }
}
