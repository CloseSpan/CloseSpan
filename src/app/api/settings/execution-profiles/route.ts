import { NextRequest, NextResponse } from "next/server";
import {
  listExecutionProfileSettings,
  overrideExecutionProfile,
} from "@/lib/execution-profile-repository";
import { listGithubRepositoryAuthorizations } from "@/lib/github-repository-allowlist";
import {
  authorizeAdminRead,
  authorizeAdminMutation,
  errorResponse,
  noStoreHeaders,
} from "@/lib/request-security";
import { workspacePersistenceMode } from "@/lib/workspace-persistence";
import {
  assertTenkiProviderResourceLimits,
  sanitizeExecutionProfileConfig,
} from "@/lib/execution-profile";
import { validateRuntimeSecretBindings } from "@/lib/runtime-secret-repository";
import {
  assertManagedTenkiBootSourceAllowed,
  listManagedTenkiEnvironmentArtifacts,
} from "@/lib/tenki-environment-catalog-repository";

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeAdminRead(request);
    if (workspacePersistenceMode(context.orgId) !== "postgres") {
      return NextResponse.json(
        { available: false, assignments: [], repositories: [] },
        { headers: noStoreHeaders },
      );
    }
    const [settings, repositories, managedEnvironments] = await Promise.all([
      listExecutionProfileSettings(context.orgId),
      listGithubRepositoryAuthorizations(context.orgId),
      listManagedTenkiEnvironmentArtifacts(context.orgId),
    ]);
    return NextResponse.json(
      { available: true, ...settings, repositories, managedEnvironments },
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
    const config = sanitizeExecutionProfileConfig(body.config);
    assertTenkiProviderResourceLimits(config);
    if (config.schemaVersion === 2) {
      await validateRuntimeSecretBindings({
        orgId: context.orgId,
        repository,
        workspaceRoot,
        bindings: config.secretBindings,
      });
    }
    await assertManagedTenkiBootSourceAllowed({
      orgId: context.orgId,
      repository,
      workspaceRoot,
      config,
    });
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
