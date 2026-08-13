import { after, NextRequest, NextResponse } from "next/server";
import { setGithubWorkspaceRepositoryBindings } from "@/lib/github-installation-repository";
import { listGithubRepositoryAuthorizations } from "@/lib/github-repository-allowlist";
import {
  authorizeAdminMutation,
  authorizeRead,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";
import { detectAndSaveGithubRepositoryProfiles } from "@/lib/repository-profile-detection";
import {
  buildQueuedRepositoryContexts,
  queueRepositoryContexts,
} from "@/lib/repository-context-repository";
import {
  activateReadyDetectedExecutionProfiles,
  prepareDetectedTenkiRunner,
  prepareTenkiRunnerSizingProbes,
} from "@/lib/tenki-runner-onboarding";

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeRead(request);
    return NextResponse.json({ repositories: await listGithubRepositoryAuthorizations(context.orgId) }, { headers: noStoreHeaders });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const body = await request.json().catch(() => null) as {
      installationId?: unknown;
      repositories?: unknown;
    } | null;
    if (
      !body ||
      typeof body.installationId !== "string" ||
      !Array.isArray(body.repositories) ||
      body.repositories.some((repository) => typeof repository !== "string")
    ) {
      throw new HttpError(400, "A GitHub installation and repository list are required");
    }
    const result = await setGithubWorkspaceRepositoryBindings(
      context.orgId,
      body.installationId,
      body.repositories as string[],
      context,
    );
    const repositories = await listGithubRepositoryAuthorizations(context.orgId);
    const selected = repositories.filter(
      (repository) =>
        repository.installationId === body.installationId &&
        repository.workspaceSelected &&
        repository.active,
    );
    await queueRepositoryContexts({
      orgId: context.orgId,
      installationId: body.installationId,
      repositories: selected.map((repository) => ({
        repository: repository.repository,
        defaultBranch: repository.defaultBranch,
      })),
    });
    after(async () => {
      let failed = 0;
      for (let index = 0; index < selected.length; index += 2) {
        const outcomes = await Promise.allSettled(
          selected.slice(index, index + 2).map(async (repository) => {
            const detection = await detectAndSaveGithubRepositoryProfiles({
              orgId: context.orgId,
              installationId: repository.installationId,
              repository: repository.repository,
              defaultBranch: repository.defaultBranch,
              actor: {
                actorId: "system:workspace-repository-detector",
                actorName: "Repository profile detector",
                traceId: context.traceId,
              },
            });
            await prepareDetectedTenkiRunner({
              orgId: context.orgId,
              installationId: repository.installationId,
              repository: repository.repository,
              defaultBranch: repository.defaultBranch,
              detection,
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
              actor: {
                actorId: "system:workspace-repository-activator",
                actorName: "Repository execution activator",
                traceId: context.traceId,
              },
            });
          }),
        );
        failed += outcomes.filter((outcome) => outcome.status === "rejected").length;
      }
      if (failed) console.warn(`Execution profile detection needs retry for ${failed} selected repositories`);
      await buildQueuedRepositoryContexts(
        context.orgId,
        selected.map((repository) => repository.repository),
      );
    });
    return NextResponse.json(
      {
        ...result,
        repositories,
      },
      { headers: noStoreHeaders },
    );
  } catch (error) { return errorResponse(error); }
}
