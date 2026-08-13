import type { GithubRepositoryProfileDetection } from "./repository-profile-detection";
import {
  confirmDetectedExecutionProfile,
  listExecutionProfileSettings,
  type ExecutionProfileActor,
} from "./execution-profile-repository";
import {
  assertExecutionProfileReadyForActivation,
  assertTenkiProviderResourceLimits,
  executionProfileExecutor,
} from "./execution-profile";
import { assertManagedTenkiBootSourceAllowed } from "./tenki-environment-catalog-repository";
import {
  installTenkiRunnerWorkflow,
  TENKI_RUNNER_WORKFLOW_PATH,
} from "./tenki-github-actions-workflow";
import {
  getTenkiRunnerWorkflowSetup,
  markTenkiRunnerWorkflowSetupFailed,
  markTenkiRunnerWorkflowSetupInstalled,
  markTenkiRunnerWorkflowSetupPreparing,
  savePendingTenkiRunnerWorkflowSetup,
  type TenkiRunnerWorkflowSetupView,
} from "./tenki-runner-workflow-setup-repository";
import {
  getProfileTenkiRunnerSizingProbe,
  type TenkiRunnerSizingProbe,
} from "./tenki-runner-sizing-probe-repository";
import { queueAndDispatchTenkiRunnerSizingProbe } from "./tenki-runner-sizing-probe";
import type { TenkiWorkloadClass } from "./tenki-runner-sizing";

export function repositoryDetectionNeedsTenki(
  detection: GithubRepositoryProfileDetection,
): boolean {
  return detection.profiles.some(
    (profile) => profile.platform === "ios" || profile.platform === "android",
  );
}

export async function activateReadyDetectedExecutionProfiles(input: {
  orgId: string;
  repository: string;
  actor: ExecutionProfileActor;
}): Promise<number> {
  const settings = await listExecutionProfileSettings(input.orgId);
  const detected = settings.assignments
    .filter((assignment) => assignment.repository === input.repository
      && !assignment.automaticActivationDisabled)
    .map((assignment) => assignment.detectedProfile)
    .filter((profile) => profile !== null)
    .filter((profile) => {
      const confidence = profile.detectionEvidence.confidence;
      return typeof confidence === "number" && confidence >= 0.85;
    });
  let activated = 0;
  for (const profile of detected) {
    try {
      const executor = executionProfileExecutor(profile.config);
      if (executor.kind === "tenki_github_actions") {
        const probe = await getProfileTenkiRunnerSizingProbe(input.orgId, profile.id);
        const recommendationMatches = probe?.recommendedRunnerLabel === executor.runnerLabel;
        const commandSucceeded = probe?.telemetry?.exitCode === 0;
        if (probe?.status !== "Completed" || !recommendationMatches || !commandSucceeded) {
          continue;
        }
      }
      assertExecutionProfileReadyForActivation(profile.config);
      assertTenkiProviderResourceLimits(profile.config);
      await assertManagedTenkiBootSourceAllowed({
        orgId: input.orgId,
        repository: profile.repository,
        workspaceRoot: profile.workspaceRoot,
        config: profile.config,
      });
      await confirmDetectedExecutionProfile({
        orgId: input.orgId,
        detectedProfileId: profile.id,
        actor: input.actor,
      });
      activated += 1;
    } catch (error) {
      const waitingForWorkflow = error instanceof Error
        && error.message.includes("immutable runner workflow SHA-256");
      if (!waitingForWorkflow) throw error;
    }
  }
  return activated;
}

