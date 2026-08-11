import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sendOnboardingSupportEmail } from "@/lib/onboarding-support-email";
import {
  authorizeMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";
import { PUBLIC_EMAILS } from "@/lib/site";

const supportMessageSchema = z.object({
  replyEmail: z.string().trim().email().max(254),
  subject: z.string().trim().max(160).optional().default(""),
  message: z.string().trim().min(1).max(5_000),
});

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeMutation(request);
    const parsed = supportMessageSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      throw new HttpError(400, "Check the reply email and support message.");
    }
    const delivery = await sendOnboardingSupportEmail({
      replyEmail: parsed.data.replyEmail,
      subject: parsed.data.subject || null,
      message: parsed.data.message,
      organizationName: context.organizationName,
      actorName: context.actorName,
      actorEmail: context.actorEmail,
    });
    if (!delivery.sent) {
      throw new HttpError(503, "Support email is temporarily unavailable.");
    }
    return NextResponse.json(
      { sent: true, recipient: PUBLIC_EMAILS.support },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
