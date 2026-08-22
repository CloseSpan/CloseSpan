import { NextRequest, NextResponse } from "next/server";
import { buildDiscordInstallUrl, discordAppConfigured } from "@/lib/discord-api";
import {
  createDiscordInstallStateToken,
  DISCORD_INSTALL_STATE_COOKIE,
  DISCORD_INSTALL_STATE_TTL_SECONDS,
} from "@/lib/discord-app-state";
import { authorizeAdminMutation, errorResponse, HttpError, noStoreHeaders } from "@/lib/request-security";

export const runtime = "nodejs";

function callbackUrl(request: NextRequest): string {
  const base = (process.env.AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin).replace(/\/$/, "");
  return new URL("/api/integrations/discord/callback", base).toString();
}

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    if (!discordAppConfigured()) throw new HttpError(503, "The CloseSpan Discord app is not configured in this environment.");
    const body = (await request.json().catch(() => ({}))) as {
      returnTo?: unknown;
    };
    const state = createDiscordInstallStateToken({
      orgId: context.orgId,
      actorId: context.actorId,
      returnTo: body.returnTo === "/onboarding" ? "/onboarding" : "/integrations",
    });
    const response = NextResponse.json(
      { installUrl: buildDiscordInstallUrl({ state, redirectUri: callbackUrl(request) }) },
      { headers: noStoreHeaders },
    );
    response.cookies.set(DISCORD_INSTALL_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/integrations/discord/callback",
      maxAge: DISCORD_INSTALL_STATE_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
