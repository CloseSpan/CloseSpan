import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setSlackIntakeMode } from "@/lib/slack-intake";
import {
  authorizeAdminMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

export const runtime = "nodejs";

const schema = z.object({ botEnabled: z.boolean() }).strict();

export async function PATCH(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new HttpError(400, "Choose whether the CloseSpan bot is enabled.");
    }
    const slackIntake = await setSlackIntakeMode({
      orgId: context.orgId,
      mode: parsed.data.botEnabled ? "mentions" : "channel",
      actor: context,
    });
    return NextResponse.json({ slackIntake }, { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
