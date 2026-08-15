import { NextRequest, NextResponse } from "next/server";
import { applyPddPromptRevision } from "@/lib/engineering-workflow-repository";
import { assertPromptConversationRevisionReceipt } from "@/lib/prompt-conversation-revision-receipt";
import { sha256 } from "@/lib/pdd-verification";
import {
  authorizeMutation,
  errorResponse,
  noStoreHeaders,
} from "@/lib/request-security";

const MAX_BODY_BYTES = 72_000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ problemId: string }> },
) {
  try {
    const context = await authorizeMutation(request);
    const bodyText = await request.text();
    if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "The prompt conversation revision is too large" },
        { status: 413, headers: noStoreHeaders },
      );
    }
    let body: {
      message?: unknown;
      currentPromptHash?: unknown;
      revisedPrompt?: unknown;
      revisionReceipt?: unknown;
    };
    try {
      body = JSON.parse(bodyText) as typeof body;
    } catch {
      return NextResponse.json(
        { error: "The prompt conversation revision request is invalid" },
        { status: 400, headers: noStoreHeaders },
      );
    }
    if (
      typeof body.message !== "string"
      || typeof body.currentPromptHash !== "string"
      || typeof body.revisedPrompt !== "string"
      || !body.message.trim()
      || !body.revisedPrompt.trim()
      || body.revisedPrompt.length > 64_000
    ) {
      return NextResponse.json(
        { error: "The prompt conversation revision request is invalid" },
        { status: 400, headers: noStoreHeaders },
      );
    }
    const { problemId } = await params;
    const revisedPrompt = body.revisedPrompt.trim();
    assertPromptConversationRevisionReceipt(body.revisionReceipt, {
      orgId: context.orgId,
      problemId,
      promptHash: body.currentPromptHash,
      revisionHash: sha256(revisedPrompt),
      messageHash: sha256(body.message.trim()),
    });
    const workflow = await applyPddPromptRevision(context.orgId, problemId, {
      currentPromptHash: body.currentPromptHash,
      revisedPrompt,
      source: "CloseSpan conversation",
    }, context);
    return NextResponse.json({ workflow }, { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
