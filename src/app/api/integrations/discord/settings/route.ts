import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listDiscordGuildChannels } from "@/lib/discord-api";
import { getDiscordInstallation, updateDiscordIntakeSettings } from "@/lib/discord-app-repository";
import { authorizeAdminMutation, errorResponse, HttpError, noStoreHeaders } from "@/lib/request-security";

export const runtime = "nodejs";
const schema = z.object({
  intakeMode: z.enum(["commands", "channels"]),
  monitoredChannelIds: z.array(z.string().regex(/^\d{5,24}$/)).max(100),
});

export async function PATCH(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const input = schema.parse(await request.json());
    const installation = await getDiscordInstallation(context.orgId);
    if (!installation || installation.state !== "Connected") throw new HttpError(409, "Connect Discord before changing intake settings.");
    if (input.intakeMode === "channels") {
      const allowed = new Set((await listDiscordGuildChannels(installation.guildId)).map((channel) => channel.id));
      if (input.monitoredChannelIds.some((id) => !allowed.has(id))) throw new HttpError(400, "One or more selected Discord channels are no longer available.");
    }
    return NextResponse.json({ discordInstallation: await updateDiscordIntakeSettings({ orgId: context.orgId, ...input, context }) }, { headers: noStoreHeaders });
  } catch (error) { return errorResponse(error); }
}
