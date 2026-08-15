import { NextRequest, NextResponse } from "next/server";
import { getAiRuntimeConfiguration } from "@/lib/ai-config";
import { getEngineeringWorkflow } from "@/lib/engineering-workflow-repository";
import { discussImplementationPrompt } from "@/lib/prompt-conversation";
import { createPromptConversationRevisionReceipt } from "@/lib/prompt-conversation-revision-receipt";
import { sha256 } from "@/lib/pdd-verification";
import {
  authorizeMutation,
  errorResponse,
  noStoreHeaders,
} from "@/lib/request-security";

const MAX_BODY_BYTES = 24_000;
const MAX_HISTORY_MESSAGES = 10;

export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ problemId: string }> },
) {
  try {
    const context = await authorizeMutation(request);
    const bodyText = await request.text();
    if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "The prompt conversation message is too large" },
        { status: 413, headers: noStoreHeaders },
      );
    }
    let body: { message?: unknown; history?: unknown };
    try {
      body = JSON.parse(bodyText) as typeof body;
    } catch {
      return NextResponse.json(
        { error: "The prompt conversation message is invalid" },
        { status: 400, headers: noStoreHeaders },
      );
    }
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 2_000) {
      return NextResponse.json(
        { error: "Enter a prompt question of 2,000 characters or fewer" },
        { status: 400, headers: noStoreHeaders },
      );
    }
    const history = Array.isArray(body.history)
      ? body.history.slice(-MAX_HISTORY_MESSAGES).flatMap((item) => {
          if (
            typeof item !== "object"
            || item === null
            || !("role" in item)
            || !("content" in item)
          ) return [];
          const candidate = item as { role?: unknown; content?: unknown };
          if (
            !["user", "assistant"].includes(String(candidate.role))
            || typeof candidate.content !== "string"
            || !candidate.content.trim()
          ) return [];
          return [{
            role: candidate.role as "user" | "assistant",
            content: candidate.content.trim().slice(0, 4_000),
          }];
        })
      : [];
    const { problemId } = await params;
    const workflow = await getEngineeringWorkflow(context.orgId, problemId);
    if (!workflow.prompt) {
      return NextResponse.json(
        { error: "Create the suggested implementation prompt before starting a conversation" },
        { status: 409, headers: noStoreHeaders },
      );
    }
    const configuration = await getAiRuntimeConfiguration(context.orgId);
    const result = await discussImplementationPrompt({
      configuration,
      implementationPrompt: workflow.prompt.content,
      message,
      history,
    });
    const revisedPrompt = result.improvement?.revisedPrompt.trim() ?? null;
    const improved = Boolean(
      revisedPrompt && revisedPrompt !== workflow.prompt.content.trim(),
    );
    const revisionReceipt = improved && revisedPrompt
      ? createPromptConversationRevisionReceipt({
          orgId: context.orgId,
          problemId,
          promptHash: workflow.prompt.contentHash,
          revisionHash: sha256(revisedPrompt),
          messageHash: sha256(message),
        })
      : null;
    return NextResponse.json({
      answer: result.answer,
      improved,
      improvementSummary: improved ? result.improvement?.summary ?? null : null,
      suggestedRevision: improved ? revisedPrompt : null,
      currentPromptHash: workflow.prompt.contentHash,
      revisionReceipt,
      provider: result.provider,
      model: result.model,
    }, { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
