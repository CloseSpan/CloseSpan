import { z } from "zod";

export const problemReviewDecisionSchema = z.object({
  version: z.number().int().positive(),
  promptHash: z.string().regex(/^[a-f0-9]{64}$/),
  decision: z.enum(["confirm", "changes"]),
  feedback: z.string().trim().max(1000).default(""),
}).strict().superRefine((value, context) => {
  if (value.decision === "changes" && !value.feedback) {
    context.addIssue({ code: "custom", path: ["feedback"], message: "Describe what needs to change." });
  }
  if (value.decision === "confirm" && value.feedback) {
    context.addIssue({ code: "custom", path: ["feedback"], message: "Submit feedback with Needs changes so the agent can test it first." });
  }
});

export type ProblemPromptReviewStatus = "Queued" | "Waiting for verification" | "Testing"
  | "Ready" | "Confirmed" | "Preparing tests" | "Awaiting approval" | "Needs attention";

export interface ProblemPromptReview {
  status: ProblemPromptReviewStatus;
  version: number;
  promptHash: string | null;
  userStory: string;
  feedback: string;
  result: { verdict: "Passed" | "Needs revision"; summary: string; changes: string[] } | null;
  failureMessage: string | null;
  confirmedAt: string | null;
  updatedAt: string;
}

export function reviewDecisionIssue(input: {
  review: ProblemPromptReview;
  version: number;
  promptHash: string;
  currentPromptHash: string | null;
  executionStarted: boolean;
}): string | null {
  if (input.executionStarted) return "This version already has an execution approval. Review that approval before changing it.";
  if (input.review.version !== input.version || input.review.promptHash !== input.promptHash
    || input.currentPromptHash !== input.promptHash) return "The test changed. Refresh and review the latest result.";
  if (input.review.status !== "Ready" || input.review.result?.verdict !== "Passed") {
    return "The agent must finish testing this version before you can confirm it.";
  }
  return null;
}

export const pendingReviewStatuses: ProblemPromptReviewStatus[] = [
  "Queued", "Waiting for verification", "Testing", "Confirmed", "Preparing tests",
];