export async function prepareDetectedTenkiRunner(input: {
  orgId: string;
  installationId: string;
  repository: string;
  defaultBranch: string;
  detection: GithubRepositoryProfileDetection;
}): Promise<TenkiRunnerWorkflowSetupView | null> {
  if (!repositoryDetectionNeedsTenki(input.detection)) return null;
  const current = await getTenkiRunnerWorkflowSetup(input.orgId, input.repository);
  const preparingIsFresh = current?.status === "Preparing"
    && Date.now() - Date.parse(current.updatedAt) < 5 * 60_000;
  const sizingWorkflowInstalled = input.detection.profiles
    .filter((profile) => profile.platform === "ios" || profile.platform === "android")
    .every((profile) => Boolean(profile.runnerProbeWorkflowSha256));
  if (
    current?.status === "Pending"
    || (current?.status === "Installed" && sizingWorkflowInstalled)
    || preparingIsFresh
  ) {
    return current;
  }

  await markTenkiRunnerWorkflowSetupPreparing({
    orgId: input.orgId,
    repository: input.repository,
    workflowPath: TENKI_RUNNER_WORKFLOW_PATH,
  });
  try {
    const installation = await installTenkiRunnerWorkflow({
      installationId: input.installationId,
      repository: input.repository,
      defaultBranch: input.defaultBranch,
    });
    if (
      installation.status === "pull_request"
      && installation.pullRequestNumber
      && installation.pullRequestUrl
    ) {
      await savePendingTenkiRunnerWorkflowSetup({
        orgId: input.orgId,
        repository: input.repository,
        workflowPath: installation.workflowPath,
        pullRequestNumber: installation.pullRequestNumber,
        pullRequestUrl: installation.pullRequestUrl,
      });
    } else {
      await markTenkiRunnerWorkflowSetupInstalled({
        orgId: input.orgId,
        repository: input.repository,
        workflowPath: installation.workflowPath,
        pullRequestNumber: null,
        pullRequestUrl: null,
        mergedSha: input.detection.sourceSha,
      });
    }
  } catch (error) {
    await markTenkiRunnerWorkflowSetupFailed({
      orgId: input.orgId,
      repository: input.repository,
      workflowPath: TENKI_RUNNER_WORKFLOW_PATH,
      failureMessage: error instanceof Error
        ? error.message
        : "CloseSpan could not prepare the Tenki setup pull request",
    });
    throw error;
  }
  return getTenkiRunnerWorkflowSetup(input.orgId, input.repository);
}

function sizingEvidence(profile: { detectionEvidence: Record<string, unknown> }): {
  sourceSha: string;
  workflowSha256: string;
  workloadClass: TenkiWorkloadClass;
  workloadReasons: string[];
} | null {
  const evidence = profile.detectionEvidence;
  const sizing = evidence.runnerSizing;
  if (!sizing || typeof sizing !== "object" || Array.isArray(sizing)) return null;
  const record = sizing as Record<string, unknown>;
  const sourceSha = typeof evidence.sourceSha === "string" ? evidence.sourceSha : "";
  const workflowSha256 = typeof evidence.runnerProbeWorkflowSha256 === "string"
    ? evidence.runnerProbeWorkflowSha256
    : "";
  const workloadClass = record.workloadClass;
  if (
    !/^[a-f0-9]{40,64}$/.test(sourceSha)
    || !/^[a-f0-9]{64}$/.test(workflowSha256)
    || !["lightweight", "application", "build_heavy", "android_emulator", "ios_simulator"].includes(String(workloadClass))
  ) return null;
  return {
    sourceSha,
    workflowSha256,
    workloadClass: workloadClass as TenkiWorkloadClass,
    workloadReasons: Array.isArray(record.reasons)
      ? record.reasons.filter((reason): reason is string => typeof reason === "string")
      : [],
  };
}

export async function prepareTenkiRunnerSizingProbes(input: {
  orgId: string;
  installationId: string;
  repository: string;
  callbackBaseUrl: string;
}): Promise<TenkiRunnerSizingProbe[]> {
  const setup = await getTenkiRunnerWorkflowSetup(input.orgId, input.repository);
  if (setup?.status !== "Installed") return [];
  const settings = await listExecutionProfileSettings(input.orgId);
  const profiles = settings.assignments
    .filter((assignment) => assignment.repository === input.repository)
    .map((assignment) => assignment.detectedProfile)
    .filter((profile) => profile !== null)
    .filter((profile) => executionProfileExecutor(profile.config).kind === "tenki_github_actions");
  const probes: TenkiRunnerSizingProbe[] = [];
  for (const profile of profiles) {
    const evidence = sizingEvidence(profile);
    if (!evidence) continue;
    probes.push(await queueAndDispatchTenkiRunnerSizingProbe({
      orgId: input.orgId,
      installationId: input.installationId,
      profile,
      sourceSha: evidence.sourceSha,
      workflowSha256: evidence.workflowSha256,
      workloadClass: evidence.workloadClass,
      workloadReasons: evidence.workloadReasons,
      callbackBaseUrl: input.callbackBaseUrl,
    }));
  }
  return probes;
}
