import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  FeedbackReviewConflictError,
  FeedbackReviewNotFoundError,
  reviewLatestFeedbackAnalysis,
} from "@/lib/feedback-review-repository";
import {
  authorizeMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";
import { createAutomatedInvestigationForProblem } from "@/lib/investigation-repository";

export const runtime = "nodejs";

const feedbackId = z.string().min(1).max(128);
const problemId = z.string().min(1).max(128);
const requestSchema = z.discriminatedUnion("decision", [
  z.object({
    feedbackId,
    decision: z.literal("approve"),
    problemId: problemId.nullable().optional(),
  }).strict(),
  z.object({
    feedbackId,
    decision: z.literal("reject"),
  }).strict(),
]);

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeMutation(request);
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      throw new HttpError(
        400,
        "Choose valid feedback and approve or reject its latest analysis",
      );
    const result = await reviewLatestFeedbackAnalysis({
        orgId: context.orgId,
        feedbackId: parsed.data.feedbackId,
        decision: parsed.data.decision,
        problemId: parsed.data.decision === "approve"
          ? parsed.data.problemId
          : undefined,
        context,
      });
    const investigation = parsed.data.decision === "approve" && result.problem
      ? await createAutomatedInvestigationForProblem(
          context.orgId,
          result.problem.id,
        ).catch((error: unknown) => {
          console.error("[feedback-analysis:investigation]", {
            errorType: error instanceof Error ? error.name : "UnknownError",
            problemId: result.problem?.id,
          });
          return undefined;
        })
      : undefined;
    return NextResponse.json(
      { ...result, investigation },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    if (error instanceof FeedbackReviewNotFoundError)
      return errorResponse(new HttpError(404, error.message));
    if (error instanceof FeedbackReviewConflictError)
      return errorResponse(new HttpError(409, error.message));
    if (error instanceof HttpError) return errorResponse(error);
    console.error("[feedback-analysis:review]", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(
      new HttpError(
        500,
        "This feedback review could not be saved. Try again shortly.",
      ),
    );
  }
}
