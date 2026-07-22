import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createFeatureRequest,
  FeatureRequestRepositoryError,
  listFeatureRequests,
} from "@/lib/feature-request-repository";
import {
  featureRequestRateLimitIdentity,
  featureRequestViewerHasher,
  readPublicJson,
} from "@/lib/feature-request-security";
import {
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createRequestSchema = z
  .object({
    title: z.string().trim().min(4).max(120),
    description: z.string().trim().min(10).max(2000),
  })
  .strict();

export async function GET(request: NextRequest) {
  try {
    const requests = await listFeatureRequests(
      featureRequestViewerHasher(request.headers),
    );
    return NextResponse.json({ requests }, { headers: noStoreHeaders });
  } catch {
    return errorResponse(
      new HttpError(503, "Feature requests are temporarily unavailable"),
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = createRequestSchema.safeParse(await readPublicJson(request));
    if (!parsed.success)
      throw new HttpError(
        400,
        "Add a title and a short description of the improvement",
      );
    const created = await createFeatureRequest(
      parsed.data,
      featureRequestRateLimitIdentity(request.headers, "submit", 60 * 60),
    );
    return NextResponse.json(
      { submission: created },
      { status: 202, headers: noStoreHeaders },
    );
  } catch (error) {
    if (error instanceof HttpError || error instanceof FeatureRequestRepositoryError)
      return errorResponse(error);
    return errorResponse(
      new HttpError(503, "Your request could not be submitted right now"),
    );
  }
}
