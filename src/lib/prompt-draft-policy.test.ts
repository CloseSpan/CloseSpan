import { describe, expect, it } from "vitest";
import {
  assessPromptDraftEligibility,
  defaultPromptDraftPolicy,
} from "./prompt-draft-policy";

describe("automatic prompt draft policy", () => {
  const evidence = {
    kind: "Bug" as const,
    evidenceCount: 3,
    confidence: 0.82,
    hasInvestigation: true,
    hasExistingWorkflow: false,
  };

  it("defaults to manual and cannot silently create a prompt", () => {
    expect(assessPromptDraftEligibility(defaultPromptDraftPolicy, evidence))
      .toMatchObject({ eligible: false, reason: "Automatic prompt drafting is disabled." });
  });

  it("requires grouped evidence, confidence, and a suggested solution", () => {
    const policy = { ...defaultPromptDraftPolicy, mode: "automatic" as const };
    expect(assessPromptDraftEligibility(policy, { ...evidence, evidenceCount: 2 }).eligible).toBe(false);
    expect(assessPromptDraftEligibility(policy, { ...evidence, confidence: 0.7 }).eligible).toBe(false);
    expect(assessPromptDraftEligibility(policy, { ...evidence, hasInvestigation: false }).eligible).toBe(false);
    expect(assessPromptDraftEligibility(policy, evidence).eligible).toBe(true);
  });

  it("keeps bug and feature automation independently configurable", () => {
    const policy = {
      ...defaultPromptDraftPolicy,
      mode: "automatic" as const,
      bugReports: false,
      featureRequests: true,
    };
    expect(assessPromptDraftEligibility(policy, evidence).eligible).toBe(false);
    expect(assessPromptDraftEligibility(policy, { ...evidence, kind: "Feature request" }).eligible).toBe(true);
  });
});
