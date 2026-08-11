import { NextRequest, NextResponse } from "next/server";
import {
  getPromptAlignmentContext,
} from "@/lib/engineering-workflow-repository";
import { getAiRuntimeConfiguration } from "@/lib/ai-config";
import { evaluatePromptAlignment } from "@/lib/prompt-alignment-evaluation";
import { createPromptAlignmentReceipt } from "@/lib/prompt-alignment-receipt";
import { PDD_CLI_VERSION, sha256 } from "@/lib/pdd-verification";
import { evaluatePromptWithPdd } from "@/lib/pdd-runner-client";
import { pddPromptReviewSchema } from "@/lib/pdd-prompt-review";
import {
  readPddPromptTimingSummary,
  recordPddPromptEvaluationTiming,
} from "@/lib/pdd-prompt-timing-repository";
import { createPddPromptRevisionReceipt } from "@/lib/pdd-prompt-revision-receipt";
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
    const { problemId } = await params;
    const promptContext = await getPromptAlignmentContext(
      context.orgId,
      problemId,
      userStory,
      context,
    );
    const timingStartedAt = Date.now();
    let evaluation;
    try {
      evaluation = await evaluatePromptWithPdd({
        promptHash: promptContext.promptHash,
        userStory: promptContext.userStory,
        implementationPrompt: promptContext.implementationPrompt,
        pddVersion: PDD_CLI_VERSION,
      });
    } catch (error) {
      await recordPddPromptEvaluationTiming({
        orgId: context.orgId,
        problemId,
        status: "Failed",
        durationMs: Date.now() - timingStartedAt,
      }).catch(() => undefined);
      throw error;
    }
    const alignmentReceipt =
      evaluation.verdict === "Passed"
        ? createPromptAlignmentReceipt({
            orgId: context.orgId,
            problemId,
            promptHash: promptContext.promptHash,
            storyHash: sha256(
              promptContext.userStory.replace(/\s+/g, " ").trim(),
            ),
          })
        : null;
    let suggestedRevision: string | null = null;
    if (evaluation.verdict === "Needs revision") {
      const deterministicRevision = [
        promptContext.implementationPrompt.trim(),
        "",
        "## PDD-required outcomes",
        ...evaluation.changes.map((change) => `- ${change}`),
        "",
        `Product-manager user story: ${promptContext.userStory}`,
      ].join("\n");
      suggestedRevision = deterministicRevision;
      try {
        const configuration = await getAiRuntimeConfiguration(context.orgId);
        if (configuration.apiKey) {
          const revision = await evaluatePromptAlignment({
            configuration,
            userStory: promptContext.userStory,
            implementationPrompt: deterministicRevision,
          });
          suggestedRevision = revision.suggestedRevision ?? deterministicRevision;
        }
      } catch {
        // PDD owns the verdict and required changes. A model-assisted rewrite
        // is optional, so provider downtime must not discard a valid PDD review.
      }
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
            storyHash: sha256(promptContext.userStory.replace(/\s+/g, " ").trim()),
          })
        : null,
    });
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
        promptEvaluation,
        timing: { ...timing, durationMs },
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
