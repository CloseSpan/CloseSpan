import { createHash } from "node:crypto";
import path from "node:path";
import {
  TenkiSandbox,
  type ExecResult,
  type Session,
} from "@tenkicloud/sandbox";
import type { AgentImplementationReport } from "./agent-run-verification";
import type { AgentRunExecutionContext } from "./engineering-workflow-repository";
import { createRepositoryArchiveUrl } from "./github-agent-publisher";
import {
  assertExecutionProfileNarrowing,
  assertExecutionProfileScopeBoundary,
  hashExecutionProfileConfig,
  sanitizeExecutionProfileConfig,
  type ExecutionProfileConfig,
} from "./execution-profile";

const ARCHIVE_LIMIT_BYTES = 80_000_000;
const CREATE_TIMEOUT_MS = 60_000;
const COMMAND_TIMEOUT_MS = 300_000;
// Leave time in the callback's five-minute window to publish the draft PR.
const SESSION_DURATION_MS = 3 * 60_000;
const OUTPUT_LIMIT = 20_000;
const WORKSPACE = "/home/tenki/repo";
const ARCHIVE_PATH = "/home/tenki/closespan-repository.tar.gz";

function verificationProfile(context: AgentRunExecutionContext): ExecutionProfileConfig | null {
  if (!context.executionProfileSnapshot) return null;
  const snapshot = context.executionProfileSnapshot;
  if (snapshot.source === "detected") {
    throw new TenkiIndependentVerificationError(
      "sandbox_failed",
      "An unconfirmed detected execution profile cannot run independent verification.",
    );
  }
  const config = sanitizeExecutionProfileConfig(snapshot.config);
  if (
    (snapshot.source === "safe_generic" && snapshot.repository !== "")
    || (
      snapshot.source !== "safe_generic"
      && snapshot.repository !== context.repository
    )
  ) {
    throw new TenkiIndependentVerificationError(
      "sandbox_failed",
      "The immutable execution profile belongs to another repository.",
    );
  }
  try {
    assertExecutionProfileScopeBoundary(
      { repository: snapshot.repository, workspaceRoot: snapshot.workspaceRoot },
      config,
    );
    assertExecutionProfileNarrowing(config, {
      permittedPaths: context.promptSnapshot.ticket.permittedPaths,
      requiredCommands: [
        ...new Set([
          ...context.promptSnapshot.ticket.requiredCommands,
          ...(context.generatedTests ?? []).map((test) => test.command),
        ]),
      ],
    });
  } catch (error) {
    throw new TenkiIndependentVerificationError(
      "sandbox_failed",
      error instanceof Error
        ? `The immutable execution profile is outside the approved ticket boundary: ${error.message}`
        : "The immutable execution profile is outside the approved ticket boundary.",
    );
  }
  if (
    snapshot.profileId !== context.executionProfileId
    || snapshot.contentHash !== context.executionProfileHash
    || hashExecutionProfileConfig(config) !== context.executionProfileHash
  ) {
    throw new TenkiIndependentVerificationError(
      "sandbox_failed",
      "The immutable execution profile binding changed before independent verification.",
    );
  }
  return config;
}

function verificationWorkingDirectory(profile: ExecutionProfileConfig | null): string {
  return !profile || profile.workingDirectory === "."
    ? WORKSPACE
    : `${WORKSPACE}/${profile.workingDirectory}`;
}

function assertPddArtifactsMatchApprovedRun(
  context: AgentRunExecutionContext,
  report: AgentImplementationReport,
): void {
  const changedFiles = new Map(report.changedFiles.map((file) => [file.path, file]));
  for (const generatedTest of context.generatedTests ?? []) {
    const approvedHash = createHash("sha256")
      .update(generatedTest.content, "utf8")
      .digest("hex");
    const changed = changedFiles.get(generatedTest.path);
    const changedContent = changed?.contentBase64 === null || changed?.contentBase64 === undefined
      ? null
      : Buffer.from(changed.contentBase64, "base64");
    if (
      approvedHash !== generatedTest.contentHash
      || !changedContent
      || !changedContent.equals(Buffer.from(generatedTest.content, "utf8"))
      || !report.testFiles.includes(generatedTest.path)
    ) {
      throw new TenkiIndependentVerificationError(
        "sandbox_failed",
        `The immutable PDD acceptance test changed before independent verification: ${generatedTest.path}.`,
      );
    }
  }
}

