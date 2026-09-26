import { z } from "zod";

export interface IssueResultBinding {
  runId: string;
  commitSha: string;
  promptHash: string;
}

export interface IssueResultDecision extends IssueResultBinding {
  id: string;
  version: number;
  decision: "accept" | "changes";
  feedback: string;
  actorName: string;
  createdAt: string;
  current: boolean;
}

export interface IssueResultReviewState {
  storageReady: boolean;
  binding: IssueResultBinding | null;
  version: number;
  latestDecision: IssueResultDecision | null;
  canReview: boolean;
  unavailableReason: string | null;
  reworkRecommendation: string | null;
  rework?: { available: boolean; unavailableReason: string | null; runId: string | null };
}

export const issueResultReviewSchema = z.object({
  runId: z.uuid(),
  commitSha: z.string().regex(/^[a-f0-9]{40,64}$/),
  promptHash: z.string().regex(/^[a-f0-9]{64}$/),
  version: z.number().int().nonnegative(),
  decision: z.enum(["accept", "changes"]),
  feedback: z.string().trim().max(4000).default(""),
}).strict().superRefine((input, context) => {
  if (input.decision === "changes" && !input.feedback) {
    context.addIssue({ code: "custom", path: ["feedback"], message: "Describe what needs to change in the result." });
  }
});

export const resultReworkRecommendation = "A workspace administrator needs to review this feedback and authorize scoped rework against the existing expected behavior. Recording feedback does not start a coding run.";

/** Enable only after the serving executor accepts domain_result_rework jobs. */
export function domainResultReworkEnabled(): boolean {
  return process.env.CLOSESPAN_DOMAIN_RESULT_REWORK_ENABLED === "true";
}

export function resultBindingMatches(left: IssueResultBinding, right: IssueResultBinding | null): boolean {
  return Boolean(right && left.runId === right.runId && left.commitSha === right.commitSha && left.promptHash === right.promptHash);
}
