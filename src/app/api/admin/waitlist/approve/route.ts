import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { approveWorkspaceAccessWaitlistEntry } from "@/lib/access-waitlist-repository";
import { HttpError, authorizeAdminMutation, errorResponse, noStoreHeaders } from "@/lib/request-security";
import { isCloseSpanPlatformAdmin } from "@/lib/workspace-access-policy";
import { sendWaitlistApprovalEmail } from "@/lib/waitlist-approval-email";

const bodySchema = z.object({ email: z.string().email().max(320) }).strict();

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    if (!isCloseSpanPlatformAdmin({ email: context.actorEmail, role: context.role }))
      throw new HttpError(403, "Platform administrator permission is required");
    const body = bodySchema.parse(await request.json());
    const approval = await approveWorkspaceAccessWaitlistEntry(body.email);
    const emailDelivery = await sendWaitlistApprovalEmail({
      email: approval.entry.email,
      displayName: approval.entry.displayName,
    });
    return NextResponse.json({ approval, emailDelivery }, { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
