import { NextRequest, NextResponse } from "next/server";
import {
  assertTenkiGithubActionsPermissions,
  verifyGithubInstallation,
} from "@/lib/github-app-auth";
import { listGithubRepositoryAuthorizations } from "@/lib/github-repository-allowlist";
import { installTenkiRunnerWorkflow } from "@/lib/tenki-github-actions-workflow";
import {
  markTenkiRunnerWorkflowSetupFailed,
  markTenkiRunnerWorkflowSetupInstalled,
  markTenkiRunnerWorkflowSetupPreparing,
  savePendingTenkiRunnerWorkflowSetup,
} from "@/lib/tenki-runner-workflow-setup-repository";
import { detectAndSaveGithubRepositoryProfiles } from "@/lib/repository-profile-detection";
import {
  activateReadyDetectedExecutionProfiles,
  prepareTenkiRunnerSizingProbes,
} from "@/lib/tenki-runner-onboarding";
import {
  authorizeAdminMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const body = await request.json() as { repository?: unknown };
    if (typeof body.repository !== "string") {
      throw new HttpError(400, "An authorized repository is required");
    }
    const repositories = await listGithubRepositoryAuthorizations(context.orgId);
    const repository = repositories.find(
      (candidate) => candidate.active && candidate.repository === body.repository,
    );
    if (!repository) {
      throw new HttpError(404, "Authorized repository was not found");
    }
    const installation = await verifyGithubInstallation(repository.installationId);
    assertTenkiGithubActionsPermissions(installation.permissions);
    const workflowPath = ".github/workflows/closespan-agent-runner.yml";
    await markTenkiRunnerWorkflowSetupPreparing({
      orgId: context.orgId,
      repository: repository.repository,
      workflowPath,
    });
    try {
      const result = await installTenkiRunnerWorkflow({
        installationId: repository.installationId,
        repository: repository.repository,
        defaultBranch: repository.defaultBranch,
      });
      if (result.status === "pull_request" && result.pullRequestNumber && result.pullRequestUrl) {
        await savePendingTenkiRunnerWorkflowSetup({
          orgId: context.orgId,
          repository: repository.repository,
          workflowPath: result.workflowPath,
          pullRequestNumber: result.pullRequestNumber,
          pullRequestUrl: result.pullRequestUrl,
        });
      } else {
        const detection = await detectAndSaveGithubRepositoryProfiles({
          orgId: context.orgId,
          installationId: repository.installationId,
          repository: repository.repository,
          defaultBranch: repository.defaultBranch,
          actor: context,
        });
        await markTenkiRunnerWorkflowSetupInstalled({
          orgId: context.orgId,
          repository: repository.repository,
          workflowPath: result.workflowPath,
          pullRequestNumber: null,
          pullRequestUrl: null,
          mergedSha: detection.sourceSha,
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
      }
      return NextResponse.json(result, { headers: noStoreHeaders });
    } catch (error) {
      await markTenkiRunnerWorkflowSetupFailed({
        orgId: context.orgId,
        repository: repository.repository,
        workflowPath,
        failureMessage: error instanceof Error
          ? error.message
          : "CloseSpan could not prepare the Tenki setup pull request",
      });
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
