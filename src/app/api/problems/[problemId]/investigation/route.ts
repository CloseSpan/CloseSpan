import { NextRequest, NextResponse } from "next/server";
import { createAutomatedInvestigationForProblem } from "@/lib/investigation-repository";
import {
  authorizeMutation,
  errorResponse,
  noStoreHeaders,
} from "@/lib/request-security";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ problemId: string }> },
) {
  try {
    const [context, { problemId }] = await Promise.all([
      authorizeMutation(request),
      params,
    ]);
    const result = await createAutomatedInvestigationForProblem(
      context.orgId,
      problemId,
    );
    return NextResponse.json(
      { result, error: result.created ? undefined : result.reason },
      { status: result.created ? 201 : 409, headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
