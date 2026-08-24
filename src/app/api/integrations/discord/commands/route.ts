import { NextRequest, NextResponse } from "next/server";
import { registerDiscordCommands } from "@/lib/discord-api";
import { getDiscordInstallation } from "@/lib/discord-app-repository";
import {
  authorizeAdminMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const installation = await getDiscordInstallation(context.orgId);
    if (!installation || installation.state !== "Connected") {
      throw new HttpError(409, "Connect Discord before registering commands.");
    }
    await registerDiscordCommands(installation.guildId);
    return NextResponse.json({ registered: true }, { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
