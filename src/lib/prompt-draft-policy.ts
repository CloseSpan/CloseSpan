import { z } from "zod";

export const promptDraftModes = ["manual", "automatic"] as const;
export type PromptDraftMode = (typeof promptDraftModes)[number];

export interface PromptDraftPolicy {
  mode: PromptDraftMode;
  bugReports: boolean;
  featureRequests: boolean;
  minimumEvidence: number;
  minimumConfidence: number;
  inAppNotifications: boolean;
  emailNotifications: boolean;
  reviewerId: string | null;
}

export const defaultPromptDraftPolicy: PromptDraftPolicy = {
  mode: "manual",
  bugReports: true,
  featureRequests: true,
  minimumEvidence: 3,
  minimumConfidence: 0.75,
  inAppNotifications: true,
  emailNotifications: false,
  reviewerId: null,
};

export const promptDraftPolicySchema = z.object({
  mode: z.enum(promptDraftModes),
  bugReports: z.boolean(),
  featureRequests: z.boolean(),
  minimumEvidence: z.number().int().min(1).max(100),
  minimumConfidence: z.number().min(0.5).max(1),
  inAppNotifications: z.boolean(),
  emailNotifications: z.boolean(),
  reviewerId: z.string().trim().min(1).max(200).nullable(),
});

export function sanitizePromptDraftPolicy(input: unknown): PromptDraftPolicy {
  return promptDraftPolicySchema.parse(input);
}

export interface PromptDraftCandidateEvidence {
  kind: "Bug" | "Feature request" | "Other";
  evidenceCount: number;
  confidence: number;
  hasInvestigation: boolean;
  hasExistingWorkflow: boolean;
}

export interface PromptDraftEligibility {
  eligible: boolean;
  reason: string;
}

export function assessPromptDraftEligibility(
  policy: PromptDraftPolicy,
  evidence: PromptDraftCandidateEvidence,
): PromptDraftEligibility {
  if (policy.mode !== "automatic")
    return { eligible: false, reason: "Automatic prompt drafting is disabled." };
  if (evidence.hasExistingWorkflow)
    return { eligible: false, reason: "An engineering draft or prompt already exists." };
  if (evidence.kind === "Bug" && !policy.bugReports)
    return { eligible: false, reason: "Automatic bug prompt drafts are disabled." };
  if (evidence.kind === "Feature request" && !policy.featureRequests)
    return { eligible: false, reason: "Automatic feature prompt drafts are disabled." };
  if (evidence.kind === "Other")
    return { eligible: false, reason: "This feedback type does not create implementation drafts." };
  if (evidence.evidenceCount < policy.minimumEvidence)
    return { eligible: false, reason: `Waiting for ${policy.minimumEvidence} grouped reports.` };
  if (evidence.confidence < policy.minimumConfidence)
    return { eligible: false, reason: `Waiting for ${Math.round(policy.minimumConfidence * 100)}% confidence.` };
  if (!evidence.hasInvestigation)
    return { eligible: false, reason: "Waiting for an agent investigation and suggested solution." };
  return {
    eligible: true,
    reason: `${evidence.evidenceCount} grouped reports and ${Math.round(evidence.confidence * 100)}% confidence satisfy workspace policy.`,
  };
}
