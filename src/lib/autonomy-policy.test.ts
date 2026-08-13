import { describe, expect, it } from "vitest";
import {
  autonomyCapabilities,
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
  it("exposes only the four enforced levels", () => {
    expect(autonomyLevels).toEqual([
      "Observe",
      "Recommend",
      "Execute with approval",
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
      automaticallyAuthorizeFinalExecution: true,
    });
  });

  it("forces automatic drafting for a complete full-autonomy workflow", () => {
    const policy = sanitizeWorkspacePolicy({ ...basePolicy, autonomyLevel: "Full autonomy" });
    expect(policy.promptDraftPolicy.mode).toBe("automatic");
    expect(policy.promptEvaluationMode).toBe(DEFAULT_PROMPT_EVALUATION_MODE);
  });

  it("maps legacy or unknown values to the safe approval workflow", () => {
    expect(normalizeAutonomyLevel("Limited autonomy")).toBe("Execute with approval");
    expect(normalizeAutonomyLevel(undefined)).toBe("Execute with approval");
  });
});
