import { NextRequest, NextResponse } from "next/server";
import { discordAppConfigured, discordInteractionsConfigured, leaveDiscordGuild } from "@/lib/discord-api";
import { disconnectDiscordInstallation, getDiscordInstallation } from "@/lib/discord-app-repository";
import { authorizeAdminMutation, authorizeRead, errorResponse, noStoreHeaders } from "@/lib/request-security";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeRead(request);
    return NextResponse.json({
      configured: discordAppConfigured(),
      interactionsConfigured: discordInteractionsConfigured(),
      gatewayConfigured: Boolean(
        process.env.DISCORD_GATEWAY_FORWARD_SECRET?.trim()
        && (process.env.DISCORD_GATEWAY_FORWARD_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim()),
      ),
      discordInstallation: await getDiscordInstallation(context.orgId),
    }, { headers: noStoreHeaders });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const current = await getDiscordInstallation(context.orgId);
    if (current?.state === "Connected") {
      await leaveDiscordGuild(current.guildId).catch((error) =>
        console.warn("Discord bot could not leave guild during disconnect", { guildId: current.guildId, error }),
      );
    }
    return NextResponse.json({ discordInstallation: await disconnectDiscordInstallation({ orgId: context.orgId, context }) }, { headers: noStoreHeaders });
  } catch (error) { return errorResponse(error); }
}
