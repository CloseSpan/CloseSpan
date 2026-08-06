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
  type ExecutionProfileConfigV2,
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
  type TenkiRuntimeEnvironmentConfig,
  type TenkiRuntimeEnvironmentDependencies,
  type TenkiRuntimeStatus,
} from "./tenki-runtime-environment";
import { runTenkiHostCommand } from "./tenki-host-command";
import { TenkiLiveReplayWitness } from "./tenki-live-replay-witness";

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
  | "id"
  | "exec"
  | "run"
  | "mkdir"
  | "writeFile"
  | "remove"
  | "exposePort"
  | "unexposePort"
  | "close"
  | "inboundEnabled"
  | "outboundEnabled"
  | "sourceSnapshotId"
  | "sourceRegistryImageId"
  | "sourceRegistryWorkspaceId"
  | "sourceRegistryRef"
>;

type VerificationClient = {
  createAndWait(options: Parameters<TenkiSandbox["createAndWait"]>[0]): Promise<VerificationSession>;
  close(): void;
};

export interface TenkiVerificationResolvedEnvironment {
  /** Resolved immediately before verification. These values must never be persisted in a job payload. */
  setupEnv: Readonly<Record<string, string>>;
  runtimeEnv: Readonly<Record<string, string>>;
  testEnv: Readonly<Record<string, string>>;
  redactionValues: readonly string[];
}

type VerificationRuntime = Pick<
  TenkiRuntimeEnvironment,
  "prepare" | "start" | "request" | "status" | "logs" | "close"
>;

