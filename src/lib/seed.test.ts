import { describe, expect, it } from "vitest";
import { approval, feedback, ORG_ID, otherProblems, primaryProblem, recommendation } from "./seed";

describe("seed referential integrity", () => {
  it("keeps every core record in the seeded organization", () => {
    expect(feedback.every((item) => item.orgId === ORG_ID)).toBe(true);
    expect(primaryProblem.orgId).toBe(ORG_ID);
    expect(recommendation.orgId).toBe(ORG_ID);
    expect(approval.orgId).toBe(ORG_ID);
  });

  it("resolves every feedback problem reference", () => {
    const ids = new Set([primaryProblem.id, ...otherProblems.map((problem) => problem.id)]);
    expect(feedback.filter((item) => item.problemId).every((item) => ids.has(item.problemId!))).toBe(true);
    expect(primaryProblem.feedbackIds.every((id) => feedback.some((item) => item.id === id))).toBe(true);
  });

  it("keeps confidence values normalized", () => {
    expect(feedback.every((item) => item.confidence >= 0 && item.confidence <= 1)).toBe(true);
    expect(primaryProblem.confidence).toBeGreaterThanOrEqual(0);
    expect(primaryProblem.confidence).toBeLessThanOrEqual(1);
  });
});
