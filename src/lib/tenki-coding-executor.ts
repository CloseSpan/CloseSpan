import { Buffer } from "node:buffer";
import {
  Agent,
  OpenAIProvider,
  Runner,
  applyDiff,
  applyPatchTool,
  shellTool,
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

const MAX_ARCHIVE_BYTES = 50_000_000;
const MAX_CHANGED_BYTES = 5_000_000;
const WORKSPACE = "/home/tenki/repo";
const ARCHIVE_PATH = "/home/tenki/closespan-repository.tar.gz";
const CREATE_TIMEOUT_MS = 60_000;
// Keep the entire execution, report callback, and sandbox cleanup inside
// Vercel Hobby's five-minute function ceiling.
const RUN_DURATION_MS = 4 * 60_000;
const AGENT_DURATION_MS = 3 * 60_000;
const COMMAND_TIMEOUT_MS = 300_000;
const OUTPUT_LIMIT = 20_000;

const criterionSchema = z.object({
  id: z.string().regex(/^AC-[1-9][0-9]*$/),
  scenarioIds: z.array(z.string().regex(/^TEST-[1-9][0-9]*$/)).max(50),
});

const scenarioSchema = z.object({
  id: z.string().regex(/^TEST-[1-9][0-9]*$/),
  testLevel: z.enum(["unit", "integration", "api", "component", "end-to-end", "manual"]),
  criterionIds: z.array(z.string().regex(/^AC-[1-9][0-9]*$/)).min(1).max(30),
});

export const tenkiAgentJobSchema = z.object({
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

export type TenkiAgentJob = z.infer<typeof tenkiAgentJobSchema>;

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

export interface TenkiCodingExecutorEvents {
  started(sessionId: string): Promise<void>;
}

interface ExecutorDependencies {
  apiKey?: string;
  openAiApiKey?: string;
  aiBaseUrl?: string;
  aiModel?: string;
  createClient?: (apiKey: string) => TenkiSandbox;
  runAgent?: (input: {
    job: TenkiAgentJob;
    shell: RestrictedShell;
    editor: RestrictedEditor;
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
      model: dependencies.aiModel?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-5.1-codex-mini",
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

export function tenkiExecutorAllowsPath(job: Pick<TenkiAgentJob, "permittedPaths" | "promptArtifactPath">, path: string): boolean {
  return !path.startsWith("/")
    && !path.split("/").includes("..")
    && path !== job.promptArtifactPath
    && path !== ".prompt/README.md"
    && path !== ".prompt/template.prompt.md"
    && !path.startsWith(".github/workflows/")
    && job.permittedPaths.some((pattern) => pathMatches(pattern, path));
}

export function tenkiExecutorAllowsInspectionCommand(command: string): boolean {
  if (/[;&|`$><\n\r]/.test(command)) return false;
  if (/(?:^|\s)\//.test(command) || /(?:^|\s)\S*\.\.(?:\/|\s|$)/.test(command) || /(?:^|\s)--pre(?:=|\s|$)/.test(command)) return false;
  return /^(pwd|ls(?:\s+[-A-Za-z0-9_./*]+)*|find\s+\.\s+-maxdepth\s+[1-6]\s+-type\s+[fd]|git\s+(?:status(?:\s+--short)?|diff(?:\s+--(?:stat|name-only))?|log\s+-n\s+[1-9][0-9]?|show\s+--stat)|cat\s+[A-Za-z0-9_./*-]+|sed\s+-n\s+[0-9,]+p\s+[A-Za-z0-9_./*-]+|rg(?:\s+[-A-Za-z0-9_./*:=]+){1,12})$/.test(command.trim());
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

  constructor(private readonly session: Session, private readonly job: TenkiAgentJob) {}

  async run(action: ShellAction): Promise<ShellResult> {
    if (action.commands.length > 6) throw new Error("Too many commands in one shell action");
    for (const command of action.commands) {
      if (!tenkiExecutorAllowsInspectionCommand(command) && !this.job.requiredCommands.includes(command.trim()))
        throw new Error(`Command is outside the approved shell capability: ${command}`);
    }
    const output: ShellResult["output"] = [];
    for (const command of action.commands) {
      try {
        const result = await this.session.exec("bash", {
          args: ["-c", command],
          cwd: WORKSPACE,
          timeoutMs: Math.min(action.timeoutMs ?? 120_000, COMMAND_TIMEOUT_MS),
          env: { CI: "true" },
        });
        const stdout = decode(result.stdout).slice(-OUTPUT_LIMIT);
        const stderr = decode(result.stderr).slice(-OUTPUT_LIMIT);
        this.results.push({ command, stdout, stderr, exitCode: result.exitCode });
        output.push({
          command,
          stdout,
          stderr,
          outcome: result.status === "TIMED_OUT" ? { type: "timeout" } : { type: "exit", exitCode: result.exitCode },
        });
        if (result.status === "TIMED_OUT") break;
      } catch (error) {
        const stderr = error instanceof Error ? error.message : "Tenki command failed";
        this.results.push({ command, stdout: "", stderr, exitCode: 1 });
        output.push({ command, stdout: "", stderr, outcome: { type: "exit", exitCode: 1 } });
      }
    }
    return { output, maxOutputLength: OUTPUT_LIMIT, providerData: { provider: "Tenki Sandbox", working_directory: WORKSPACE } };
  }

  async changedPaths(): Promise<string[]> {
    await requireCommand(this.session, "git", { args: ["add", "-N", "--", "."], cwd: WORKSPACE, timeoutMs: 30_000 }, "Unable to enumerate agent changes");
    const result = await requireCommand(this.session, "git", { args: ["diff", "--name-only", "--no-renames", "HEAD"], cwd: WORKSPACE, timeoutMs: 30_000 }, "Unable to inspect agent changes");
    return decode(result.stdout).split("\n").map((path) => path.trim()).filter(Boolean);
  }
}

export class RestrictedEditor implements Editor {
  constructor(private readonly session: Session, private readonly job: TenkiAgentJob) {}

  private resolve(path: string): string {
    const relative = path.startsWith(`${WORKSPACE}/`) ? path.slice(WORKSPACE.length + 1) : path;
    if (!tenkiExecutorAllowsPath(this.job, relative)) throw new Error(`File operation is outside the approved paths: ${relative}`);
    return `${WORKSPACE}/${relative.replace(/^\.\//, "")}`;
  }

  private async prepareParent(target: string): Promise<void> {
    const directory = target.slice(0, target.lastIndexOf("/")) || WORKSPACE;
    const result = await this.session.exec("mkdir", { args: ["-p", "--", directory], timeoutMs: 10_000 });
    if (!succeeded(result)) throw new Error(`Could not prepare ${directory}`);
  }

  async createFile(operation: CreateFileOperation): Promise<ApplyPatchResult> {
    const target = this.resolve(operation.path);
    await this.prepareParent(target);
    await this.session.writeFile(target, applyDiff("", operation.diff, "create"));
    return { status: "completed", output: `Created ${operation.path}` };
  }

  async updateFile(operation: UpdateFileOperation): Promise<ApplyPatchResult> {
    const target = this.resolve(operation.path);
    const original = decode(await this.session.readFile(target));
    await this.session.writeFile(target, applyDiff(original, operation.diff));
    return { status: "completed", output: `Updated ${operation.path}` };
  }

  async deleteFile(operation: DeleteFileOperation): Promise<ApplyPatchResult> {
    const target = this.resolve(operation.path);
    await this.session.remove(target);
    return { status: "completed", output: `Deleted ${operation.path}` };
  }

  async writeApprovedTextFile(path: string, content: string): Promise<string> {
    const bytes = new TextEncoder().encode(content);
    if (bytes.byteLength > 1_000_000) throw new Error(`File content exceeds the editor limit: ${path}`);
    const target = this.resolve(path);
    await this.prepareParent(target);
    await this.session.writeFile(target, bytes);
    return `Wrote ${path}`;
  }

  async deleteApprovedFile(path: string): Promise<string> {
    const target = this.resolve(path);
    await this.session.remove(target);
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

async function collectChangedFiles(session: Session, job: TenkiAgentJob, reasons: Map<string, string>) {
  await requireCommand(session, "git", { args: ["add", "-N", "--", "."], cwd: WORKSPACE, timeoutMs: 30_000 }, "Unable to enumerate newly created files");
  const diff = await requireCommand(session, "git", { args: ["diff", "--name-status", "--no-renames", "-z", "HEAD"], cwd: WORKSPACE, timeoutMs: 30_000 }, "Unable to inspect the final diff");
  const fields = decode(diff.stdout).split("\0").filter(Boolean);
  const files: AgentImplementationReport["changedFiles"] = [];
  let total = 0;
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index];
    const path = fields[index + 1];
    if (!status || !path || !/^[AMD]$/.test(status)) throw new Error("Unsupported or malformed change in final diff");
    if (!tenkiExecutorAllowsPath(job, path)) throw new Error(`Final diff includes prohibited path ${path}`);
    let contentBase64: string | null = null;
    if (status !== "D") {
      const target = `${WORKSPACE}/${path}`;
      const info = await session.stat(target);
      if (info.isDir || info.isSymlink) throw new Error(`Only regular, non-symlink files may be published: ${path}`);
      const file = await session.readFile(target);
      if (file.includes(0)) throw new Error(`Binary change is prohibited: ${path}`);
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
  const instructions = [
    "Implement exactly one approved CloseSpan ticket in the isolated Tenki microVM.",
    `The repository root is ${WORKSPACE}. Read the approved prompt at ${input.job.promptArtifactPath} and obey repository instructions.`,
    "Do not change the approved prompt, workflow files, deployments, production systems, or files outside the permitted paths.",
    input.ai.provider === "OpenAI"
      ? "Use apply_patch for all code changes. Shell access is limited to inspection and explicitly approved validation commands."
      : "Use the approved text-file tools for code changes. Command access is limited to inspection and explicitly approved validation commands.",
    "Do not stop after describing your plan. Inspect the repository, make the approved code and test changes, and run the approved validation commands before finishing.",
    "Return criterion-level evidence honestly. Manual scenarios must remain Pending manual. Do not fabricate test evidence.",
  ].join("\n");

  if (input.ai.provider === "xAI") {
    const compatibleTools = [
      tool({
        name: "run_approved_commands",
        description: "Run one or more repository inspection commands or exact approved validation commands in the isolated workspace.",
        parameters: z.object({ commands: z.array(z.string().min(1).max(500)).min(1).max(6) }).strict(),
        execute: async ({ commands }) => JSON.stringify(await input.shell.run({ commands })),
      }),
      tool({
        name: "write_approved_text_file",
        description: "Create or completely replace one UTF-8 text file inside the ticket's approved paths.",
        parameters: z.object({ path: z.string().min(1).max(500), content: z.string().max(500_000) }).strict(),
        execute: async ({ path, content }) => input.editor.writeApprovedTextFile(path, content),
      }),
      tool({
        name: "delete_approved_file",
        description: "Delete one file inside the ticket's approved paths.",
        parameters: z.object({ path: z.string().min(1).max(500) }).strict(),
        execute: async ({ path }) => input.editor.deleteApprovedFile(path),
      }),
    ];
    const implementationAgent = new Agent({
      name: "CloseSpan implementation agent",
      model: input.ai.model,
      instructions,
      tools: compatibleTools,
      modelSettings: { toolChoice: "required", parallelToolCalls: false, store: false },
      resetToolChoice: true,
    });
    let changedPaths: string[] = [];
    for (let attempt = 0; attempt < 4 && changedPaths.length === 0; attempt += 1) {
      const feedback = attempt === 0
        ? input.job.promptContent
        : `${input.job.promptContent}\n\nExecutor feedback: no repository files have changed yet. Continue now by using the approved write tool to implement the ticket and its automated test.`;
      await runner.run(implementationAgent, feedback, { maxTurns: 40, signal: input.signal });
      changedPaths = await input.shell.changedPaths();
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
      shellTool({ shell: input.shell, needsApproval: false }),
      applyPatchTool({ editor: input.editor, needsApproval: false }),
    ],
    outputType: agentOutputSchema,
    modelSettings: { toolChoice: "required", parallelToolCalls: false, store: false },
    resetToolChoice: true,
  });
  const result = await runner.run(agent, input.job.promptContent, { maxTurns: 80, signal: input.signal });
  if (!result.finalOutput) throw new Error("Coding agent did not return an implementation report");
  return agentOutputSchema.parse(result.finalOutput);
}

function createOptions(job: TenkiAgentJob) {
  const image = process.env.TENKI_SANDBOX_IMAGE?.trim();
  const snapshotId = process.env.TENKI_SANDBOX_SNAPSHOT_ID?.trim();
  if (image && snapshotId) throw new Error("Configure either TENKI_SANDBOX_IMAGE or TENKI_SANDBOX_SNAPSHOT_ID, not both");
  return {
    name: `closespan-run-${job.runId.slice(0, 8)}`,
    cpuCores: 2,
    memoryMb: 4096,
    allowInbound: false,
    allowOutbound: false,
    maxDurationMs: RUN_DURATION_MS,
    idleTimeoutMinutes: 2,
    metadata: { purpose: "closespan-coding-agent", runId: job.runId, orgId: job.orgId, promptHash: job.promptHash },
    timeoutMs: CREATE_TIMEOUT_MS,
    ...(image ? { image } : {}),
    ...(snapshotId ? { snapshotId } : {}),
  };
}

export async function executeTenkiCodingJob(
  input: unknown,
  events: TenkiCodingExecutorEvents,
  dependencies: ExecutorDependencies = {},
): Promise<AgentImplementationReport> {
  const job = tenkiAgentJobSchema.parse(input);
  if (Date.parse(job.expiresAt) <= Date.now()) throw new Error("Approval expired before execution began");
  if (!job.capabilities.includes("repository:read") || !job.capabilities.includes("repository:write") || !job.capabilities.includes("tests:execute"))
    throw new Error("Approval does not include the required executor capabilities");
  const apiKey = dependencies.apiKey ?? process.env.TENKI_API_KEY?.trim();
  const ai = resolveExecutorAiConfiguration(dependencies);
  if (!apiKey) throw new Error("TENKI_API_KEY is required for coding execution");

  const deadline = Date.now() + RUN_DURATION_MS;
  const client = (dependencies.createClient ?? ((key) => new TenkiSandbox({
    authToken: key,
    timeoutMs: CREATE_TIMEOUT_MS,
    dataPlaneReadyTimeoutMs: CREATE_TIMEOUT_MS,
  })))(apiKey);
  let session: Session | undefined;
  let cleanupError: unknown;
  try {
    session = await client.createAndWait(createOptions(job));
    if (session.outboundEnabled || session.inboundEnabled)
      throw new Error("Tenki session networking is enabled; refusing to execute repository code");
    await events.started(session.id);
    await requireCommand(session, "mkdir", { args: ["-p", "--", WORKSPACE], timeoutMs: 10_000 }, "Could not prepare the Tenki workspace");
    await session.writeFileStream(ARCHIVE_PATH, await boundedArchive(job.repositoryArchiveUrl));
    await requireCommand(session, "tar", { args: ["-xzf", ARCHIVE_PATH, "-C", WORKSPACE, "--strip-components=1"], timeoutMs: 60_000 }, "Repository extraction failed");
    await session.remove(ARCHIVE_PATH);
    await requireCommand(session, "mkdir", { args: ["-p", "--", `${WORKSPACE}/.prompt/tickets`], timeoutMs: 10_000 }, "Could not prepare the approved prompt directory");
    await session.writeFile(`${WORKSPACE}/${job.promptArtifactPath}`, job.promptContent);
    await requireCommand(session, "git", { args: ["init", "-q"], cwd: WORKSPACE, timeoutMs: 30_000 }, "Could not initialize the isolated repository");
    await requireCommand(session, "git", { args: ["config", "user.name", "CloseSpan"], cwd: WORKSPACE, timeoutMs: 10_000 }, "Could not configure the isolated repository");
    await requireCommand(session, "git", { args: ["config", "user.email", "agent@closespan.com"], cwd: WORKSPACE, timeoutMs: 10_000 }, "Could not configure the isolated repository");
    await requireCommand(session, "git", { args: ["add", "-A"], cwd: WORKSPACE, timeoutMs: 30_000 }, "Could not capture the approved base snapshot");
    await requireCommand(session, "git", { args: ["commit", "-q", "-m", "approved-base"], cwd: WORKSPACE, timeoutMs: 30_000 }, "Could not capture the approved base snapshot");

    const shell = new RestrictedShell(session, job);
    const editor = new RestrictedEditor(session, job);
    const agentBudget = Math.min(AGENT_DURATION_MS, deadline - Date.now());
    if (agentBudget <= 0) throw new Error("Agent run exceeded the approval duration");
    const agentReport = await (dependencies.runAgent ?? defaultRunAgent)({
      job,
      shell,
      editor,
      signal: AbortSignal.timeout(agentBudget),
      ai,
    });

    const prompt = decode(await session.readFile(`${WORKSPACE}/${job.promptArtifactPath}`));
    const promptArtifactHash = await sha256(prompt);
    if (promptArtifactHash !== job.promptHash) throw new Error("Approved prompt artifact changed during execution");

    const tests: AgentImplementationReport["tests"] = [];
    for (const command of job.requiredCommands) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Agent run exceeded the approval duration");
      const result = await session.exec("bash", {
        args: ["-c", command],
        cwd: WORKSPACE,
        timeoutMs: Math.min(COMMAND_TIMEOUT_MS, remaining),
        env: { CI: "true" },
      });
      tests.push({
        command,
        status: succeeded(result) ? "passed" : "failed",
        output: combinedOutput(result) || (succeeded(result) ? "Command passed without output." : "Command failed without output."),
      });
    }
    const allTestsPassed = tests.every((test) => test.status === "passed");
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
    const changedFiles = await collectChangedFiles(session, job, new Map(agentReport.files.map((file) => [file.path, file.reason])));
    const changedPaths = new Set(changedFiles.map((file) => file.path));
    const testFiles = [...new Set(agentReport.testFiles)].filter((path) => changedPaths.has(path));
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
    });
  } finally {
    if (session) {
      try {
        await session.close();
      } catch (error) {
        cleanupError = error;
      }
    }
    client.close();
    if (cleanupError) throw new Error("Tenki coding execution completed, but CloseSpan could not confirm sandbox cleanup");
  }
}
