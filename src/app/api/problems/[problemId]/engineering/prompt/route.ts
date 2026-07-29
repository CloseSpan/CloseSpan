import { NextRequest, NextResponse } from "next/server";
import { generateImplementationPrompt } from "@/lib/engineering-workflow-repository";
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
    const context = await authorizeMutation(request);
    const { problemId } = await params;
    return NextResponse.json(
      {
        workflow: await generateImplementationPrompt(
          context.orgId,
          problemId,
          context,
        ),
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
