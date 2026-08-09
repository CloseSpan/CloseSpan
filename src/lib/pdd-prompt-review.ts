import { z } from "zod";

export const pddPromptReviewSchema = z.object({
  verdict: z.enum(["Passed", "Needs revision"]),
  summary: z.string().trim().min(1).max(300),
  changes: z.array(z.string().trim().min(1).max(500)).max(8),
  suggestedRevision: z.string().trim().min(1).max(64_000).nullable(),
  pddVersion: z.string().trim().min(1).max(64),
  executionMode: z.enum(["cloud", "local"]),
  model: z.string().trim().min(1).max(200).nullable(),
  costUsd: z.number().min(0).max(5).nullable(),
  promptHash: z.string().regex(/^[a-f0-9]{64}$/),
  alignmentReceipt: z.string().max(4_096).nullable(),
  revisionReceipt: z.string().max(4_096).nullable(),
});

export type PddPromptReview = z.infer<typeof pddPromptReviewSchema>;
