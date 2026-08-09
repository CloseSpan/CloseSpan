import { NextRequest, NextResponse } from "next/server";
import { applyPddPromptRevision } from "@/lib/engineering-workflow-repository";
import { assertPddPromptRevisionReceipt } from "@/lib/pdd-prompt-revision-receipt";
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
      userStory?: unknown; currentPromptHash?: unknown; revisedPrompt?: unknown; revisionReceipt?: unknown;
    };
    if (typeof body.userStory !== "string" || typeof body.currentPromptHash !== "string" || typeof body.revisedPrompt !== "string") {
      return NextResponse.json({ error: "Prompt revision request is invalid" }, { status: 400, headers: noStoreHeaders });
    }
    const { problemId } = await params;
    assertPddPromptRevisionReceipt(body.revisionReceipt, {
      orgId: context.orgId,
      problemId,
      promptHash: body.currentPromptHash,
      revisionHash: sha256(body.revisedPrompt.trim()),
      storyHash: sha256(body.userStory.replace(/\s+/g, " ").trim()),
    });
    const workflow = await applyPddPromptRevision(context.orgId, problemId, {
      currentPromptHash: body.currentPromptHash,
      revisedPrompt: body.revisedPrompt,
    }, context);
    return NextResponse.json({ workflow }, { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
