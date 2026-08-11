import { NextRequest, NextResponse } from "next/server";
import { markGithubPendingSetup } from "@/lib/integration-repository";
import {
  disconnectGithubInstallations,
  listGithubAppInstallations,
} from "@/lib/github-installation-repository";
import { listGithubRepositoryAuthorizations } from "@/lib/github-repository-allowlist";
import {
  createGithubInstallStateToken,
  GITHUB_INSTALL_STATE_COOKIE,
  GITHUB_INSTALL_STATE_TTL_SECONDS,
} from "@/lib/github-installation-state";
import {
  authorizeAdminMutation,
  authorizeRead,
  errorResponse,
  noStoreHeaders,
} from "@/lib/request-security";

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeRead(request);
    const [installations, repositories] = await Promise.all([
      listGithubAppInstallations(context.orgId),
      listGithubRepositoryAuthorizations(context.orgId),
    ]);
    return NextResponse.json({ installations, repositories }, { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const body = (await request.json().catch(() => null)) as {
      returnTo?: unknown;
    } | null;
    const returnTo = body?.returnTo === "/onboarding"
      ? "/onboarding"
      : "/integrations";
    const attempt = await markGithubPendingSetup(context.orgId, context.actorId);
    const response = NextResponse.json(
      { installUrl: attempt.installUrl, expiresAt: attempt.expiresAt.toISOString() },
      { headers: noStoreHeaders },
    );
    response.cookies.set(
      GITHUB_INSTALL_STATE_COOKIE,
      createGithubInstallStateToken(
        attempt.attemptId,
        attempt.expiresAt,
        returnTo,
      ),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/api/integrations/github/callback",
        maxAge: GITHUB_INSTALL_STATE_TTL_SECONDS,
      },
    );
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    await disconnectGithubInstallations(context.orgId, context);
    return NextResponse.json({ disconnected: true }, { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
