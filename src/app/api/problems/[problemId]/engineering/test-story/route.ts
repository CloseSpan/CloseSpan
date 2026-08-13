import { NextRequest, NextResponse } from "next/server";
import {
  getPromptAlignmentContext,
} from "@/lib/engineering-workflow-repository";
import { createPromptAlignmentReceipt } from "@/lib/prompt-alignment-receipt";
import { PDD_CLI_VERSION, sha256 } from "@/lib/pdd-verification";
import { evaluateWorkspacePrompt } from "@/lib/workspace-prompt-evaluation";
import {
  buildPddRequiredRevision,
  pddPromptReviewSchema,
} from "@/lib/pdd-prompt-review";
import {
  readPddPromptTimingSummary,
  recordPddPromptEvaluationTiming,
} from "@/lib/pdd-prompt-timing-repository";
import { createPddPromptRevisionReceipt } from "@/lib/pdd-prompt-revision-receipt";
import {
  beginPddPromptEvaluation,
  completePddPromptEvaluation,
  failPddPromptEvaluation,
  readPddAcceptanceContract,
  type PddPromptEvaluationTrigger,
} from "@/lib/pdd-prompt-evaluation-repository";
import {
  authorizeMutation,
  errorResponse,
  noStoreHeaders,
} from "@/lib/request-security";

const MAX_BODY_BYTES = 8_192;
export const maxDuration = 300;

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
    const triggerSource: PddPromptEvaluationTrigger =
      typeof body === "object"
      && body !== null
      && "triggerSource" in body
      && (body as { triggerSource?: unknown }).triggerSource === "automatic"
        ? "automatic"
        : "manual";
    const { problemId } = await params;
    const promptContext = await getPromptAlignmentContext(
      context.orgId,
      problemId,
      userStory,
      context,
    );
    const specification = promptContext.workflow.specification;
    if (!specification) {
      return NextResponse.json(
        { error: "The engineering specification is not ready for prompt evaluation" },
        { status: 409, headers: noStoreHeaders },
      );
    }
    const storyHash = sha256(
      promptContext.userStory.replace(/\s+/g, " ").trim(),
    );
    const evaluationRun = await beginPddPromptEvaluation({
      orgId: context.orgId,
      problemId,
      specificationId: specification.id ?? problemId,
      specificationRevision: specification.revision ?? 1,
      promptRevisionId: promptContext.promptId,
      promptHash: promptContext.promptHash,
      userStory: promptContext.userStory,
      storyHash,
      triggerSource,
    });
    if (!evaluationRun.shouldRun) {
      const message = evaluationRun.evaluation.status === "Running"
        ? "The automatic PDD evaluation is already running for this ticket revision."
        : "PDD already ran automatically for this ticket revision. Review the saved result or choose Test with PDD to run it manually.";
      return NextResponse.json(
        { error: message, evaluation: evaluationRun.evaluation },
        { status: 409, headers: noStoreHeaders },
      );
    }
    const timingStartedAt = Date.now();
    try {
      const acceptanceContract =
        promptContext.workflow.promptEvaluation?.review?.acceptanceContract
        ?? await readPddAcceptanceContract(
          context.orgId,
          problemId,
          promptContext.promptId,
        );
      const evaluation = await evaluateWorkspacePrompt({
        orgId: context.orgId,
        promptHash: promptContext.promptHash,
        userStory: promptContext.userStory,
        implementationPrompt: promptContext.implementationPrompt,
        acceptanceContract,
        pddVersion: PDD_CLI_VERSION,
      });
      const alignmentReceipt =
      evaluation.verdict === "Passed"
        ? createPromptAlignmentReceipt({
            orgId: context.orgId,
            problemId,
            promptHash: promptContext.promptHash,
            storyHash,
          })
        : null;
    let suggestedRevision: string | null = null;
    if (evaluation.verdict === "Needs revision") {
      suggestedRevision = buildPddRequiredRevision(
        promptContext.implementationPrompt,
        evaluation.changes,
      );
    }
    const promptEvaluation = pddPromptReviewSchema.parse({
      ...evaluation,
      summary: evaluation.verdict === "Passed"
        ? "The suggested prompt covers the outcome in your user story."
        : `PDD found ${evaluation.changes.length} ${evaluation.changes.length === 1 ? "change" : "changes"} to make before approval.`,
      suggestedRevision,
      alignmentReceipt,
      revisionReceipt: suggestedRevision
        ? createPddPromptRevisionReceipt({
            orgId: context.orgId,
            problemId,
            promptHash: promptContext.promptHash,
            revisionHash: sha256(suggestedRevision),
            storyHash,
          })
        : null,
    });
    await completePddPromptEvaluation(
      context.orgId,
      evaluationRun.evaluation.id,
      promptEvaluation,
    );
    const durationMs = Date.now() - timingStartedAt;
    await recordPddPromptEvaluationTiming({
      orgId: context.orgId,
      problemId,
      status: "Succeeded",
      durationMs,
    }).catch(() => undefined);
    const timing = await readPddPromptTimingSummary(context.orgId).catch(() => ({
      estimatedDurationMs: durationMs,
      averageDurationMs: durationMs,
      sampleCount: 1,
    }));
      return NextResponse.json(
        {
          workflow: promptContext.workflow,
          evaluationId: evaluationRun.evaluation.id,
          promptEvaluation,
          timing: { ...timing, durationMs },
        },
        { headers: noStoreHeaders },
      );
    } catch (error) {
      await failPddPromptEvaluation(
        context.orgId,
        evaluationRun.evaluation.id,
        error instanceof Error ? error.message : "PDD prompt evaluation failed",
      ).catch(() => undefined);
      await recordPddPromptEvaluationTiming({
        orgId: context.orgId,
        problemId,
        status: "Failed",
        durationMs: Date.now() - timingStartedAt,
      }).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
