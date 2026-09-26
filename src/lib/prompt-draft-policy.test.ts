import { describe, expect, it } from "vitest";
import {
  assessPromptDraftEligibility,
  defaultPromptDraftPolicy,
  resolvePromptDraftReviewer,
  sanitizePromptDraftPolicy,
} from "./prompt-draft-policy";

describe("automatic prompt draft policy", () => {
  it("defaults to an admin deterministically, independently of member ordering", () => {
    const members = [{ id: "member", role: "Member" }, { id: "admin-b", role: "Admin" }, { id: "admin-a", role: "Admin" }];
    expect(resolvePromptDraftReviewer(null, members)).toBe("admin-a");
    expect(resolvePromptDraftReviewer(null, [...members].reverse())).toBe("admin-a");
    expect(resolvePromptDraftReviewer("member", members)).toBe("member");
    expect(resolvePromptDraftReviewer(null, [{ id: "member", role: "Member" }])).toBeNull();
  });
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

  it("requires one report, 65% confidence, and a suggested solution by default", () => {
    const policy = { ...defaultPromptDraftPolicy, mode: "automatic" as const };
    expect(policy.minimumEvidence).toBe(1);
    expect(policy.minimumConfidence).toBe(0.65);
    expect(assessPromptDraftEligibility(policy, { ...evidence, evidenceCount: 0 }).eligible).toBe(false);
    expect(assessPromptDraftEligibility(policy, { ...evidence, confidence: 0.64 }).eligible).toBe(false);
    expect(assessPromptDraftEligibility(policy, { ...evidence, evidenceCount: 1, confidence: 0.65 }).eligible).toBe(true);
    expect(assessPromptDraftEligibility(policy, { ...evidence, hasInvestigation: false }).eligible).toBe(false);
    expect(assessPromptDraftEligibility(policy, evidence).eligible).toBe(true);
  });

  it("normalizes legacy report thresholds but preserves custom confidence", () => {
    const policy = sanitizePromptDraftPolicy({ ...defaultPromptDraftPolicy, minimumEvidence: 20, minimumConfidence: 0.9 });
    expect(policy.minimumEvidence).toBe(1);
    expect(policy.minimumConfidence).toBe(0.9);
    expect(assessPromptDraftEligibility({ ...policy, mode: "automatic" }, { ...evidence, confidence: 0.85 }).eligible).toBe(false);
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
