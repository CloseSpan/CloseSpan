import { NextRequest, NextResponse } from "next/server";
import { isProductProblemStage } from "@/lib/problem-stage-transition";
import { transitionProblemStage } from "@/lib/problem-stage-transition-repository";
import {
  authorizeMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ problemId: string }> },
) {
  try {
    const [context, { problemId }, body] = await Promise.all([
      authorizeMutation(request),
      params,
      request.json() as Promise<{ stage?: unknown }>,
    ]);
    if (!isProductProblemStage(body.stage))
      throw new HttpError(400, "A valid lifecycle stage is required");
    const transition = await transitionProblemStage(
      context.orgId,
      problemId,
      body.stage,
      context,
    );
    return NextResponse.json({ transition }, { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
