import { NextRequest, NextResponse } from "next/server";
import {
  confirmDetectedExecutionProfile,
  getExecutionProfileVersion,
  listExecutionProfileSettings,
} from "@/lib/execution-profile-repository";
import { refreshPendingProblemRepositoryMatches } from "@/lib/problem-repository-match-repository";
import { updateGithubRepositoryExecutionBranch } from "@/lib/github-repository-allowlist";
import {
  authorizeAdminMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";
import { assertManagedTenkiBootSourceAllowed } from "@/lib/tenki-environment-catalog-repository";
import {
  assertExecutionProfileReadyForActivation,
  assertTenkiProviderResourceLimits,
  executionProfileExecutor,
} from "@/lib/execution-profile";
import { getProfileTenkiRunnerSizingProbe } from "@/lib/tenki-runner-sizing-probe-repository";
import {
  executionCompatibilityReadiness,
  executionCompatibilityRequirements,
} from "@/lib/execution-compatibility";

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const body = await request.json() as { detectedProfileId?: unknown; executionBranch?: unknown };
    if (
      typeof body.detectedProfileId !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(body.detectedProfileId)
    ) {
      throw new HttpError(400, "A detected execution profile is required");
    }
    const detected = await getExecutionProfileVersion(
      context.orgId,
      body.detectedProfileId,
    );
    if (!detected || detected.source !== "detected") {
      throw new HttpError(404, "Detected execution profile was not found");
    }
    await updateGithubRepositoryExecutionBranch({
      orgId: context.orgId,
      repository: detected.repository,
      executionBranch: body.executionBranch,
    });
    assertExecutionProfileReadyForActivation(detected.config);
    assertTenkiProviderResourceLimits(detected.config);
    await assertManagedTenkiBootSourceAllowed({
      orgId: context.orgId,
      repository: detected.repository,
      workspaceRoot: detected.workspaceRoot,
      config: detected.config,
    });
    const executor = executionProfileExecutor(detected.config);
    const probe = executor.kind === "tenki_github_actions"
      ? await getProfileTenkiRunnerSizingProbe(context.orgId, detected.id)
      : null;
    const hasCompatibilityContract = Boolean(
      executionCompatibilityRequirements(detected.detectionEvidence),
    );
    if (executor.kind === "tenki_github_actions" || hasCompatibilityContract) {
      const readiness = executionCompatibilityReadiness({ profile: detected, probe });
      if (readiness.status !== "compatible") {
        throw new HttpError(409, readiness.detail);
      }
    }
    const profile = await confirmDetectedExecutionProfile({
      orgId: context.orgId,
      detectedProfileId: body.detectedProfileId,
      actor: context,
    });
    const repositoryMatches = await refreshPendingProblemRepositoryMatches(context.orgId);
    return NextResponse.json(
      {
        profile,
        repositoryMatches,
        settings: await listExecutionProfileSettings(context.orgId),
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
