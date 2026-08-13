import { NextRequest, NextResponse } from "next/server";
import { executionProfileExecutor } from "@/lib/execution-profile";
import { listExecutionProfileSettings } from "@/lib/execution-profile-repository";
import { listGithubRepositoryAuthorizations } from "@/lib/github-repository-allowlist";
import {
  authorizeAdminMutation,
  authorizeRead,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";
import { listTenkiRunnerWorkflowSetups } from "@/lib/tenki-runner-workflow-setup-repository";
import { listTenkiRunnerSizingProbes } from "@/lib/tenki-runner-sizing-probe-repository";
import { workspacePersistenceMode } from "@/lib/workspace-persistence";
import { detectAndSaveGithubRepositoryProfiles } from "@/lib/repository-profile-detection";
import {
  activateReadyDetectedExecutionProfiles,
  prepareDetectedTenkiRunner,
  prepareTenkiRunnerSizingProbes,
} from "@/lib/tenki-runner-onboarding";
import { refreshPendingProblemRepositoryMatches } from "@/lib/problem-repository-match-repository";

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeRead(request);
    const repositories = (await listGithubRepositoryAuthorizations(context.orgId))
      .filter((repository) => repository.active && repository.workspaceSelected);
    if (workspacePersistenceMode(context.orgId) !== "postgres") {
      return NextResponse.json(
        { repositories: [] },
        { headers: noStoreHeaders },
      );
    }
    const [settings, setups, probes] = await Promise.all([
      listExecutionProfileSettings(context.orgId),
      listTenkiRunnerWorkflowSetups(context.orgId),
      listTenkiRunnerSizingProbes(context.orgId),
    ]);
    const setupByRepository = new Map(
      setups.map((setup) => [setup.repository, setup] as const),
    );
    return NextResponse.json({
      repositories: repositories.map((repository) => {
        const assignments = settings.assignments.filter(
          (assignment) => assignment.repository === repository.repository,
        );
        const profiles = assignments.flatMap((assignment) => [
          assignment.activeProfile,
          assignment.detectedProfile,
        ]).filter((profile) => profile !== null);
        return {
          repository: repository.repository,
          defaultBranch: repository.defaultBranch,
          profileDetected: profiles.length > 0,
          executionReady: assignments.some((assignment) => assignment.activeProfile),
          tenkiRequired: profiles.some(
            (profile) => executionProfileExecutor(profile.config).kind === "tenki_github_actions",
          ),
          setup: setupByRepository.get(repository.repository) ?? null,
          sizingProbes: probes.filter((probe) => probe.repository === repository.repository),
        };
      }),
    }, { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const body = await request.json().catch(() => null) as { repository?: unknown } | null;
    if (!body || typeof body.repository !== "string") {
      throw new HttpError(400, "An authorized repository is required");
    }
    const repository = (await listGithubRepositoryAuthorizations(context.orgId)).find(
      (candidate) => candidate.active
        && candidate.workspaceSelected
        && candidate.repository === body.repository,
    );
    if (!repository) throw new HttpError(404, "Authorized repository was not found");
    const detection = await detectAndSaveGithubRepositoryProfiles({
      orgId: context.orgId,
      installationId: repository.installationId,
      repository: repository.repository,
      defaultBranch: repository.defaultBranch,
      actor: context,
    });
    const setup = await prepareDetectedTenkiRunner({
      orgId: context.orgId,
      installationId: repository.installationId,
      repository: repository.repository,
      defaultBranch: repository.defaultBranch,
      detection,
    });
    const sizingProbes = await prepareTenkiRunnerSizingProbes({
      orgId: context.orgId,
      installationId: repository.installationId,
      repository: repository.repository,
      callbackBaseUrl: request.nextUrl.origin,
    });
    const activatedProfiles = await activateReadyDetectedExecutionProfiles({
      orgId: context.orgId,
      repository: repository.repository,
      actor: context,
    });
    await refreshPendingProblemRepositoryMatches(context.orgId);
    return NextResponse.json(
      { setup, sizingProbes, activatedProfiles },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