type VerificationSession = Pick<
  Session,
  "id" | "exec" | "mkdir" | "writeFile" | "remove" | "close" | "inboundEnabled" | "outboundEnabled"
>;

type VerificationClient = {
  createAndWait(options: Parameters<TenkiSandbox["createAndWait"]>[0]): Promise<VerificationSession>;
  close(): void;
};

interface VerificationDependencies {
  apiKey?: string;
  now?: () => number;
  createClient?: (apiKey: string) => VerificationClient;
  repositoryArchive?: (context: AgentRunExecutionContext) => Promise<Uint8Array>;
}

export class TenkiIndependentVerificationError extends Error {
  constructor(
    public readonly code:
      | "not_configured"
      | "archive_failed"
      | "sandbox_failed"
      | "cleanup_failed",
    message: string,
  ) {
    super(message);
    this.name = "TenkiIndependentVerificationError";
  }
}

function verificationRequired(): boolean {
  return process.env.TENKI_VERIFICATION_REQUIRED?.trim().toLowerCase() === "true";
}

export function tenkiIndependentVerificationConfigured(): boolean {
  return Boolean(process.env.TENKI_API_KEY?.trim());
}

function defaultClient(apiKey: string): VerificationClient {
  return new TenkiSandbox({
    authToken: apiKey,
    timeoutMs: CREATE_TIMEOUT_MS,
    dataPlaneReadyTimeoutMs: CREATE_TIMEOUT_MS,
  });
}

