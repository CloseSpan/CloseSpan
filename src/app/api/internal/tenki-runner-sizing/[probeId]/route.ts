import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  assertGithubActionsProbeIdentity,
  verifyGithubActionsOidcToken,
} from "@/lib/github-actions-oidc";
import {
  executionProfileExecutor,
  sanitizeExecutionProfileConfig,
  type ExecutionProfileConfigV3,
  type ExecutionProfileExecutor,
  type ExecutionProfileVersion,
} from "@/lib/execution-profile";
import {
  confirmDetectedExecutionProfile,
  getExecutionProfileVersion,
  saveDetectedExecutionProfileSuggestion,
} from "@/lib/execution-profile-repository";
import {
  completeTenkiRunnerSizingProbe,
  failTenkiRunnerSizingProbe,
  getTenkiRunnerSizingProbe,
  markTenkiRunnerSizingProbeRunning,
} from "@/lib/tenki-runner-sizing-probe-repository";
import {
  tenkiRunnerSize,
  tenkiRunnerTelemetrySchema,
  type TenkiRunnerTelemetry,
} from "@/lib/tenki-runner-sizing";
import { noStoreHeaders } from "@/lib/request-security";
import { listGithubRepositoryAuthorizations } from "@/lib/github-repository-allowlist";
import { queueAndDispatchTenkiRunnerSizingProbe } from "@/lib/tenki-runner-sizing-probe";
import { xcodeMajorCompatibilityCommand } from "@/lib/xcode-version-compatibility";
import {
  decideCompatibleRunnerProbeRetry,
  type CompatibleRunnerProbeCandidate,
  type RunnerProbeRetryDecision,
} from "@/lib/tenki-runner-probe-retry";
import type { TenkiRunnerSizingProbe } from "@/lib/tenki-runner-sizing-probe-repository";

export const maxDuration = 60;
const MAX_CALLBACK_BYTES = 128_000;