export interface VerificationDependencies {
  apiKey?: string;
  now?: () => number;
  createClient?: (apiKey: string) => VerificationClient;
  repositoryArchive?: (context: AgentRunExecutionContext) => Promise<Uint8Array>;
  runtimeEnvironment?: TenkiVerificationResolvedEnvironment;
  createRuntimeEnvironment?: (
    session: VerificationSession,
    config: TenkiRuntimeEnvironmentConfig,
    dependencies: TenkiRuntimeEnvironmentDependencies,
  ) => VerificationRuntime;
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

type ConfiguredRuntimeProfile = ExecutionProfileConfigV2 & {
  startCommand: string;
  applicationPort: number;
  healthCheckPath: string;
};

function configuredRuntimeProfile(
  profile: ExecutionProfileConfig | null,
): ConfiguredRuntimeProfile | null {
  if (
    profile?.schemaVersion !== 2
    || !profile.startCommand
    || !profile.applicationPort
    || !profile.healthCheckPath
  ) {
    return null;
  }
  return profile as ConfiguredRuntimeProfile;
}

function resolvedVerificationEnvironment(
  profile: ExecutionProfileConfig | null,
  input: TenkiVerificationResolvedEnvironment | undefined,
): TenkiVerificationResolvedEnvironment {
  const bindings = profile?.schemaVersion === 2 ? profile.secretBindings : [];
  const resolved = input ?? {
    setupEnv: {},
    runtimeEnv: {},
    testEnv: {},
    redactionValues: [],
  };
  const phaseMaps = {
    setup: resolved.setupEnv,
    runtime: resolved.runtimeEnv,
    test: resolved.testEnv,
  } as const;

  for (const exposure of ["setup", "runtime", "test"] as const) {
    const expected = new Set(
      bindings
        .filter((binding) => binding.exposure === exposure)
        .map((binding) => binding.envName),
    );
    const actual = new Set(Object.keys(phaseMaps[exposure]));
    if (
      expected.size !== actual.size
      || [...expected].some((name) => !actual.has(name))
    ) {
      throw new TenkiIndependentVerificationError(
        "sandbox_failed",
        `Independent verification did not receive the exact ${exposure} secret bindings from the immutable execution profile.`,
      );
    }
  }
  return resolved;
}

function publicEnvironment(profile: ExecutionProfileConfig | null): Record<string, string> {
  if (profile?.schemaVersion !== 2) return {};
  return Object.fromEntries(
    profile.publicEnvironment.map(({ name, value }) => [name, value]),
  );
}

function approvedVerificationCommands(context: AgentRunExecutionContext): string[] {
  return [...new Set([
    ...context.promptSnapshot.ticket.requiredCommands,
    ...(context.generatedTests ?? []).map((test) => test.command),
  ])];
}

function runtimeConfig(
  profile: ExecutionProfileConfigV2,
): TenkiRuntimeEnvironmentConfig {
  return {
    workingDirectory: verificationWorkingDirectory(profile),
    install: {
      enabled: profile.automaticInstall,
      commands: profile.installCommands,
    },
    build: {
      enabled: profile.automaticBuild,
      commands: profile.buildCommands,
    },
    startCommand: profile.startCommand,
    port: profile.applicationPort,
    healthPath: profile.healthCheckPath,
    preview: {
      allowed: profile.previewEnabled && profile.allowInbound,
      ttlMs: Math.min(profile.previewTtlMs, 15 * 60_000),
    },
    commandTimeoutMs: Math.min(COMMAND_TIMEOUT_MS, profile.maxDurationMs),
    startupTimeoutMs: profile.healthCheckTimeoutMs,
    maxLogBytes: OUTPUT_LIMIT,
    maxResponseBytes: OUTPUT_LIMIT,
  };
}

function runtimeLogExcerpt(
  runtime: VerificationRuntime | undefined,
  redact: (value: string) => string,
): string[] {
  if (!runtime) return [];
  return runtime.logs(OUTPUT_LIMIT)
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-20)
    .map((line) => redact(line).slice(0, 5_000));
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
  const runtimeProfile = profile?.schemaVersion === 2 ? profile : null;
  const applicationProfile = configuredRuntimeProfile(profile);
  const generatedTests = context.generatedTests ?? [];
  const liveReplayRequired = generatedTests.length > 0
    && pddScenariosRequireLiveApplication(
      context.promptSnapshot.ticket.testScenarios,
    );
  if (
    liveReplayRequired
    && !pddGeneratedTestsReferenceLiveApplication(generatedTests)
  ) {
    throw new TenkiIndependentVerificationError(
      "sandbox_failed",
      "The immutable PDD live test does not reference CLOSESPAN_APP_URL.",
    );
  }
  if (liveReplayRequired && !applicationProfile) {
    throw new TenkiIndependentVerificationError(
      "sandbox_failed",
      "The immutable PDD live test requires a configured running application.",
    );
  }
  const resolvedEnvironment = resolvedVerificationEnvironment(
    profile,
    dependencies.runtimeEnvironment,
  );
  const redactor = createRuntimeSecretRedactor([
    ...Object.values(resolvedEnvironment.setupEnv),
    ...Object.values(resolvedEnvironment.runtimeEnv),
    ...Object.values(resolvedEnvironment.testEnv),
    ...resolvedEnvironment.redactionValues,
  ]);
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
  let observedBootSource: TenkiBootSourceEvidence = {
    sourceSnapshotId: null,
    sourceRegistryImageId: null,
    sourceRegistryWorkspaceId: null,
    sourceRegistryRef: null,
  };
  let runtime: VerificationRuntime | undefined;
  let liveReplayWitness: TenkiLiveReplayWitness | undefined;
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
    try {
      observedBootSource = attestTenkiBootSource(session, {
        tenkiSnapshotId: profile?.tenkiSnapshotId,
        tenkiImage: profile?.tenkiImage,
      });
    } catch {
      throw new TenkiIndependentVerificationError(
        "sandbox_failed",
        "Tenki verification boot source does not match the immutable execution profile.",
      );
    }
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

    const runtimeInteractions: NonNullable<AgentImplementationReport["runtimeEvidence"]>["interactions"] = [];
    let runtimeStatus: TenkiRuntimeStatus | undefined;
    let runtimeFailure: string | undefined;
    if (runtimeProfile) {
      const sharedPublicEnvironment = publicEnvironment(runtimeProfile);
      runtime = (dependencies.createRuntimeEnvironment ?? createTenkiRuntimeEnvironment)(
        session,
        runtimeConfig(runtimeProfile),
        {
          setupEnv: {
            ...sharedPublicEnvironment,
            ...resolvedEnvironment.setupEnv,
          },
          rerunEnv: {
            ...sharedPublicEnvironment,
            CI: "true",
          },
          runtimeEnv: {
            ...sharedPublicEnvironment,
            ...resolvedEnvironment.runtimeEnv,
            ...(applicationProfile
              ? { PORT: String(applicationProfile.applicationPort) }
              : {}),
          },
          redactionValues: resolvedEnvironment.redactionValues,
        },
      );
      try {
        // The only setup-secret-bearing operation runs against the immutable
        // repository archive, before any agent-authored change is applied.
        await runtime.prepare({
          runInstall: runtimeProfile.automaticInstall,
          runBuild: false,
        });
      } catch (error) {
        runtimeFailure = redactor.redact(
          error instanceof Error ? error.message : "The trusted dependency bootstrap failed.",
        ).slice(0, 5_000);
        runtimeInteractions.push({
          stage: "verification",
          tool: "setup",
          target: "trusted dependency bootstrap",
          status: "failed",
          evidence: runtimeFailure,
        });
      }
    }

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

