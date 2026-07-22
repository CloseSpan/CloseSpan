import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  FeatureRequestRepositoryError,
  moderateFeatureRequest,
} from "@/lib/feature-request-repository";
import {
  assertFeatureRequestModerator,
  readPublicJson,
} from "@/lib/feature-request-security";
import {
  authorizeAdminMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestIdSchema = z.string().uuid();
const moderationSchema = z
  .object({ decision: z.enum(["publish", "reject"]) })
  .strict();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ requestId: string }> },
) {
  try {
    const moderator = await authorizeAdminMutation(request);
    assertFeatureRequestModerator(moderator.actorEmail, moderator.role);
    const { requestId: rawRequestId } = await context.params;
    const requestId = requestIdSchema.safeParse(rawRequestId);
    if (!requestId.success) throw new HttpError(404, "Request not found");
    const body = moderationSchema.safeParse(await readPublicJson(request));
    if (!body.success) throw new HttpError(400, "Review decision is invalid");

    const result = await moderateFeatureRequest(
      requestId.data,
      body.data.decision,
      {
        orgId: moderator.orgId,
        actorId: moderator.actorId,
        actorName: moderator.actorName,
        idempotencyKey: moderator.idempotencyKey,
        traceId: moderator.traceId,
      },
    );
    return NextResponse.json(result, { headers: noStoreHeaders });
  } catch (error) {
    if (
      error instanceof HttpError ||
      error instanceof FeatureRequestRepositoryError
    )
      return errorResponse(error);
    return errorResponse(
      new HttpError(503, "This request could not be reviewed right now"),
    );
  }
}
