import { NextRequest, NextResponse } from "next/server";
import {
  listExecutionProfileSettings,
  listProblemRepositoryMatches,
} from "@/lib/execution-profile-repository";
import { listGithubRepositoryAuthorizations } from "@/lib/github-repository-allowlist";
import type {
  ProblemRepositoryMatchReviewResponse,
  ProblemRepositoryMatchReviewView,
} from "@/lib/problem-repository-match-review";
import {
  confirmProblemRepositoryMatch,
  getActiveConfirmedProblemRepositoryMatch,
  refreshProblemRepositoryMatch,
  rejectProblemRepositoryMatch,
  requireProblemRepositoryMatchProblem,
  type ProblemRepositoryMatchRefreshResult,
} from "@/lib/problem-repository-match-repository";
import { detectAndSaveGithubRepositoryProfiles } from "@/lib/repository-profile-detection";
import {
  authorizeMutation,
  authorizeRead,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";
import { workspacePersistenceMode } from "@/lib/workspace-persistence";

type ReviewRole = { role: string; orgId: string };

async function reviewView(
  context: ReviewRole,
  problemId: string,
  refresh: ProblemRepositoryMatchRefreshResult | null = null,
): Promise<ProblemRepositoryMatchReviewView> {
  const canReview = ["Admin", "Contributor"].includes(context.role);
  if (workspacePersistenceMode(context.orgId) !== "postgres") {
    return {
      available: false,
      canReview,
      canRefreshDetection: context.role === "Admin",
      repositories: [],
      assignments: [],
      matches: [],
      confirmedMatch: null,
      // The seeded memory workspace does not run live PDD and keeps its
      // existing guided-demo behavior.
      pddProfileReady: true,
      refresh: null,
    };
  }

  await requireProblemRepositoryMatchProblem(context.orgId, problemId);
  const [settings, repositories, matches, confirmedMatch] = await Promise.all([
    listExecutionProfileSettings(context.orgId),
    listGithubRepositoryAuthorizations(context.orgId),
    listProblemRepositoryMatches(context.orgId, problemId),
    getActiveConfirmedProblemRepositoryMatch(context.orgId, problemId),
  ]);
  const activeRepositories = repositories.filter((repository) => repository.active);
  const authorizedNames = new Set(
    activeRepositories.map((repository) => repository.repository),
  );
  return {
    available: true,
    canReview,
    canRefreshDetection: context.role === "Admin",
    repositories: activeRepositories,
    assignments: settings.assignments.filter((assignment) =>
      authorizedNames.has(assignment.repository)
    ),
    matches,
    confirmedMatch,
    pddProfileReady: Boolean(confirmedMatch),
    refresh,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ problemId: string }> },
) {
  try {
    const [context, { problemId }] = await Promise.all([
      authorizeRead(request),
      params,
    ]);
    return NextResponse.json(
      await reviewView(context, problemId),
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ problemId: string }> },
) {
  try {
    const context = await authorizeMutation(request);
    const { problemId } = await params;
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 16_000) {
      return NextResponse.json(
        { error: "Repository review payload is too large" },
        { status: 413, headers: noStoreHeaders },
      );
    }
    const body = await request.json() as {
      action?: unknown;
      repository?: unknown;
      workspaceRoot?: unknown;
      profileId?: unknown;
    };
    if (!body || typeof body !== "object") {
      throw new HttpError(400, "Repository review action is required");
    }

    let refresh: ProblemRepositoryMatchRefreshResult | null = null;
    let confirmation: ProblemRepositoryMatchReviewResponse["confirmation"];
    let rejectedMatch: ProblemRepositoryMatchReviewResponse["rejectedMatch"];

    if (body.action === "refresh") {
      if (context.role !== "Admin") {
        throw new HttpError(
          403,
          "Administrator permission is required to refresh repository detection",
        );
      }
      if (typeof body.repository !== "string") {
        throw new HttpError(400, "An authorized repository is required");
      }
      const repositories = await listGithubRepositoryAuthorizations(context.orgId);
      const repository = repositories.find(
        (candidate) =>
          candidate.active && candidate.repository === body.repository,
      );
      if (!repository) {
        throw new HttpError(404, "Authorized repository was not found");
      }
      await detectAndSaveGithubRepositoryProfiles({
        orgId: context.orgId,
        installationId: repository.installationId,
        repository: repository.repository,
        defaultBranch: repository.defaultBranch,
        actor: context,
      });
      refresh = await refreshProblemRepositoryMatch(context.orgId, problemId);
    } else if (body.action === "confirm") {
      if (
        typeof body.profileId !== "string" ||
        !/^[a-f0-9-]{36}$/i.test(body.profileId) ||
        (body.repository !== undefined && typeof body.repository !== "string") ||
        (body.workspaceRoot !== undefined && typeof body.workspaceRoot !== "string")
      ) {
        throw new HttpError(
          400,
          "An active execution profile is required",
        );
      }
      confirmation = await confirmProblemRepositoryMatch({
        orgId: context.orgId,
        problemId,
        profileId: body.profileId,
        repository: typeof body.repository === "string" ? body.repository : undefined,
        workspaceRoot: typeof body.workspaceRoot === "string" ? body.workspaceRoot : undefined,
        actor: context,
      });
    } else if (body.action === "reject") {
      if (
        typeof body.profileId !== "string" ||
        !/^[a-f0-9-]{36}$/i.test(body.profileId)
      ) {
        throw new HttpError(400, "A suggested repository match is required");
      }
      rejectedMatch = await rejectProblemRepositoryMatch({
        orgId: context.orgId,
        problemId,
        profileId: body.profileId,
        actor: context,
      });
    } else {
      throw new HttpError(400, "Unknown repository review action");
    }

    const view = await reviewView(context, problemId, refresh);
    return NextResponse.json(
      { ...view, confirmation, rejectedMatch } satisfies ProblemRepositoryMatchReviewResponse,
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