    if (runtimeProfile && runtime && runtimeFailure === undefined) {
      try {
        // Agent-authored code may build and start only after setup secrets have
        // been permanently removed from the command environment.
        await runtime.prepare({
          runInstall: false,
          runBuild: runtimeProfile.automaticBuild,
        });
        if (applicationProfile) {
          runtimeStatus = await runtime.start();
          if (!runtimeStatus.healthy) {
            throw new Error("the configured application did not become healthy");
          }
          const health = await runtime.request({
            method: "GET",
            path: applicationProfile.healthCheckPath,
          });
          if (health.statusCode < 200 || health.statusCode >= 400) {
            throw new Error(`the configured health check returned HTTP ${health.statusCode}`);
          }
          runtimeInteractions.push({
            stage: "verification",
            tool: "http",
            target: applicationProfile.healthCheckPath,
            status: `HTTP ${health.statusCode}`,
            evidence: "Independent verification reached the running application over VM-local HTTP.",
          });
          if (runtimeStatus.previewUrl) {
            runtimeInteractions.push({
              stage: "verification",
              tool: "preview",
              target: runtimeStatus.previewUrl,
              status: "preview ready",
              evidence: "Tenki exposed the configured application through a short-lived preview URL.",
            });
          }
        } else if (runtimeProfile.automaticInstall || runtimeProfile.automaticBuild) {
          runtimeInteractions.push({
            stage: "verification",
            tool: "setup",
            target: "automatic setup",
            status: "passed",
            evidence: "Independent verification completed trusted dependency bootstrap and the public-only build commands.",
          });
        }
      } catch (error) {
        runtimeFailure = redactor.redact(
          error instanceof Error ? error.message : "The configured runtime failed to prepare.",
        ).slice(0, 5_000);
        if (applicationProfile) {
          runtimeInteractions.push({
            stage: "verification",
            tool: "http",
            target: applicationProfile.healthCheckPath,
            status: "failed",
            evidence: runtimeFailure,
          });
        } else {
          runtimeInteractions.push({
            stage: "verification",
            tool: "setup",
            target: "automatic setup",
            status: "failed",
            evidence: runtimeFailure,
          });
        }
      }
    }

    const tests: AgentImplementationReport["tests"] = [];
    let passed = runtimeFailure === undefined;
    let testEnvironment = {
      ...publicEnvironment(profile),
      ...resolvedEnvironment.testEnv,
      CI: "true",
      ...(applicationProfile && runtimeStatus?.healthy
        ? { CLOSESPAN_APP_URL: `http://127.0.0.1:${applicationProfile.applicationPort}` }
        : {}),
    };
    let liveReplayRequestCount = 0;
    if (
      liveReplayRequired
      && applicationProfile
      && runtimeStatus?.healthy
      && runtimeFailure === undefined
    ) {
      try {
        liveReplayWitness = new TenkiLiveReplayWitness(
          session,
          applicationProfile.applicationPort,
          applicationProfile.healthCheckPath,
          verificationWorkingDirectory(profile),
          resolvedEnvironment.redactionValues,
        );
        testEnvironment = {
          ...testEnvironment,
          CLOSESPAN_APP_URL: await liveReplayWitness.start(),
        };
      } catch (error) {
        runtimeFailure = redactor.redact(
          error instanceof Error
            ? error.message
            : "The VM-local replay witness could not start.",
        ).slice(0, 5_000);
        passed = false;
      }
    }
    for (const command of approvedVerificationCommands(context)) {
      if (!passed) {
        tests.push({
          command,
          status: "skipped",
          output: runtimeFailure
            ? "Not run because the configured application did not become healthy."
            : "Not run because an earlier independent verification command failed.",
        });
        continue;
      }
      const result = await runTenkiHostCommand(session, ["bash", "-c", command], {
        cwd: verificationWorkingDirectory(profile),
        env: testEnvironment,
        timeoutMs: Math.min(COMMAND_TIMEOUT_MS, sessionDurationMs),
      });
      passed = result.exitCode === 0 && !result.signal && !result.timedOut;
      const safeOutput = redactor.redact([
        new TextDecoder().decode(result.stdout).trim(),
        new TextDecoder().decode(result.stderr).trim(),
      ].filter(Boolean).join("\n")).slice(-OUTPUT_LIMIT);
      tests.push({
        command,
        status: passed ? "passed" : "failed",
        output: safeOutput || (passed ? "Command passed without output." : "Command failed without output."),
      });
    }
    if (liveReplayWitness) {
      liveReplayRequestCount = await liveReplayWitness.requestCount();
      await liveReplayWitness.close();
      liveReplayWitness = undefined;
    }

