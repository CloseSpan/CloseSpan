import { NextRequest, NextResponse } from "next/server";
import { listExecutionProfileSettings } from "@/lib/execution-profile-repository";
import { listGithubRepositoryAuthorizations } from "@/lib/github-repository-allowlist";
import { refreshPendingProblemRepositoryMatches } from "@/lib/problem-repository-match-repository";
import { detectAndSaveGithubRepositoryProfiles } from "@/lib/repository-profile-detection";
import { activateReadyDetectedExecutionProfiles } from "@/lib/tenki-runner-onboarding";
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

    const detection = await detectAndSaveGithubRepositoryProfiles({
      orgId: context.orgId,
      installationId: repository.installationId,
      repository: repository.repository,
      defaultBranch: repository.defaultBranch,
      actor: context,
    });
    const activatedProfiles = await activateReadyDetectedExecutionProfiles({
      orgId: context.orgId,
      repository: repository.repository,
      actor: { ...context, actorId: "system:repository-detector" },
    });
    const repositoryMatches = await refreshPendingProblemRepositoryMatches(context.orgId);
    return NextResponse.json(
      {
        detection,
        activatedProfiles,
        repositoryMatches,
        settings: await listExecutionProfileSettings(context.orgId),
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
