import { NextRequest, NextResponse } from "next/server";
import { getEngineeringWorkflow } from "@/lib/engineering-workflow-repository";
import {
  overridePddPromptEvaluation,
  readPddPromptEvaluation,
} from "@/lib/pdd-prompt-evaluation-repository";
import { createPromptAlignmentReceipt } from "@/lib/prompt-alignment-receipt";
import { sha256 } from "@/lib/pdd-verification";
import {
  authorizeMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

const MAX_BODY_BYTES = 8_192;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_PATTERN = /^[a-f0-9]{64}$/;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ problemId: string }> },
) {
  try {
    const context = await authorizeMutation(request);
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "Prompt override request is too large" },
        { status: 413, headers: noStoreHeaders },
      );
    }
    let body: {
      evaluationId?: unknown;
      userStory?: unknown;
      currentPromptHash?: unknown;
      reason?: unknown;
    };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      return NextResponse.json(
        { error: "Prompt override request is invalid" },
        { status: 400, headers: noStoreHeaders },
      );
    }
    if (
      typeof body.evaluationId !== "string"
      || !UUID_PATTERN.test(body.evaluationId)
      || typeof body.userStory !== "string"
      || !body.userStory.trim()
      || typeof body.currentPromptHash !== "string"
      || !SHA_PATTERN.test(body.currentPromptHash)
      || (body.reason !== undefined && (
        typeof body.reason !== "string"
        || body.reason.trim().length > 500
      ))
    ) {
      return NextResponse.json(
        { error: "Prompt override request is invalid" },
        { status: 400, headers: noStoreHeaders },
      );
    }

    const { problemId } = await params;
    const current = await getEngineeringWorkflow(context.orgId, problemId);
    if (!current.prompt || current.prompt.contentHash !== body.currentPromptHash) {
      throw new HttpError(409, "The prompt changed after Prompt Testing. Review the current revision before overriding it.");
    }
    const evaluation = await readPddPromptEvaluation(
      context.orgId,
      problemId,
      current.prompt.id,
    );
    if (
      !evaluation
      || evaluation.id !== body.evaluationId
      || evaluation.promptHash !== current.prompt.contentHash
      || evaluation.status !== "Succeeded"
      || !evaluation.review
    ) {
      throw new HttpError(409, "Only the latest completed Prompt Testing recommendation can be overridden.");
    }
    if (
      evaluation.userStory.replace(/\s+/g, " ").trim()
      !== body.userStory.replace(/\s+/g, " ").trim()
    ) {
      throw new HttpError(409, "The user story changed after Prompt Testing. Test the current story before overriding it.");
    }

    const alignmentReceipt = createPromptAlignmentReceipt({
      orgId: context.orgId,
      problemId,
      promptHash: current.prompt.contentHash,
      storyHash: sha256(body.userStory.replace(/\s+/g, " ").trim()),
    });
    if (evaluation.review.verdict === "Passed" && evaluation.review.override) {
      return NextResponse.json(
        { workflow: current, alignmentReceipt, review: evaluation.review },
        { headers: noStoreHeaders },
      );
    }
    if (evaluation.review.verdict !== "Needs revision") {
      throw new HttpError(409, "Only a Prompt Testing revision recommendation can be overridden.");
    }

    const review = await overridePddPromptEvaluation({
      orgId: context.orgId,
      problemId,
      evaluationId: evaluation.id,
      promptHash: current.prompt.contentHash,
      actorId: context.actorId,
      actorName: context.actorName,
      traceId: context.traceId,
      reason: typeof body.reason === "string" ? body.reason : undefined,
    });
    if (!review) {
      throw new HttpError(409, "The Prompt Testing result changed before the override was recorded. Refresh and review it again.");
    }
    const workflow = await getEngineeringWorkflow(context.orgId, problemId);
    return NextResponse.json(
      { workflow, alignmentReceipt, review },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
