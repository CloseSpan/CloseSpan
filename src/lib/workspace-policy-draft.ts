import type { WorkspacePolicyInput } from "./workspace-settings-repository";

/** Compare saved values, not interaction history or JSON property order. */
export function workspacePolicyDraftKey(policy: WorkspacePolicyInput): string {
  return JSON.stringify([
    policy.autonomyLevel,
    policy.piiRedaction,
    policy.retentionDays,
    Object.entries(policy.priorityWeights).sort(([a], [b]) => a.localeCompare(b)),
    Object.entries(policy.promptDraftPolicy).sort(([a], [b]) => a.localeCompare(b)),
    policy.promptEvaluationMode,
  ]);
}
