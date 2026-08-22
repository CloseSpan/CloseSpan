import { NextRequest, NextResponse } from "next/server";
import {
  exchangeSlackOAuthCode,
  saveSlackAppInstallation,
} from "@/lib/slack-app-repository";
import {
  SLACK_INSTALL_STATE_COOKIE,
  verifySlackInstallStateToken,
} from "@/lib/slack-app-state";
import { getSlackIntakeStatus, setSlackIntakeMode } from "@/lib/slack-intake";
import { joinSlackChannel } from "@/lib/slack-api";
import {
  authorizeAdminRead,
  HttpError,
} from "@/lib/request-security";

export const runtime = "nodejs";

function callbackUrl(request: NextRequest): string {
  const base = (
    process.env.AUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    request.nextUrl.origin
  ).replace(/\/$/, "");
  return new URL("/api/integrations/slack/callback", base).toString();
}

function workspaceRedirect(
  request: NextRequest,
  parameters: Record<string, string>,
): NextResponse {
  const target = new URL("/integrations", request.nextUrl.origin);
  target.searchParams.set("view", "connections");
  target.searchParams.set("focus", "int_slack");
  for (const [name, value] of Object.entries(parameters))
    target.searchParams.set(name, value);
  const response = NextResponse.redirect(target, 303);
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(SLACK_INSTALL_STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/integrations/slack/callback",
    maxAge: 0,
  });
  return response;
}

function callbackErrorCode(error: unknown): string {
  if (error instanceof HttpError) {
    if (error.status === 401) return "authentication_required";
    if (error.status === 403) return "administrator_required";
    if (error.status === 410) return "install_request_expired";
    if (error.status === 400) return "invalid_callback";
    if (error.status === 409) return "workspace_mismatch";
  }
  return "connection_failed";
}

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeAdminRead(request);
    const stateToken = request.nextUrl.searchParams.get("state") ?? "";
    const stateCookie =
      request.cookies.get(SLACK_INSTALL_STATE_COOKIE)?.value ?? "";
    if (!stateToken || stateToken !== stateCookie) {
      throw new HttpError(400, "Slack installation state did not match.");
    }
    const state = verifySlackInstallStateToken(stateToken);
    if (state.orgId !== context.orgId || state.actorId !== context.actorId) {
      throw new HttpError(403, "Slack installation belongs to another workspace.");
    }
    const denied = request.nextUrl.searchParams.get("error");
    if (denied) {
      throw new HttpError(400, `Slack installation was not completed (${denied}).`);
    }
    const code = request.nextUrl.searchParams.get("code")?.trim();
    if (!code) throw new HttpError(400, "Slack did not return an authorization code.");
    const installation = await exchangeSlackOAuthCode({
      code,
      redirectUri: callbackUrl(request),
    });
    const intake = await getSlackIntakeStatus(context.orgId);
    if (!intake || intake.state === "Disconnected") {
      throw new HttpError(409, "The Slack feedback connection is no longer active.");
    }
    if (installation.teamId !== intake.teamId) {
      throw new HttpError(
        409,
        "Install CloseSpan in the same Slack workspace as the feedback channel.",
      );
    }
    const botContext = {
      orgId: context.orgId,
      accessToken: installation.accessToken,
    };
    await joinSlackChannel(botContext, intake.channelId);
    await saveSlackAppInstallation({
      orgId: context.orgId,
      installation,
      context,
    });
    await setSlackIntakeMode({
      orgId: context.orgId,
      mode: "mentions",
      actor: context,
    });
    return workspaceRedirect(request, { slackBot: "connected" });
  } catch (error) {
    console.error("CloseSpan Slack bot callback failed", {
      reason: callbackErrorCode(error),
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return workspaceRedirect(request, {
      slackBot: "error",
      reason: callbackErrorCode(error),
    });
  }
}
