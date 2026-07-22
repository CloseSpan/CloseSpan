import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  consumeFeatureRequestRateLimit,
  FeatureRequestRepositoryError,
  voteForFeatureRequest,
} from "@/lib/feature-request-repository";
import {
  featureRequestRateLimitIdentity,
  featureRequestVoteHash,
  readPublicJson,
} from "@/lib/feature-request-security";
import {
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const emptyBodySchema = z.object({}).strict();
const requestIdSchema = z.string().uuid();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ requestId: string }> },
) {
  try {
    const { requestId: rawRequestId } = await context.params;
    const requestId = requestIdSchema.safeParse(rawRequestId);
    if (!requestId.success) throw new HttpError(404, "Request not found");
    const body = emptyBodySchema.safeParse(await readPublicJson(request));
    if (!body.success) throw new HttpError(400, "Vote details are invalid");

    await consumeFeatureRequestRateLimit(
      "vote",
      featureRequestRateLimitIdentity(request.headers, "vote", 60),
      60,
    );

    const result = await voteForFeatureRequest(
      requestId.data,
      featureRequestVoteHash(request.headers, requestId.data),
    );
    return NextResponse.json(
      {
        status: result.recorded ? "recorded" : "already_voted",
        requestId: result.requestId,
        voteCount: result.voteCount,
        viewerHasVoted: result.viewerHasVoted,
      },
      {
        status: result.recorded ? 201 : 200,
        headers: noStoreHeaders,
      },
    );
  } catch (error) {
    if (error instanceof HttpError || error instanceof FeatureRequestRepositoryError)
      return errorResponse(error);
    return errorResponse(
      new HttpError(503, "Your vote could not be recorded right now"),
    );
  }
}
