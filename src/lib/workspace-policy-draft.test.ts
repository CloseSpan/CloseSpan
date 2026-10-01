import { describe, expect, it } from "vitest";
import { defaultPromptDraftPolicy } from "./prompt-draft-policy";
import { workspacePolicyDraftKey } from "./workspace-policy-draft";
import type { WorkspacePolicyInput } from "./workspace-settings-repository";

const policy: WorkspacePolicyInput = {
  autonomyLevel: "Execute with approval",
  piiRedaction: true,
  retentionDays: 365,
  priorityWeights: { severity: 40, frequency: 30, revenue: 30 },
  promptDraftPolicy: { ...defaultPromptDraftPolicy },
  promptEvaluationMode: "pdd_cloud",
};

describe("workspace policy change detection", () => {
  it("treats an untouched or reverted draft as unchanged", () => {
    const saved = workspacePolicyDraftKey(policy);
    const draft = { ...policy, retentionDays: 90 };
    expect(workspacePolicyDraftKey(draft)).not.toBe(saved);
    draft.retentionDays = 365;
    expect(workspacePolicyDraftKey(draft)).toBe(saved);
  });

  it("ignores property order in server responses", () => {
    expect(workspacePolicyDraftKey({
      ...policy,
      priorityWeights: Object.fromEntries(Object.entries(policy.priorityWeights).reverse()),
      promptDraftPolicy: Object.fromEntries(Object.entries(policy.promptDraftPolicy).reverse()) as unknown as WorkspacePolicyInput["promptDraftPolicy"],
    })).toBe(workspacePolicyDraftKey(policy));
  });

  it.each([
    { autonomyLevel: "Recommend" },
    { piiRedaction: false },
    { retentionDays: 90 },
    { priorityWeights: { severity: 30, frequency: 40, revenue: 30 } },
    { promptEvaluationMode: "pdd_local" },
    ...Object.entries(policy.promptDraftPolicy).map(([key, value]) => ({
      promptDraftPolicy: { ...policy.promptDraftPolicy, [key]: typeof value === "boolean" ? !value : typeof value === "number" ? value + 0.05 : "changed" },
    })),
  ] satisfies Partial<WorkspacePolicyInput>[])("detects a saved policy field changing: %j", (change) => {
    expect(workspacePolicyDraftKey({ ...policy, ...change })).not.toBe(workspacePolicyDraftKey(policy));
  });
});