function shellArgument(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function bearerToken(request: NextRequest): string {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Error("Runner sizing requires GitHub OIDC authentication");
  return token;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function compatibleRunnerCandidates(
  profile: Pick<ExecutionProfileVersion, "detectionEvidence">,
): CompatibleRunnerProbeCandidate[] {
  const sizing = objectRecord(profile.detectionEvidence.runnerSizing);
  const candidates = Array.isArray(sizing.compatibleCandidates)
    ? sizing.compatibleCandidates
    : [];
  return candidates.filter((candidate): candidate is CompatibleRunnerProbeCandidate => {
    const record = objectRecord(candidate);
    return typeof record.label === "string"
      && typeof record.cpuCores === "number"
      && typeof record.memoryMb === "number";
  });
}

function completedProbeFailure(telemetry: TenkiRunnerTelemetry): {
  code: string;
  message: string;
  resourcePressure: boolean;
} | null {
  const resourcePressure = telemetry.exitCode === 137
    || telemetry.oomKilled
    || telemetry.memoryPressureRatio >= 0.9
    || telemetry.cpuSaturationRatio >= 0.9;
  if (telemetry.exitCode === 0 && !resourcePressure) return null;
  if (telemetry.oomKilled || telemetry.exitCode === 137) {
    return {
      code: "resource_pressure",
      message: `Probe exited ${telemetry.exitCode} after an out-of-memory condition`,
      resourcePressure,
    };
  }
  if (telemetry.timedOut) {
    return {
      code: "probe_timed_out",
      message: `Probe timed out after ${telemetry.durationMs} ms`,
      resourcePressure,
    };
  }
  if (telemetry.signal) {
    return {
      code: "probe_signal",
      message: `Probe stopped on signal ${telemetry.signal} with exit code ${telemetry.exitCode}`,
      resourcePressure,
    };
  }
  if (telemetry.exitCode !== 0) {
    return {
      code: "probe_command_failed",
      message: `A repository compatibility command exited with code ${telemetry.exitCode}`,
      resourcePressure,
    };
  }
  return {
    code: "resource_pressure",
    message: `Probe completed under sustained resource pressure (CPU ${Math.round(telemetry.cpuSaturationRatio * 100)}%, memory ${Math.round(telemetry.memoryPressureRatio * 100)}%)`,
    resourcePressure,
  };
}

type GithubActionsExecutor = Extract<ExecutionProfileExecutor, { kind: "tenki_github_actions" }>;

async function dispatchCompatibleRunnerRetry(input: {
  request: NextRequest;
  orgId: string;
  probe: TenkiRunnerSizingProbe;
  sourceProfile: ExecutionProfileVersion;
  currentConfig: ExecutionProfileConfigV3;
  executor: GithubActionsExecutor;
  decision: RunnerProbeRetryDecision;
  failureCode: string;
  failureMessage: string;
  telemetry?: TenkiRunnerTelemetry;
  githubWorkflowRunId?: number;
}) {
  const selected = input.decision.nextCandidate;
  if (!selected) throw new Error("Runner retry decision did not include a compatible candidate");
  const selectedCatalogSize = tenkiRunnerSize(selected.label);
  if (selectedCatalogSize && selectedCatalogSize.platform !== input.executor.platform) {
    throw new Error("Sizing retry is not valid for this execution platform");
  }
  const config: ExecutionProfileConfigV3 = {
    ...input.currentConfig,
    cpuCores: selectedCatalogSize?.cpuCores ?? selected.cpuCores,
    memoryMb: selectedCatalogSize?.memoryMb ?? selected.memoryMb,
    executor: { ...input.executor, runnerLabel: selected.label },
  };
  const existingSizing = objectRecord(input.sourceProfile.detectionEvidence.runnerSizing);
  const previousAttempts = Array.isArray(existingSizing.probeAttempts)
    ? existingSizing.probeAttempts.filter((attempt) => Object.keys(objectRecord(attempt)).length > 0)
    : [];
  const detected = await saveDetectedExecutionProfileSuggestion({
    orgId: input.orgId,
    repository: input.sourceProfile.repository,
    workspaceRoot: input.sourceProfile.workspaceRoot,
    config,
    detectionEvidence: {
      ...input.sourceProfile.detectionEvidence,
      runnerSizing: {
        ...existingSizing,
        probeId: input.probe.id,
        workloadClass: input.probe.workloadClass,
        baselineRunnerLabel: typeof existingSizing.baselineRunnerLabel === "string"
          ? existingSizing.baselineRunnerLabel
          : input.probe.runnerLabel,
        selectedRunnerLabel: selected.label,
        recommendationReasons: input.decision.recommendationReasons,
        compatibleCandidateCount: input.decision.compatibleCandidateCount,
        probeAttempts: [...previousAttempts, {
          probeId: input.probe.id,
          runnerLabel: input.probe.runnerLabel,
          failureCode: input.failureCode,
          failureMessage: input.failureMessage,
          attemptedCandidateNumber: input.decision.attemptedCandidateNumber,
          ...(input.telemetry ? { telemetry: input.telemetry } : {}),
          ...(input.githubWorkflowRunId ? { githubWorkflowRunId: input.githubWorkflowRunId } : {}),
        }].slice(-20),
      },
    },
    actor: { actorId: "system:tenki-runner-sizing" },
  });
  const authorization = (await listGithubRepositoryAuthorizations(input.orgId)).find(
    (repository) => repository.active && repository.repository === input.probe.repository,
  );
  if (!authorization) {
    throw new Error("The authorized repository for the compatible runner retry was not found");
  }
  const nextProbe = await queueAndDispatchTenkiRunnerSizingProbe({
    orgId: input.orgId,
    installationId: authorization.installationId,
    profile: detected,
    sourceSha: input.probe.sourceSha,
    workflowSha256: input.probe.workflowSha256,
    workloadClass: input.probe.workloadClass,
    workloadReasons: input.decision.recommendationReasons,
    callbackBaseUrl: input.request.nextUrl.origin,
  });
  return {
    ok: true,
    activated: false,
    selectedRunnerLabel: selected.label,
    nextProbeId: nextProbe.id,
    attemptedCandidateNumber: input.decision.attemptedCandidateNumber,
    compatibleCandidateCount: input.decision.compatibleCandidateCount,
  };
}

async function context(request: NextRequest, probeId: string, orgId: string) {
  const [claims, probe] = await Promise.all([
    verifyGithubActionsOidcToken(bearerToken(request)),
    getTenkiRunnerSizingProbe(orgId, probeId),
  ]);
  if (!probe) throw new Error("Tenki runner sizing probe was not found");
  assertGithubActionsProbeIdentity({
    claims,
    repository: probe.repository,
    probeId,
    workflowPath: probe.workflowPath,
  });
  return { claims, probe };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ probeId: string }> },
) {
  try {
    const orgId = request.nextUrl.searchParams.get("orgId")?.trim();
    if (!orgId) throw new Error("Runner sizing job request is missing the organization ID");
    const { probeId } = await params;
    const { probe } = await context(request, probeId, orgId);
    const profile = await getExecutionProfileVersion(orgId, probe.profileId);
    if (!profile || profile.contentHash !== probe.profileHash) {
      throw new Error("Runner sizing profile no longer matches the queued probe");
    }
    const executor = executionProfileExecutor(profile.config);
    if (executor.kind !== "tenki_github_actions" || executor.runnerLabel !== probe.runnerLabel) {
      throw new Error("Runner sizing profile does not match the selected Tenki runner");
    }
    const commandTimeoutMs = Math.min(
      15 * 60_000,
      Math.max(60_000, Math.floor(profile.config.maxDurationMs / Math.max(probe.probeCommands.length, 1))),
    );
    const environmentSetupCommands = executor.androidEmulator ? [
      `test -e /dev/kvm && sudo chmod 666 /dev/kvm`,
      `yes | sdkmanager 'system-images;android-${executor.androidEmulator.apiLevel};${executor.androidEmulator.target};${executor.androidEmulator.architecture}'`,
      `echo no | avdmanager create avd --force --name closespan --package 'system-images;android-${executor.androidEmulator.apiLevel};${executor.androidEmulator.target};${executor.androidEmulator.architecture}' --device ${shellArgument(executor.androidEmulator.deviceProfile)}`,
      `emulator -avd closespan -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect >/tmp/closespan-emulator.log 2>&1 & adb wait-for-device && for attempt in $(seq 1 90); do test "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 && exit 0; sleep 2; done; exit 1`,
    ] : executor.xcode ? [
      xcodeMajorCompatibilityCommand(executor.xcode.version),
    ] : [];
    return NextResponse.json({
      probeId,
      profileHash: probe.profileHash,
      sourceSha: probe.sourceSha,
      commands: [...environmentSetupCommands, ...probe.probeCommands],
      workingDirectory: probe.workingDirectory,
      cpuCores: profile.config.cpuCores,
      memoryLimitMb: profile.config.memoryMb,
      commandTimeoutMs,
    }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Runner sizing job request failed" },
      { status: 409, headers: noStoreHeaders },
    );
  }
}

