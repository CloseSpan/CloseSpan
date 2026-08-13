import { NextRequest, NextResponse } from "next/server";
import {
  clearExecutionProfileAssignment,
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
  assertExecutionProfileReadyForActivation,
  executionProfileExecutor,
  executionProfileUsesRuntimeContract,
  sanitizeExecutionProfileConfig,
} from "@/lib/execution-profile";
import { validateRuntimeSecretBindings } from "@/lib/runtime-secret-repository";
import {
  assertManagedTenkiBootSourceAllowed,
  listManagedTenkiEnvironmentArtifacts,
} from "@/lib/tenki-environment-catalog-repository";
import { listPendingTenkiRunnerWorkflowSetups } from "@/lib/tenki-runner-workflow-setup-repository";
import { assertTenkiRunnerLabel, tenkiRunnerSize } from "@/lib/tenki-runner-sizing";

export async function DELETE(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const body = await request.json() as { repository?: unknown; workspaceRoot?: unknown };
    if (typeof body.repository !== "string" || typeof body.workspaceRoot !== "string") {
      throw new Error("Repository and workspace root are required");
    }
    await clearExecutionProfileAssignment({
      orgId: context.orgId,
      repository: body.repository,
      workspaceRoot: body.workspaceRoot,
      actor: context,
    });
    return NextResponse.json(
      { settings: await listExecutionProfileSettings(context.orgId) },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeAdminRead(request);
    if (workspacePersistenceMode(context.orgId) !== "postgres") {
      return NextResponse.json(
        { available: false, assignments: [], repositories: [] },
        { headers: noStoreHeaders },
      );
    }
    const [settings, repositories, managedEnvironments, runnerWorkflowSetups] = await Promise.all([
      listExecutionProfileSettings(context.orgId),
      listGithubRepositoryAuthorizations(context.orgId),
      listManagedTenkiEnvironmentArtifacts(context.orgId),
      listPendingTenkiRunnerWorkflowSetups(context.orgId),
    ]);
    return NextResponse.json(
      { available: true, ...settings, repositories, managedEnvironments, runnerWorkflowSetups },
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
    const executor = executionProfileExecutor(config);
    if (executor.kind === "tenki_github_actions") {
      assertTenkiRunnerLabel(executor.runnerLabel, executor.platform);
      const runnerSize = tenkiRunnerSize(executor.runnerLabel)!;
      if (config.cpuCores !== runnerSize.cpuCores || config.memoryMb !== runnerSize.memoryMb) {
        throw new Error("Runner CPU and memory must match the selected documented Tenki size");
      }
    }
    assertTenkiProviderResourceLimits(config);
    assertExecutionProfileReadyForActivation(config);
    if (executionProfileUsesRuntimeContract(config)) {
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
