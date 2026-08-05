import { NextRequest, NextResponse } from "next/server";
import {
  listExecutionProfileSettings,
  overrideExecutionProfile,
} from "@/lib/execution-profile-repository";
import { listGithubRepositoryAuthorizations } from "@/lib/github-repository-allowlist";
import {
  authorizeAdminMutation,
  authorizeRead,
  errorResponse,
  noStoreHeaders,
} from "@/lib/request-security";
import { workspacePersistenceMode } from "@/lib/workspace-persistence";

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeRead(request);
    if (workspacePersistenceMode(context.orgId) !== "postgres") {
      return NextResponse.json(
        { available: false, assignments: [], repositories: [] },
        { headers: noStoreHeaders },
      );
    }
    const [settings, repositories] = await Promise.all([
      listExecutionProfileSettings(context.orgId),
      listGithubRepositoryAuthorizations(context.orgId),
    ]);
    return NextResponse.json(
      { available: true, ...settings, repositories },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 64_000) {
      return NextResponse.json(
        { error: "Execution profile payload is too large" },
        { status: 413, headers: noStoreHeaders },
      );
    }
    const body = await request.json() as {
      repository?: unknown;
      workspaceRoot?: unknown;
      parentProfileId?: unknown;
      config?: unknown;
    };
    const repository = typeof body.repository === "string" ? body.repository : "";
    const workspaceRoot = typeof body.workspaceRoot === "string" ? body.workspaceRoot : ".";
    const parentProfileId = body.parentProfileId === null || body.parentProfileId === undefined
      ? null
      : typeof body.parentProfileId === "string"
        ? body.parentProfileId
        : undefined;
    if (parentProfileId === undefined) throw new Error("Parent profile ID is invalid");
    const profile = await overrideExecutionProfile({
      orgId: context.orgId,
      repository,
      workspaceRoot,
      parentProfileId,
      config: body.config,
      actor: context,
    });
    return NextResponse.json(
      { profile, settings: await listExecutionProfileSettings(context.orgId) },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
