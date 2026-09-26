import { z } from "zod";
import type { PddPromptReview } from "./pdd-prompt-review";

export const issueScenarioCheckSchema = z.object({
  userStory: z.string().trim().min(3).max(2_000),
  currentPromptHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export interface IssueScenarioCheckResult {
  status: "completed" | "processing" | "failed";
  replayed: boolean;
  promptHash: string;
  evaluationId?: string;
  promptEvaluation?: PddPromptReview;
  notice?: string;
}

export interface IssueScenarioCheckView {
  check: IssueScenarioCheckResult | null;
  currentPromptHash: string | null;
  storageReady: boolean;
  notice?: string;
}
