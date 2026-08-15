import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { listGithubRepositoryAuthorizations } from "@/lib/github-repository-allowlist";
import { refreshPendingProblemRepositoryMatches } from "@/lib/problem-repository-match-repository";
import { detectAndSaveGithubRepositoryProfiles } from "@/lib/repository-profile-detection";
import { noStoreHeaders } from "@/lib/request-security";
import {
  activateReadyDetectedExecutionProfiles,
  prepareDetectedTenkiRunner,
  prepareTenkiRunnerSizingProbes,
} from "@/lib/tenki-runner-onboarding";

export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET?.trim() ?? "";
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!expected || !provided) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: noStoreHeaders },
    );
  }
  try {
    const body = await request.json() as {
      orgId?: unknown;
      repository?: unknown;
    };
    if (
      typeof body.orgId !== "string"
      || typeof body.repository !== "string"
      || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(body.repository)
    ) {
      return NextResponse.json(
        { error: "A valid organization and repository are required" },
        { status: 400, headers: noStoreHeaders },
      );
    }
    const repositories = await listGithubRepositoryAuthorizations(body.orgId);
    const repository = repositories.find((candidate) =>
      candidate.active
      && candidate.workspaceSelected
      && candidate.repository === body.repository);
    if (!repository) {
      return NextResponse.json(
        { error: "Authorized repository was not found" },
        { status: 404, headers: noStoreHeaders },
      );
    }
    const detection = await detectAndSaveGithubRepositoryProfiles({
      orgId: body.orgId,
      installationId: repository.installationId,
      repository: repository.repository,
      defaultBranch: repository.defaultBranch,
      actor: {
        actorId: "system:tenki-private-reconciler",
        actorName: "Tenki environment reconciler",
      },
    });
    const setup = await prepareDetectedTenkiRunner({
      orgId: body.orgId,
      installationId: repository.installationId,
      repository: repository.repository,
      defaultBranch: repository.defaultBranch,
      detection,
    });
    const compatibilityProbes = await prepareTenkiRunnerSizingProbes({
      orgId: body.orgId,
      installationId: repository.installationId,
      repository: repository.repository,
      callbackBaseUrl: request.nextUrl.origin,
    });
    const activatedProfiles = await activateReadyDetectedExecutionProfiles({
      orgId: body.orgId,
      repository: repository.repository,
      actor: {
        actorId: "system:tenki-private-reconciler",
        actorName: "Tenki environment reconciler",
      },
    });
    await refreshPendingProblemRepositoryMatches(body.orgId);
    return NextResponse.json(
      {
        ok: true,
        profiles: detection.profiles.length,
        setup,
        compatibilityProbes,
        activatedProfiles,
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "Execution-profile refresh failed",
      },
      { status: 409, headers: noStoreHeaders },
    );
  }
}