async function boundedResponseBody(
  response: Response,
  limit = ARCHIVE_LIMIT_BYTES,
): Promise<Uint8Array> {
  if (!response.ok || !response.body) {
    throw new TenkiIndependentVerificationError(
      "archive_failed",
      "CloseSpan could not load the approved repository snapshot.",
    );
  }
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > limit) {
    throw new TenkiIndependentVerificationError(
      "archive_failed",
      "The approved repository snapshot is too large for independent verification.",
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        throw new TenkiIndependentVerificationError(
          "archive_failed",
          "The approved repository snapshot is too large for independent verification.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const archive = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    archive.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return archive;
}

async function defaultRepositoryArchive(
  context: AgentRunExecutionContext,
): Promise<Uint8Array> {
  const url = await createRepositoryArchiveUrl(context);
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  return boundedResponseBody(response);
}

function output(result: ExecResult): string {
  const decoder = new TextDecoder();
  const stdout = decoder.decode(result.stdout).trim();
  const stderr = decoder.decode(result.stderr).trim();
  return [stdout, stderr].filter(Boolean).join("\n").slice(-OUTPUT_LIMIT);
}

function succeeded(result: ExecResult): boolean {
  return result.status === "SUCCEEDED" && result.exitCode === 0;
}

async function requireSuccess(
  session: VerificationSession,
  command: string,
  options: Parameters<VerificationSession["exec"]>[1],
  failureMessage: string,
): Promise<ExecResult> {
  const result = await session.exec(command, options);
  if (!succeeded(result)) {
    throw new TenkiIndependentVerificationError("sandbox_failed", failureMessage);
  }
  return result;
}

async function applyApprovedChange(
  session: VerificationSession,
  file: AgentImplementationReport["changedFiles"][number],
): Promise<void> {
  const target = `${WORKSPACE}/${file.path}`;
  if (file.contentBase64 === null) {
    await requireSuccess(
      session,
      "rm",
      { args: ["-f", "--", file.path], cwd: WORKSPACE, timeoutMs: 10_000 },
      `Tenki could not apply the approved deletion for ${file.path}.`,
    );
    return;
  }
  const directory = path.posix.dirname(target);
  await requireSuccess(
    session,
    "mkdir",
    { args: ["-p", "--", directory], timeoutMs: 10_000 },
    `Tenki could not prepare ${file.path} for verification.`,
  );
  await session.writeFile(
    target,
    Uint8Array.from(Buffer.from(file.contentBase64, "base64")),
  );
}

function verificationCriteria(
  context: AgentRunExecutionContext,
  report: AgentImplementationReport,
  passed: boolean,
  sessionId: string,
): AgentImplementationReport["criteria"] {
  return report.criteria.map((criterion) => {
    const scenarios = context.promptSnapshot.ticket.testScenarios.filter(
      (scenario) => scenario.criterionIds.includes(criterion.criterionId),
    );
    if (!scenarios.some((scenario) => scenario.testLevel !== "manual")) {
      return criterion;
    }
    return {
      ...criterion,
      status: passed ? "Passed" as const : "Not verified" as const,
      evidence: (passed
        ? `${criterion.evidence} Independently rerun in Tenki session ${sessionId}.`
        : `Tenki session ${sessionId} did not independently verify the required commands.`).slice(0, 5_000),
    };
  });
}

export async function verifyAgentRunWithTenki(
  context: AgentRunExecutionContext,
  report: AgentImplementationReport,
  dependencies: VerificationDependencies = {},
): Promise<AgentImplementationReport> {
  const apiKey = dependencies.apiKey ?? process.env.TENKI_API_KEY?.trim();
  if (!apiKey) {
    if (verificationRequired()) {
      throw new TenkiIndependentVerificationError(
        "not_configured",
        "Independent Tenki verification is required but not configured.",
      );
    }
    return report;
  }

  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const profile = verificationProfile(context);
  assertPddArtifactsMatchApprovedRun(context, report);
  const sessionDurationMs = Math.min(profile?.maxDurationMs ?? SESSION_DURATION_MS, SESSION_DURATION_MS);
  let archive: Uint8Array;
  try {
    archive = await (dependencies.repositoryArchive ?? defaultRepositoryArchive)(context);
  } catch (error) {
    if (error instanceof TenkiIndependentVerificationError) throw error;
    console.error("[tenki:repository-archive]", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    throw new TenkiIndependentVerificationError(
      "archive_failed",
      "CloseSpan could not load the approved repository snapshot.",
    );
  }
  let client: VerificationClient;
  try {
    client = (dependencies.createClient ?? defaultClient)(apiKey);
  } catch (error) {
    console.error("[tenki:verification-client]", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    throw new TenkiIndependentVerificationError(
      "sandbox_failed",
      "Tenki could not start independent verification.",
    );
  }
  let session: VerificationSession | undefined;
  let cleanupError: unknown;

  try {
    // Environment-level selection is a compatibility path for legacy runs
    // without a persisted profile; new runs use only the immutable snapshot.
    const image = profile?.tenkiImage ?? (!context.executionProfileSnapshot ? process.env.TENKI_SANDBOX_IMAGE?.trim() : undefined);
    const snapshotId = profile?.tenkiSnapshotId ?? (!context.executionProfileSnapshot ? process.env.TENKI_SANDBOX_SNAPSHOT_ID?.trim() : undefined);
    if (image && snapshotId) {
      throw new TenkiIndependentVerificationError(
        "sandbox_failed",
        "Configure either a Tenki image or snapshot, not both.",
      );
    }
    session = await client.createAndWait({
      name: `closespan-verify-${context.runId.slice(0, 8)}`,
      cpuCores: profile?.cpuCores ?? 2,
      memoryMb: profile?.memoryMb ?? 4096,
      allowInbound: profile?.allowInbound ?? false,
      allowOutbound: profile?.allowOutbound ?? false,
      maxDurationMs: sessionDurationMs,
      idleTimeoutMinutes: profile?.idleTimeoutMinutes ?? 2,
      metadata: {
        purpose: "closespan-independent-verification",
        runId: context.runId,
        promptHash: context.promptHash,
        ...(context.executionProfileId ? {
          executionProfileId: context.executionProfileId,
          executionProfileHash: context.executionProfileHash,
        } : {}),
      },
      timeoutMs: CREATE_TIMEOUT_MS,
      ...(image ? { image } : {}),
      ...(snapshotId ? { snapshotId } : {}),
    });
    if (
      session.inboundEnabled !== (profile?.allowInbound ?? false)
      || session.outboundEnabled !== (profile?.allowOutbound ?? false)
    ) {
      throw new TenkiIndependentVerificationError(
        "sandbox_failed",
        "Tenki verification networking does not match the immutable execution profile.",
      );
    }
    await requireSuccess(
      session,
      "mkdir",
      { args: ["-p", "--", WORKSPACE, verificationWorkingDirectory(profile)], timeoutMs: 10_000 },
      "Tenki could not prepare the verification workspace.",
    );
    await session.writeFile(ARCHIVE_PATH, archive);
    await requireSuccess(
      session,
      "tar",
      {
        args: [
          "-xzf",
          ARCHIVE_PATH,
          "-C",
          WORKSPACE,
          "--strip-components=1",
        ],
        timeoutMs: 60_000,
      },
      "Tenki could not extract the approved repository snapshot.",
    );
    await session.remove(ARCHIVE_PATH);
    await requireSuccess(
      session,
      "mkdir",
      {
        args: ["-p", "--", path.posix.dirname(`${WORKSPACE}/${context.promptArtifactPath}`)],
        timeoutMs: 10_000,
      },
      "Tenki could not prepare the approved prompt artifact.",
    );
    await session.writeFile(
      `${WORKSPACE}/${context.promptArtifactPath}`,
      context.promptContent,
    );
    for (const file of report.changedFiles) {
      await applyApprovedChange(session, file);
    }

    const promptHash = await session.exec("sha256sum", {
      args: [context.promptArtifactPath],
      cwd: WORKSPACE,
      timeoutMs: 10_000,
    });
    if (
      !succeeded(promptHash) ||
      !output(promptHash).startsWith(context.promptHash)
    ) {
      throw new TenkiIndependentVerificationError(
        "sandbox_failed",
        "Tenki could not verify the approved prompt artifact byte-for-byte.",
      );
    }
    for (const generatedTest of context.generatedTests ?? []) {
      const generatedTestHash = await session.exec("sha256sum", {
        args: [generatedTest.path],
        cwd: WORKSPACE,
        timeoutMs: 10_000,
      });
      if (
        !succeeded(generatedTestHash)
        || !output(generatedTestHash).startsWith(generatedTest.contentHash)
      ) {
        throw new TenkiIndependentVerificationError(
          "sandbox_failed",
          `Tenki could not verify the immutable PDD acceptance test byte-for-byte: ${generatedTest.path}.`,
        );
      }
    }

    const tests: AgentImplementationReport["tests"] = [];
    let passed = true;
    for (const command of context.promptSnapshot.ticket.requiredCommands) {
      if (!passed) {
        tests.push({
          command,
          status: "skipped",
          output: "Not run because an earlier independent verification command failed.",
        });
        continue;
      }
      const result = await session.exec("bash", {
        args: ["-c", command],
        cwd: verificationWorkingDirectory(profile),
        timeoutMs: Math.min(COMMAND_TIMEOUT_MS, sessionDurationMs),
        env: { CI: "true" },
      });
      passed = succeeded(result);
      tests.push({
        command,
        status: passed ? "passed" : "failed",
        output: output(result) || (passed ? "Command passed without output." : "Command failed without output."),
      });
    }

    const finishedAt = now();
    const independentVerification = {
      provider: "Tenki Sandbox" as const,
      sessionId: session.id,
      status: passed ? "passed" as const : "failed" as const,
      completedAt: new Date(finishedAt).toISOString(),
      durationMs: Math.max(0, finishedAt - startedAt),
    };
    return {
      ...report,
      status: passed ? "Tests passed" : "Failed",
      summary: passed
        ? `${report.summary} CloseSpan independently reran the approved commands in Tenki Sandbox.`.slice(0, 5_000)
        : "The implementation was not published because independent Tenki verification failed.",
      tests,
      criteria: verificationCriteria(context, report, passed, session.id),
      remainingRisks: passed
        ? report.remainingRisks
        : [
          ...report.remainingRisks.slice(0, 29),
          "Independent Tenki verification did not pass.",
        ],
      logs: [
        ...report.logs.slice(-199),
        `Tenki independent verification ${passed ? "passed" : "failed"} in session ${session.id}.`,
      ],
      independentVerification,
    };
  } catch (error) {
    if (error instanceof TenkiIndependentVerificationError) throw error;
    console.error("[tenki:independent-verification]", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    throw new TenkiIndependentVerificationError(
      "sandbox_failed",
      "Tenki could not complete independent verification.",
    );
  } finally {
    if (session) {
      try {
        await session.close();
      } catch (error) {
        cleanupError = error;
      }
    }
    client.close();
    if (cleanupError) {
      throw new TenkiIndependentVerificationError(
        "cleanup_failed",
        "Tenki verification completed, but CloseSpan could not confirm sandbox cleanup.",
      );
    }
  }
}
