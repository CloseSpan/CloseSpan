import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { processDiscordMessage, type DiscordMessageEvent } from "@/lib/discord-intake";
import { errorResponse, HttpError } from "@/lib/request-security";

export const runtime = "nodejs";

function authorizeGateway(request: NextRequest) {
  const configured = process.env.DISCORD_GATEWAY_FORWARD_SECRET?.trim() ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!configured || configured.length !== supplied.length || !timingSafeEqual(Buffer.from(configured), Buffer.from(supplied))) {
    throw new HttpError(401, "Discord gateway authorization failed.");
  }
}

export async function POST(request: NextRequest) {
  try {
    authorizeGateway(request);
    const payload = await request.json() as { type?: string; data?: DiscordMessageEvent };
    if (payload.type !== "MESSAGE_CREATE" || !payload.data) return Response.json({ accepted: false });
    return Response.json({ accepted: true, result: await processDiscordMessage(payload.data) });
  } catch (error) { return errorResponse(error); }
}
