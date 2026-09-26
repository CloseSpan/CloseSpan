import { describe, expect, it } from "vitest";
import {
  autonomyCapabilities,
  automaticCodingBudgetAllowsExecution,
  autonomyLevels,
  normalizeAutonomyLevel,
} from "./autonomy-policy";
import { sanitizeWorkspacePolicy } from "./workspace-settings-repository";
import { DEFAULT_PROMPT_EVALUATION_MODE } from "./prompt-evaluation-policy";

const basePolicy = {
  piiRedaction: true,
  retentionDays: 365,
  priorityWeights: { confidence: 100 },
  promptDraftPolicy: {
    mode: "manual",
    bugReports: true,
    featureRequests: false,
    minimumEvidence: 2,
    minimumConfidence: 0.65,
    inAppNotifications: true,
    emailNotifications: false,
    reviewerId: null,
  },
};

describe("agent autonomy policy", () => {
  it("accepts automatic coding while retaining saved legacy levels", () => {
    expect(autonomyLevels).toEqual([
      "Observe",
      "Recommend",
      "Execute with approval",
      "Automatic coding, human merge",
      "Full autonomy",
    ]);
    expect(() => sanitizeWorkspacePolicy({ ...basePolicy, autonomyLevel: "Limited autonomy" }))
      .toThrow();
  });

  it("keeps preparation and execution boundaries distinct", () => {
    expect(autonomyCapabilities("Observe")).toMatchObject({
      investigate: false,
      preparePrompt: false,
      requestAgentExecution: false,
    });
    expect(autonomyCapabilities("Recommend")).toMatchObject({
      investigate: true,
      preparePrompt: true,
      requestAgentExecution: false,
    });
    expect(autonomyCapabilities("Execute with approval")).toMatchObject({
      requestAgentExecution: true,
      automaticallyAuthorizeExecution: false,
      automaticallyAuthorizeFinalExecution: false,
    });
    expect(autonomyCapabilities("Full autonomy")).toMatchObject({
      requestAgentExecution: true,
      automaticallyAuthorizeExecution: true,
      automaticallyAuthorizeFinalExecution: false,
    });
    expect(autonomyCapabilities("Automatic coding, human merge")).toMatchObject({
      requestAgentExecution: true,
      automaticallyAuthorizeExecution: true,
      automaticallyAuthorizeFinalExecution: false,
    });
  });

  it.each(["Full autonomy", "Automatic coding, human merge"])("enables automatic drafting for %s", (autonomyLevel) => {
    const policy = sanitizeWorkspacePolicy({ ...basePolicy, autonomyLevel });
    expect(policy.promptDraftPolicy.mode).toBe("automatic");
    expect(policy.promptEvaluationMode).toBe(DEFAULT_PROMPT_EVALUATION_MODE);
    expect(normalizeAutonomyLevel(autonomyLevel)).toBe(autonomyLevel);
  });

  it.each(autonomyLevels)("never grants automatic final execution under %s", (level) => {
    expect(autonomyCapabilities(level).automaticallyAuthorizeFinalExecution).toBe(false);
  });

  it("fails closed on missing, exhausted, invalid, or non-enforced recorded budgets", () => {
    const budget = { monthly_model_budget: 100, used_model_cost: 20, hard_stop: true };
    expect(automaticCodingBudgetAllowsExecution(budget)).toBe(true);
    for (const invalid of [
      undefined,
      { ...budget, hard_stop: false },
      { ...budget, monthly_model_budget: 0 },
      { ...budget, monthly_model_budget: Infinity },
      { ...budget, used_model_cost: NaN },
      { ...budget, used_model_cost: -1 },
      { ...budget, used_model_cost: 100 },
      { ...budget, used_model_cost: 101 },
    ]) expect(automaticCodingBudgetAllowsExecution(invalid)).toBe(false);
  });

  it("maps legacy or unknown values to the safe approval workflow", () => {
    expect(normalizeAutonomyLevel("Limited autonomy")).toBe("Execute with approval");
    expect(normalizeAutonomyLevel(undefined)).toBe("Execute with approval");
  });
});
