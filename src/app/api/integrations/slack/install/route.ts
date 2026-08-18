import { NextRequest, NextResponse } from "next/server";
import {
  buildSlackInstallUrl,
  slackAppConfigured,
} from "@/lib/slack-app-repository";
import {
  createSlackInstallStateToken,
  SLACK_INSTALL_STATE_COOKIE,
  SLACK_INSTALL_STATE_TTL_SECONDS,
} from "@/lib/slack-app-state";
import { getSlackIntakeStatus } from "@/lib/slack-intake";
import {
  authorizeAdminMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
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

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    if (!slackAppConfigured()) {
      throw new HttpError(
        503,
        "The CloseSpan Slack app is not configured in this environment.",
      );
    }
    const intake = await getSlackIntakeStatus(context.orgId);
    if (!intake || intake.state === "Disconnected") {
      throw new HttpError(409, "Connect Slack before installing the CloseSpan bot.");
    }
    const state = createSlackInstallStateToken({
      orgId: context.orgId,
      actorId: context.actorId,
    });
    const installUrl = buildSlackInstallUrl({
      state,
      redirectUri: callbackUrl(request),
    });
    const response = NextResponse.json(
      { installUrl },
      { headers: noStoreHeaders },
    );
    response.cookies.set(SLACK_INSTALL_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/integrations/slack/callback",
      maxAge: SLACK_INSTALL_STATE_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
