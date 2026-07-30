import { NextRequest, NextResponse } from "next/server";
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

function workspaceRedirect(
  request: NextRequest,
  parameters: Record<string, string>,
): NextResponse {
  const target = new URL("/integrations", request.nextUrl.origin);
  target.searchParams.set("view", "connections");
  target.searchParams.set("focus", "int_github");
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

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeAdminRead(request);
    const installationId = request.nextUrl.searchParams.get("installation_id") ?? "";
    const stateToken = request.cookies.get(GITHUB_INSTALL_STATE_COOKIE)?.value ?? "";
    const state = verifyGithubInstallStateToken(stateToken);
    await requireGithubInstallAttempt(state.attemptId, context.orgId, context.actorId);
    const installation = await verifyGithubInstallation(installationId);
    const result = await connectGithubInstallation(
      state.attemptId,
      context.orgId,
      context,
      installation,
    );
    return workspaceRedirect(request, {
      github: "connected",
      repositories: String(result.repositoryCount),
    });
  } catch (error) {
    return workspaceRedirect(request, {
      github: "error",
      reason: callbackErrorCode(error),
    });
  }
}
