import { after, NextRequest, NextResponse } from "next/server";
import { verifyGithubInstallation } from "@/lib/github-app-auth";
import {
  connectGithubInstallation,
  requireGithubInstallAttempt,
} from "@/lib/github-installation-repository";
import {
  GITHUB_INSTALL_STATE_COOKIE,
  verifyGithubInstallStateToken,
} from "@/lib/github-installation-state";
import { authorizeAdminRead, HttpError } from "@/lib/request-security";
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
import { markGithubSetupFailed } from "@/lib/integration-repository";

function workspaceRedirect(
  request: NextRequest,
  returnTo: "/integrations" | "/onboarding",
  parameters: Record<string, string>,
): NextResponse {
  const target = new URL(returnTo, request.nextUrl.origin);
  if (returnTo === "/integrations") {
    target.searchParams.set("view", "connections");
    target.searchParams.set("focus", "int_github");
  }
  for (const [key, value] of Object.entries(parameters))
    target.searchParams.set(key, value);
  const response = NextResponse.redirect(target, 303);
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(GITHUB_INSTALL_STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/integrations/github/callback",
    maxAge: 0,
  });
  return response;
}

function callbackErrorCode(error: unknown): string {
  if (error instanceof HttpError) {
    if (error.status === 401) return "authentication_required";
    if (error.status === 403) return "administrator_required";
    if (error.status === 410) return "install_request_expired";
    if (error.status === 409) return "installation_unavailable";
    if (error.status === 400) return "invalid_callback";
  }
  return "connection_failed";
}

async function detectInstallationRepositories(input: {
  orgId: string;
  traceId: string;
  installationId: string;
  callbackBaseUrl: string;
  repositories: Array<{ repository: string; defaultBranch: string }>;
}): Promise<void> {
  let failed = 0;
  // Keep GitHub metadata traffic bounded. A durable queue can replace this
  // background pass later without changing detector or persistence contracts.
  for (let index = 0; index < input.repositories.length; index += 2) {
    const outcomes = await Promise.allSettled(
      input.repositories.slice(index, index + 2).map(async (repository) => {
        const detection = await detectAndSaveGithubRepositoryProfiles({
          orgId: input.orgId,
          installationId: input.installationId,
          repository: repository.repository,
          defaultBranch: repository.defaultBranch,
          actor: {
            actorId: "system:github-installation-detector",
            actorName: "Repository profile detector",
            traceId: input.traceId,
          },
        });
        await prepareDetectedTenkiRunner({
          orgId: input.orgId,
          installationId: input.installationId,
          repository: repository.repository,
          defaultBranch: repository.defaultBranch,
          detection,
        });
        await prepareTenkiRunnerSizingProbes({
          orgId: input.orgId,
          installationId: input.installationId,
          repository: repository.repository,
          callbackBaseUrl: input.callbackBaseUrl,
        });
        await activateReadyDetectedExecutionProfiles({
          orgId: input.orgId,
          repository: repository.repository,
          actor: {
            actorId: "system:github-installation-activator",
            actorName: "Repository execution activator",
            traceId: input.traceId,
          },
        });
      }),
    );
    failed += outcomes.filter((outcome) => outcome.status === "rejected").length;
  }
  if (failed) {
    console.warn(`Execution profile detection needs retry for ${failed} GitHub repositories`);
  }
}

export async function GET(request: NextRequest) {
  let returnTo: "/integrations" | "/onboarding" = "/integrations";
  let orgId: string | null = null;
  try {
    const context = await authorizeAdminRead(request);
    orgId = context.orgId;
    const installationId = request.nextUrl.searchParams.get("installation_id") ?? "";
    const stateToken =
      request.nextUrl.searchParams.get("state") ??
      request.cookies.get(GITHUB_INSTALL_STATE_COOKIE)?.value ??
      "";
    const state = verifyGithubInstallStateToken(stateToken);
    returnTo = state.returnTo;
    await requireGithubInstallAttempt(state.attemptId, context.orgId, context.actorId);
    const installation = await verifyGithubInstallation(installationId);
    const result = await connectGithubInstallation(
      state.attemptId,
      context.orgId,
      context,
      installation,
    );
    if (result.repositories.length > 0) {
      await queueRepositoryContexts({
        orgId: context.orgId,
        installationId: installation.installationId,
        repositories: result.repositories,
      });
      after(async () => {
        const outcomes = await Promise.allSettled([
          detectInstallationRepositories({
            orgId: context.orgId,
            traceId: context.traceId,
            installationId: installation.installationId,
            callbackBaseUrl: request.nextUrl.origin,
            repositories: result.repositories,
          }),
          buildQueuedRepositoryContexts(
            context.orgId,
            result.repositories.map((repository) => repository.repository),
          ),
        ]);
        for (const outcome of outcomes) {
          if (outcome.status === "rejected") {
            console.error("GitHub post-connection setup needs retry", outcome.reason);
          }
        }
      });
    }
    return workspaceRedirect(request, returnTo, {
      github: "connected",
      repositories: String(result.repositoryCount),
      availableRepositories: String(result.availableRepositoryCount),
    });
  } catch (error) {
    const reason = callbackErrorCode(error);
    console.error("GitHub installation callback failed", {
      reason,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    if (orgId) {
      await markGithubSetupFailed(orgId, reason).catch((persistenceError) => {
        console.error("GitHub callback failure state could not be saved", {
          errorType:
            persistenceError instanceof Error
              ? persistenceError.name
              : "UnknownError",
        });
      });
    }
    return workspaceRedirect(request, returnTo, {
      github: "error",
      reason,
    });
  }
}
