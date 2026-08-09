import { NextRequest, NextResponse } from "next/server";
import {
  getPromptAlignmentContext,
} from "@/lib/engineering-workflow-repository";
import { getAiRuntimeConfiguration } from "@/lib/ai-config";
import { evaluatePromptAlignment } from "@/lib/prompt-alignment-evaluation";
import { createPromptAlignmentReceipt } from "@/lib/prompt-alignment-receipt";
import { sha256 } from "@/lib/pdd-verification";
import {
  authorizeMutation,
  errorResponse,
  noStoreHeaders,
} from "@/lib/request-security";

const MAX_BODY_BYTES = 8_192;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ problemId: string }> },
) {
  try {
    const context = await authorizeMutation(request);
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "User story is too large" },
        { status: 413, headers: noStoreHeaders },
      );
    }
    const bodyText = await request.text();
    if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "User story is too large" },
        { status: 413, headers: noStoreHeaders },
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return NextResponse.json(
        { error: "User story request is invalid" },
        { status: 400, headers: noStoreHeaders },
      );
    }
    const userStory =
      typeof body === "object" && body !== null && "userStory" in body
        ? (body as { userStory: unknown }).userStory
        : undefined;
    const { problemId } = await params;
    const promptContext = await getPromptAlignmentContext(
      context.orgId,
      problemId,
      userStory,
      context,
    );
    const configuration = await getAiRuntimeConfiguration(context.orgId);
    const evaluation = await evaluatePromptAlignment({
      configuration,
      userStory: promptContext.userStory,
      implementationPrompt: promptContext.implementationPrompt,
    });
    const alignmentReceipt =
      evaluation.verdict === "Aligned"
        ? createPromptAlignmentReceipt({
            orgId: context.orgId,
            problemId,
            promptHash: promptContext.promptHash,
            storyHash: sha256(
              promptContext.userStory.replace(/\s+/g, " ").trim(),
            ),
          })
        : null;
    return NextResponse.json(
      {
        workflow: promptContext.workflow,
        promptEvaluation: {
          ...evaluation,
          promptHash: promptContext.promptHash,
          alignmentReceipt,
        },
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