const callbackSchema = z.object({
  orgId: z.string().trim().min(1),
  event: z.enum(["started", "completed", "failed"]),
  githubWorkflowRunId: z.number().int().positive().optional(),
  telemetry: tenkiRunnerTelemetrySchema.optional(),
  code: z.string().trim().min(1).max(120).optional(),
  message: z.string().trim().min(1).max(2_000).optional(),
}).strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ probeId: string }> },
) {
  try {
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_CALLBACK_BYTES) {
      return NextResponse.json({ error: "Runner sizing callback is too large" }, { status: 413, headers: noStoreHeaders });
    }
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_CALLBACK_BYTES) {
      return NextResponse.json({ error: "Runner sizing callback is too large" }, { status: 413, headers: noStoreHeaders });
    }
    const payload = callbackSchema.parse(JSON.parse(raw));
    const { probeId } = await params;
    const { claims, probe } = await context(request, probeId, payload.orgId);
    assertGithubActionsProbeIdentity({
      claims,
      repository: probe.repository,
      probeId,
      workflowPath: probe.workflowPath,
      ...(payload.githubWorkflowRunId ? { reportedWorkflowRunId: payload.githubWorkflowRunId } : {}),
    });
    if (payload.event === "started") {
      await markTenkiRunnerSizingProbeRunning({
        orgId: payload.orgId,
        probeId,
        githubWorkflowRunId: payload.githubWorkflowRunId,
      });
      return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
    }
    const sourceProfile = await getExecutionProfileVersion(payload.orgId, probe.profileId);
    if (!sourceProfile || sourceProfile.contentHash !== probe.profileHash) {
      throw new Error("Runner sizing profile no longer matches the callback probe");
    }
    const currentConfig = sanitizeExecutionProfileConfig(sourceProfile.config);
    const executor = executionProfileExecutor(currentConfig);
    if (currentConfig.schemaVersion !== 3 || executor.kind !== "tenki_github_actions") {
      throw new Error("Sizing probe is not bound to a GitHub Actions runner profile");
    }
    const compatibleCandidates = compatibleRunnerCandidates(sourceProfile);
    if (payload.event === "failed") {
      const failureCode = payload.code ?? "probe_failed";
      const failureMessage = payload.message ?? "The Tenki runner sizing probe did not return telemetry.";
      await failTenkiRunnerSizingProbe({
        orgId: payload.orgId,
        probeId,
        code: failureCode,
        message: failureMessage,
      });
      const decision = decideCompatibleRunnerProbeRetry({
        currentRunnerLabel: probe.runnerLabel,
        compatibleCandidates,
        failureCode,
        failureMessage,
      });
      if (!decision.retry) {
        return NextResponse.json({
          ok: true,
          activated: false,
          exhausted: decision.exhausted,
          reason: decision.recommendationReasons.at(-1),
        }, { headers: noStoreHeaders });
      }
      const result = await dispatchCompatibleRunnerRetry({
        request,
        orgId: payload.orgId,
        probe,
        sourceProfile,
        currentConfig,
        executor,
        decision,
        failureCode,
        failureMessage,
        githubWorkflowRunId: payload.githubWorkflowRunId,
      });
      return NextResponse.json(result, { headers: noStoreHeaders });
    }
    if (!payload.telemetry || !payload.githubWorkflowRunId) {
      throw new Error("Completed runner sizing callbacks require telemetry and the GitHub workflow run ID");
    }
    const failure = completedProbeFailure(payload.telemetry);
    const decision = failure ? decideCompatibleRunnerProbeRetry({
      currentRunnerLabel: probe.runnerLabel,
      compatibleCandidates,
      failureCode: failure.code,
      failureMessage: failure.message,
    }) : null;
    const completed = await completeTenkiRunnerSizingProbe({
      orgId: payload.orgId,
      probeId,
      telemetry: payload.telemetry,
      githubWorkflowRunId: payload.githubWorkflowRunId,
      ...(decision?.nextCandidate ? {
        recommendedRunnerLabel: decision.nextCandidate.label,
        recommendationReasons: decision.recommendationReasons,
      } : {}),
    });
    if (failure && !decision?.retry) {
      return NextResponse.json({
        ok: true,
        activated: false,
        exhausted: decision?.exhausted ?? false,
        reason: decision?.recommendationReasons.at(-1)
          ?? "No approved compatible runner alternative is available.",
      }, { headers: noStoreHeaders });
    }
    if (failure && decision?.retry) {
      const result = await dispatchCompatibleRunnerRetry({
        request,
        orgId: payload.orgId,
        probe,
        sourceProfile,
        currentConfig,
        executor,
        decision,
        failureCode: failure.code,
        failureMessage: failure.message,
        telemetry: payload.telemetry,
        githubWorkflowRunId: payload.githubWorkflowRunId,
      });
      return NextResponse.json(result, { headers: noStoreHeaders });
    }
    const existingRunnerSizing = sourceProfile.detectionEvidence.runnerSizing;
    const detected = await saveDetectedExecutionProfileSuggestion({
      orgId: payload.orgId,
      repository: sourceProfile.repository,
      workspaceRoot: sourceProfile.workspaceRoot,
      config: currentConfig,
      detectionEvidence: {
        ...sourceProfile.detectionEvidence,
        runnerSizing: {
          ...(existingRunnerSizing && typeof existingRunnerSizing === "object" && !Array.isArray(existingRunnerSizing)
            ? existingRunnerSizing
            : {}),
          probeId,
          workloadClass: probe.workloadClass,
          baselineRunnerLabel: objectRecord(existingRunnerSizing).baselineRunnerLabel ?? probe.runnerLabel,
          selectedRunnerLabel: probe.runnerLabel,
          recommendationReasons: completed.recommendationReasons,
          telemetry: payload.telemetry,
          githubWorkflowRunId: payload.githubWorkflowRunId,
        },
      },
      actor: { actorId: "system:tenki-runner-sizing" },
    });
    await confirmDetectedExecutionProfile({
      orgId: payload.orgId,
      detectedProfileId: detected.id,
      actor: { actorId: "system:tenki-runner-sizing" },
    });
    return NextResponse.json(
      { ok: true, activated: true, selectedRunnerLabel: probe.runnerLabel },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Runner sizing callback failed" },
      { status: 409, headers: noStoreHeaders },
    );
  }
}
