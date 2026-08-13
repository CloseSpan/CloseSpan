import { NextRequest, NextResponse } from "next/server";
import { applyPddPromptRevision, getEngineeringWorkflow } from "@/lib/engineering-workflow-repository";
import { assertPddPromptRevisionReceipt } from "@/lib/pdd-prompt-revision-receipt";
import { markPddPromptEvaluationApplied } from "@/lib/pdd-prompt-evaluation-repository";
import { sha256 } from "@/lib/pdd-verification";
import { authorizeMutation, errorResponse, noStoreHeaders } from "@/lib/request-security";

const MAX_BODY_BYTES = 72_000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ problemId: string }> },
) {
  try {
    const context = await authorizeMutation(request);
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Prompt revision is too large" }, { status: 413, headers: noStoreHeaders });
    }
    const body = JSON.parse(text) as {
      userStory?: unknown; currentPromptHash?: unknown; revisedPrompt?: unknown;
      revisionReceipt?: unknown; evaluationId?: unknown;
    };
    if (
      typeof body.userStory !== "string"
      || typeof body.currentPromptHash !== "string"
      || typeof body.revisedPrompt !== "string"
      || typeof body.evaluationId !== "string"
    ) {
      return NextResponse.json({ error: "Prompt revision request is invalid" }, { status: 400, headers: noStoreHeaders });
    }
    const { problemId } = await params;
    const revisionHash = sha256(body.revisedPrompt.trim());
    if (revisionHash === body.currentPromptHash) {
      return NextResponse.json(
        { error: "PDD returned the same prompt, so there is no new revision to apply. Test the prompt again." },
        { status: 409, headers: noStoreHeaders },
      );
    }
    assertPddPromptRevisionReceipt(body.revisionReceipt, {
      orgId: context.orgId,
      problemId,
      promptHash: body.currentPromptHash,
      revisionHash,
      storyHash: sha256(body.userStory.replace(/\s+/g, " ").trim()),
    });
    const appliedWorkflow = await applyPddPromptRevision(context.orgId, problemId, {
      currentPromptHash: body.currentPromptHash,
      revisedPrompt: body.revisedPrompt,
    }, context);
    if (!appliedWorkflow.prompt) {
      throw new Error("The applied prompt revision could not be loaded");
    }
    await markPddPromptEvaluationApplied(
      context.orgId,
      body.evaluationId,
      appliedWorkflow.prompt.id,
    );
    const workflow = await getEngineeringWorkflow(context.orgId, problemId);
    return NextResponse.json({ workflow }, { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
