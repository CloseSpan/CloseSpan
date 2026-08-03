import { NextRequest, NextResponse } from "next/server";
import { markPromptReviewNotificationRead } from "@/lib/prompt-review-notification-repository";
import { authorizeMutation, errorResponse, HttpError, noStoreHeaders } from "@/lib/request-security";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ notificationId: string }> },
) {
  try {
    const [context, { notificationId }] = await Promise.all([authorizeMutation(request), params]);
    if (!/^[A-Za-z0-9-]{8,128}$/.test(notificationId)) throw new HttpError(400, "Invalid notification ID");
    const updated = await markPromptReviewNotificationRead(context.orgId, context.actorId, notificationId);
    if (!updated) throw new HttpError(404, "Notification not found");
    return NextResponse.json({ status: "Read" }, { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
