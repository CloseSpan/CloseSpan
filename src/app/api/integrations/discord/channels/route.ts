import { NextRequest, NextResponse } from "next/server";
import { listDiscordGuildChannels } from "@/lib/discord-api";
import { getDiscordInstallation } from "@/lib/discord-app-repository";
import { authorizeAdminRead, errorResponse, HttpError, noStoreHeaders } from "@/lib/request-security";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeAdminRead(request);
    const installation = await getDiscordInstallation(context.orgId);
    if (!installation || installation.state !== "Connected") throw new HttpError(409, "Connect Discord before selecting channels.");
    return NextResponse.json({ channels: await listDiscordGuildChannels(installation.guildId) }, { headers: noStoreHeaders });
  } catch (error) { return errorResponse(error); }
}
