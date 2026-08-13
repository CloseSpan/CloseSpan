import { after, NextRequest, NextResponse } from "next/server";
import {
  assertTenkiGithubActionsPermissions,
  verifyGithubInstallation,
} from "@/lib/github-app-auth";
import { listGithubRepositoryAuthorizations } from "@/lib/github-repository-allowlist";
import { approveAndMergeTenkiRunnerWorkflow } from "@/lib/tenki-github-actions-workflow";
import { recordTenkiRunnerSetupApprovalEvent } from "@/lib/tenki-runner-setup-approval-repository";
import { markTenkiRunnerWorkflowSetupInstalled } from "@/lib/tenki-runner-workflow-setup-repository";
import { detectAndSaveGithubRepositoryProfiles } from "@/lib/repository-profile-detection";
import {
  activateReadyDetectedExecutionProfiles,
  prepareTenkiRunnerSizingProbes,
} from "@/lib/tenki-runner-onboarding";
import { refreshPendingProblemRepositoryMatches } from "@/lib/problem-repository-match-repository";
import {
  buildQueuedRepositoryContexts,
  queueRepositoryContexts,
} from "@/lib/repository-context-repository";
import {
  authorizeAdminMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const body = await request.json() as {
      repository?: unknown;
      pullRequestNumber?: unknown;
    };
    if (typeof body.repository !== "string") {
      throw new HttpError(400, "An authorized repository is required");
    }
    if (
      typeof body.pullRequestNumber !== "number"
      || !Number.isSafeInteger(body.pullRequestNumber)
      || body.pullRequestNumber < 1
    ) {
      throw new HttpError(400, "A valid runner setup pull request is required");
    }
    const repositories = await listGithubRepositoryAuthorizations(context.orgId);
    const repository = repositories.find(
      (candidate) => candidate.active && candidate.repository === body.repository,
    );
    if (!repository) throw new HttpError(404, "Authorized repository was not found");

    const installation = await verifyGithubInstallation(repository.installationId);
    assertTenkiGithubActionsPermissions(installation.permissions);
    const approval = {
      orgId: context.orgId,
      repository: repository.repository,
      pullRequestNumber: body.pullRequestNumber,
      actor: context,
    };
    await recordTenkiRunnerSetupApprovalEvent({
      ...approval,
      event: "approved",
    });
    let result;
    try {
      result = await approveAndMergeTenkiRunnerWorkflow({
        installationId: repository.installationId,
        repository: repository.repository,
        defaultBranch: repository.defaultBranch,
        pullRequestNumber: body.pullRequestNumber,
      });
    } catch (error) {
      await recordTenkiRunnerSetupApprovalEvent({
        ...approval,
        event: "failed",
        failureMessage: error instanceof Error ? error.message : "Unknown failure",
      }).catch(() => undefined);
      throw error;
    }
    await recordTenkiRunnerSetupApprovalEvent({
      ...approval,
      event: "merged",
      mergedSha: result.mergedSha,
    }).catch((error: unknown) => {
      console.error("[tenki:runner-setup] Merge outcome audit failed", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    });
    await markTenkiRunnerWorkflowSetupInstalled({
      orgId: context.orgId,
      repository: repository.repository,
      workflowPath: result.workflowPath,
      pullRequestNumber: result.pullRequestNumber,
      pullRequestUrl: result.pullRequestUrl,
      mergedSha: result.mergedSha,
    });
    await queueRepositoryContexts({
      orgId: context.orgId,
      installationId: repository.installationId,
      repositories: [{
        repository: repository.repository,
        defaultBranch: repository.defaultBranch,
      }],
    });
    let activationWarning: string | null = null;
    try {
      await detectAndSaveGithubRepositoryProfiles({
        orgId: context.orgId,
        installationId: repository.installationId,
        repository: repository.repository,
        defaultBranch: repository.defaultBranch,
        actor: context,
      });
      await prepareTenkiRunnerSizingProbes({
        orgId: context.orgId,
        installationId: repository.installationId,
        repository: repository.repository,
        callbackBaseUrl: request.nextUrl.origin,
      });
      await activateReadyDetectedExecutionProfiles({
        orgId: context.orgId,
        repository: repository.repository,
        actor: context,
      });
      await refreshPendingProblemRepositoryMatches(context.orgId);
    } catch (error) {
      activationWarning = error instanceof Error
        ? error.message
        : "Repository activation will retry from onboarding";
      console.warn("Tenki workflow merged; repository activation needs retry", {
        repository: repository.repository,
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
    after(async () => {
      await buildQueuedRepositoryContexts(context.orgId, [repository.repository])
        .catch((error: unknown) => {
          console.error("Repository context refresh after Tenki merge failed", {
            repository: repository.repository,
            errorType: error instanceof Error ? error.name : "UnknownError",
          });
        });
    });
    return NextResponse.json(
      { ...result, activationWarning },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
