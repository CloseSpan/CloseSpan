import { NextRequest, NextResponse } from "next/server";
import { createAutomatedPromptDraftForProblem } from "@/lib/automated-prompt-draft-repository";
import { getEngineeringWorkflow } from "@/lib/engineering-workflow-repository";
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
    const result = await createAutomatedPromptDraftForProblem(
      context.orgId,
      problemId,
    );
    return NextResponse.json(
      {
        result,
        error: result.created ? undefined : result.reason,
        workflow: await getEngineeringWorkflow(context.orgId, problemId),
      },
      { status: result.created ? 201 : 409, headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
