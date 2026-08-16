import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  assertGithubActionsProbeIdentity,
  verifyGithubActionsOidcToken,
} from "@/lib/github-actions-oidc";
import {
  executionProfileExecutor,
  sanitizeExecutionProfileConfig,
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
} from "@/lib/tenki-runner-sizing";
import { noStoreHeaders } from "@/lib/request-security";
import { listGithubRepositoryAuthorizations } from "@/lib/github-repository-allowlist";
import { queueAndDispatchTenkiRunnerSizingProbe } from "@/lib/tenki-runner-sizing-probe";
import { xcodeMajorCompatibilityCommand } from "@/lib/xcode-version-compatibility";

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
    if (payload.event === "failed") {
      await failTenkiRunnerSizingProbe({
        orgId: payload.orgId,
        probeId,
        code: payload.code ?? "probe_failed",
        message: payload.message ?? "The Tenki runner sizing probe did not return telemetry.",
      });
      return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
    }
    if (!payload.telemetry || !payload.githubWorkflowRunId) {
      throw new Error("Completed runner sizing callbacks require telemetry and the GitHub workflow run ID");
    }
    const sourceProfile = await getExecutionProfileVersion(payload.orgId, probe.profileId);
    if (!sourceProfile || sourceProfile.contentHash !== probe.profileHash) {
      throw new Error("Runner sizing profile no longer matches the completed probe");
    }
    const currentConfig = sanitizeExecutionProfileConfig(sourceProfile.config);
    const executor = executionProfileExecutor(currentConfig);
    if (executor.kind !== "tenki_github_actions") {
      throw new Error("Completed sizing probe is not bound to a GitHub Actions runner profile");
    }
    const resourceFailure = payload.telemetry.exitCode === 137
      || payload.telemetry.oomKilled
      || payload.telemetry.memoryPressureRatio >= 0.9
      || payload.telemetry.cpuSaturationRatio >= 0.9;
    const runnerSizing = sourceProfile.detectionEvidence.runnerSizing;
    const compatibleCandidates = runnerSizing && typeof runnerSizing === "object" && !Array.isArray(runnerSizing)
      && "compatibleCandidates" in runnerSizing && Array.isArray(runnerSizing.compatibleCandidates)
      ? runnerSizing.compatibleCandidates.filter((candidate): candidate is {
          label: string;
          cpuCores: number;
          memoryMb: number;
        } => Boolean(candidate) && typeof candidate === "object" && !Array.isArray(candidate)
          && "label" in candidate && typeof candidate.label === "string"
          && "cpuCores" in candidate && typeof candidate.cpuCores === "number"
          && "memoryMb" in candidate && typeof candidate.memoryMb === "number")
      : [];
    const currentCandidateIndex = compatibleCandidates.findIndex(
      (candidate) => candidate.label === probe.runnerLabel,
    );
    const nextInventoryCandidate = resourceFailure && currentCandidateIndex >= 0
      ? compatibleCandidates[currentCandidateIndex + 1]
      : undefined;
    const completed = await completeTenkiRunnerSizingProbe({
      orgId: payload.orgId,
      probeId,
      telemetry: payload.telemetry,
      githubWorkflowRunId: payload.githubWorkflowRunId,
      ...(nextInventoryCandidate ? {
        recommendedRunnerLabel: nextInventoryCandidate.label,
        recommendationReasons: [
          `Runner telemetry exceeded the verified capacity of ${probe.runnerLabel}`,
          `Retry on the next compatible enabled runner ${nextInventoryCandidate.label}`,
        ],
      } : {}),
    });
    if (payload.telemetry.exitCode !== 0 && !resourceFailure) {
      return NextResponse.json({ ok: true, activated: false }, { headers: noStoreHeaders });
    }
    if (
      payload.telemetry.exitCode !== 0
      && completed.recommendedRunnerLabel === probe.runnerLabel
    ) {
      return NextResponse.json({
        ok: true,
        activated: false,
        reason: "The workload still exceeds the largest available runner for this platform.",
      }, { headers: noStoreHeaders });
    }
    const selectedLabel = completed.recommendedRunnerLabel ?? executor.runnerLabel;
    const selectedSize = tenkiRunnerSize(selectedLabel);
    const selectedInventoryCandidate = compatibleCandidates.find(
      (candidate) => candidate.label === selectedLabel,
    );
    if (selectedSize && selectedSize.platform !== executor.platform) {
      throw new Error("Sizing recommendation is not valid for this execution platform");
    }
    if (resourceFailure && selectedLabel === probe.runnerLabel) {
      return NextResponse.json({
        ok: true,
        activated: false,
        reason: "The selected runner exhausted its verified capacity and no larger compatible runner is available in the active inventory.",
      }, { headers: noStoreHeaders });
    }
    const config = {
      ...currentConfig,
      cpuCores: selectedSize?.cpuCores ?? selectedInventoryCandidate?.cpuCores ?? currentConfig.cpuCores,
      memoryMb: selectedSize?.memoryMb ?? selectedInventoryCandidate?.memoryMb ?? currentConfig.memoryMb,
      executor: { ...executor, runnerLabel: selectedLabel },
    };
    const existingRunnerSizing = sourceProfile.detectionEvidence.runnerSizing;
    const detected = await saveDetectedExecutionProfileSuggestion({
      orgId: payload.orgId,
      repository: sourceProfile.repository,
      workspaceRoot: sourceProfile.workspaceRoot,
      config,
      detectionEvidence: {
        ...sourceProfile.detectionEvidence,
        runnerSizing: {
          ...(existingRunnerSizing && typeof existingRunnerSizing === "object" && !Array.isArray(existingRunnerSizing)
            ? existingRunnerSizing
            : {}),
          probeId,
          workloadClass: probe.workloadClass,
          baselineRunnerLabel: probe.runnerLabel,
          selectedRunnerLabel: selectedLabel,
          recommendationReasons: completed.recommendationReasons,
          telemetry: payload.telemetry,
          githubWorkflowRunId: payload.githubWorkflowRunId,
        },
      },
      actor: { actorId: "system:tenki-runner-sizing" },
    });
    if (resourceFailure && selectedLabel !== probe.runnerLabel) {
      const authorization = (await listGithubRepositoryAuthorizations(payload.orgId)).find(
        (repository) => repository.active && repository.repository === probe.repository,
      );
      if (!authorization) {
        throw new Error("The authorized repository for the recommended runner probe was not found");
      }
      const nextProbe = await queueAndDispatchTenkiRunnerSizingProbe({
        orgId: payload.orgId,
        installationId: authorization.installationId,
        profile: detected,
        sourceSha: probe.sourceSha,
        workflowSha256: probe.workflowSha256,
        workloadClass: probe.workloadClass,
        workloadReasons: completed.recommendationReasons,
        callbackBaseUrl: request.nextUrl.origin,
      });
      return NextResponse.json({
        ok: true,
        activated: false,
        selectedRunnerLabel: selectedLabel,
        nextProbeId: nextProbe.id,
      }, { headers: noStoreHeaders });
    }
    await confirmDetectedExecutionProfile({
      orgId: payload.orgId,
      detectedProfileId: detected.id,
      actor: { actorId: "system:tenki-runner-sizing" },
    });
    return NextResponse.json(
      { ok: true, activated: true, selectedRunnerLabel: selectedLabel },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Runner sizing callback failed" },
      { status: 409, headers: noStoreHeaders },
    );
  }
}
