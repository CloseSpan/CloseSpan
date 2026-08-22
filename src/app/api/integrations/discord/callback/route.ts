import { NextRequest, NextResponse } from "next/server";
import { exchangeDiscordOAuthCode, registerDiscordCommands } from "@/lib/discord-api";
import { saveDiscordInstallation } from "@/lib/discord-app-repository";
import { DISCORD_INSTALL_STATE_COOKIE, verifyDiscordInstallStateToken } from "@/lib/discord-app-state";
import { authorizeAdminRead, HttpError } from "@/lib/request-security";

export const runtime = "nodejs";

function callbackUrl(request: NextRequest): string {
  const base = (process.env.AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin).replace(/\/$/, "");
  return new URL("/api/integrations/discord/callback", base).toString();
}

function redirect(request: NextRequest, state: "connected" | "error", reason?: string) {
  const target = new URL("/integrations", request.nextUrl.origin);
  target.searchParams.set("view", "connections");
  target.searchParams.set("focus", "int_discord");
  target.searchParams.set("discord", state);
  if (reason) target.searchParams.set("reason", reason);
  const response = NextResponse.redirect(target, 303);
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(DISCORD_INSTALL_STATE_COOKIE, "", {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
    path: "/api/integrations/discord/callback", maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeAdminRead(request);
    const stateToken = request.nextUrl.searchParams.get("state") ?? "";
    const stateCookie = request.cookies.get(DISCORD_INSTALL_STATE_COOKIE)?.value ?? "";
    if (!stateToken || stateToken !== stateCookie) throw new HttpError(400, "Discord installation state did not match.");
    const state = verifyDiscordInstallStateToken(stateToken);
    if (state.orgId !== context.orgId || state.actorId !== context.actorId) throw new HttpError(403, "Discord installation belongs to another workspace.");
    const denied = request.nextUrl.searchParams.get("error");
    if (denied) throw new HttpError(400, `Discord installation was not completed (${denied}).`);
    const code = request.nextUrl.searchParams.get("code")?.trim();
    if (!code) throw new HttpError(400, "Discord did not return an authorization code.");
    const installation = await exchangeDiscordOAuthCode({ code, redirectUri: callbackUrl(request) });
    await registerDiscordCommands(installation.guildId);
    await saveDiscordInstallation({ orgId: context.orgId, installation, context });
    return redirect(request, "connected");
  } catch (error) {
    console.error("CloseSpan Discord callback failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return redirect(request, "error", error instanceof HttpError ? String(error.status) : "connection_failed");
  }
}
