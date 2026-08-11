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
  repositories: Array<{ repository: string; defaultBranch: string }>;
}): Promise<void> {
  let failed = 0;
  // Keep GitHub metadata traffic bounded. A durable queue can replace this
  // background pass later without changing detector or persistence contracts.
  for (let index = 0; index < input.repositories.length; index += 2) {
    const outcomes = await Promise.allSettled(
      input.repositories.slice(index, index + 2).map((repository) =>
        detectAndSaveGithubRepositoryProfiles({
          orgId: input.orgId,
          installationId: input.installationId,
          repository: repository.repository,
          defaultBranch: repository.defaultBranch,
          actor: {
            actorId: "system:github-installation-detector",
            actorName: "Repository profile detector",
            traceId: input.traceId,
          },
        })
      ),
    );
    failed += outcomes.filter((outcome) => outcome.status === "rejected").length;
  }
  if (failed) {
    console.warn(`Execution profile detection needs retry for ${failed} GitHub repositories`);
  }
}

export async function GET(request: NextRequest) {
  let returnTo: "/integrations" | "/onboarding" = "/integrations";
  try {
    const context = await authorizeAdminRead(request);
    const installationId = request.nextUrl.searchParams.get("installation_id") ?? "";
    const stateToken = request.cookies.get(GITHUB_INSTALL_STATE_COOKIE)?.value ?? "";
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
    after(async () => {
      await detectInstallationRepositories({
        orgId: context.orgId,
        traceId: context.traceId,
        installationId: installation.installationId,
        repositories: installation.repositories,
      });
    });
    return workspaceRedirect(request, returnTo, {
      github: "connected",
      repositories: String(result.repositoryCount),
    });
  } catch (error) {
    return workspaceRedirect(request, returnTo, {
      github: "error",
      reason: callbackErrorCode(error),
    });
  }
}
