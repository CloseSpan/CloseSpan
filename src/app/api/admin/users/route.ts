import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { managePlatformUser } from "@/lib/platform-user-management";
import { authorizeAdminMutation, errorResponse, HttpError, noStoreHeaders } from "@/lib/request-security";
import { isCloseSpanPlatformAdmin } from "@/lib/workspace-access-policy";

const inputSchema = z.object({
  email: z.string().trim().email().max(320),
  action: z.enum(["block", "unblock", "delete"]),
  expectedStatus: z.enum(["Active", "Blocked"]),
  confirmationEmail: z.string().max(320).optional(),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const actor = { email: context.actorEmail, role: context.role };
    if (!isCloseSpanPlatformAdmin(actor)) throw new HttpError(403, "Platform administrator permission is required.");
    const input = inputSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new HttpError(400, "Choose a valid user and account action.");
    const result = await managePlatformUser({ ...input.data, actor, requestId: context.idempotencyKey });
    return NextResponse.json(result, { headers: noStoreHeaders });
  } catch (error) {
    // Do not expose SQL/storage details on account-management failures.
    return errorResponse(error instanceof HttpError ? error : new HttpError(503, "User management is temporarily unavailable. Try again."));
  }
}