    if (applicationProfile && runtime && runtimeFailure === undefined) {
      try {
        runtimeStatus = await runtime.status();
        if (!runtimeStatus.healthy) {
          runtimeFailure = "The configured application stopped responding before verification completed.";
          passed = false;
          runtimeInteractions.push({
            stage: "verification",
            tool: "http",
            target: applicationProfile?.healthCheckPath ?? "/",
            status: "failed",
            evidence: runtimeFailure,
          });
        }
      } catch (error) {
        runtimeFailure = redactor.redact(
          error instanceof Error ? error.message : "The final application health check failed.",
        ).slice(0, 5_000);
        passed = false;
        runtimeInteractions.push({
          stage: "verification",
          tool: "http",
          target: applicationProfile?.healthCheckPath ?? "/",
          status: "failed",
          evidence: runtimeFailure,
        });
      }
    }

    const generatedCommands = new Set(
      (context.generatedTests ?? []).map((generatedTest) => generatedTest.command),
    );
    const testByCommand = new Map(tests.map((test) => [test.command, test]));
    const userStoryReplay = generatedCommands.size === 0
      ? "not_required" as const
      : [...generatedCommands].every(
          (command) => testByCommand.get(command)?.status === "passed",
        )
        && runtimeFailure === undefined
        && (!liveReplayRequired || liveReplayRequestCount > 0)
        ? "passed" as const
        : "failed" as const;
    if (liveReplayRequired) {
      runtimeInteractions.push({
        stage: "verification",
        tool: "http",
        target: "CLOSESPAN_APP_URL",
        status: userStoryReplay === "passed"
          ? "PDD live replay passed"
          : "PDD live replay failed",
        evidence: userStoryReplay === "passed"
          ? `The immutable PDD test made ${liveReplayRequestCount} witnessed request(s) to the healthy VM-local application and its approved command passed independently.`
          : "The immutable PDD live test did not make a witnessed VM-local request, or the application/test did not pass independent verification.",
      });
    }
    const logExcerpt = runtimeLogExcerpt(runtime, redactor.redact);
    if (applicationProfile?.runtimeTools.logs && runtime) {
      runtimeInteractions.push({
        stage: "verification",
        tool: "logs",
        target: "application stdout/stderr",
        status: `${logExcerpt.length} bounded lines captured`,
        evidence: "Runtime output was bounded and secret-redacted before inclusion in verification evidence.",
      });
    }
    const implementationInteractions = (report.runtimeEvidence?.interactions ?? []).map(
      (interaction) => ({
        ...interaction,
        stage: interaction.stage ?? "implementation" as const,
      }),
    );
    const preservedImplementationInteractions = implementationInteractions.slice(
      -Math.max(0, 100 - runtimeInteractions.length),
    );
    const runtimeEvidence: AgentImplementationReport["runtimeEvidence"] = runtimeProfile
      ? {
          configured: applicationProfile !== null,
          healthStatus: applicationProfile === null
            ? "not_configured"
            : runtimeFailure === undefined
              ? "passed"
              : "failed",
          applicationPort: applicationProfile?.applicationPort ?? null,
          previewUrl: runtimeStatus?.previewUrl ?? null,
          ...observedBootSource,
          interactions: [
            ...preservedImplementationInteractions,
            ...runtimeInteractions,
          ].slice(-100),
          logExcerpt,
          userStoryReplay,
          userStoryReplayMode: generatedCommands.size === 0
            ? "not_required"
            : liveReplayRequired
              ? "live_application"
              : "contract",
        }
      : undefined;

    const finishedAt = now();
    const independentVerification = {
      provider: "Tenki Sandbox" as const,
      sessionId: session.id,
      ...observedBootSource,
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
      ...(runtimeEvidence ? { runtimeEvidence } : {}),
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
    if (liveReplayWitness) {
      try {
        await liveReplayWitness.close();
      } catch (error) {
        cleanupError = error;
      }
    }
    if (runtime) {
      try {
        await runtime.close();
      } catch (error) {
        cleanupError = error;
      }
    }
    if (session) {
      try {
        await session.close();
      } catch (error) {
        cleanupError ??= error;
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
