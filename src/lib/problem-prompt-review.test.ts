import { describe, expect, it } from "vitest";
import { problemReviewDecisionSchema, reviewDecisionIssue, type ProblemPromptReview } from "./problem-prompt-review";

const hash = "a".repeat(64);
const review: ProblemPromptReview = { status: "Ready", version: 3, promptHash: hash, userStory: "Expected behavior",
  feedback: "", result: { verdict: "Passed", summary: "Covered", changes: [] }, failureMessage: null, confirmedAt: null, updatedAt: "2026-09-06T00:00:00Z" };
const input = { review, version: 3, promptHash: hash, currentPromptHash: hash, executionStarted: false };

describe("domain prompt review", () => {
  it("only accepts the exact passing revision", () => {
    expect(reviewDecisionIssue(input)).toBeNull();
    expect(reviewDecisionIssue({ ...input, version: 2 })).toMatch(/changed/);
    expect(reviewDecisionIssue({ ...input, currentPromptHash: "b".repeat(64) })).toMatch(/changed/);
    expect(reviewDecisionIssue({ ...input, review: { ...review, status: "Testing" } })).toMatch(/finish testing/);
    expect(reviewDecisionIssue({ ...input, review: { ...review, result: null } })).toMatch(/finish testing/);
  });
  it("cannot overwrite an existing execution authorization", () => {
    expect(reviewDecisionIssue({ ...input, executionStarted: true })).toMatch(/execution approval/);
  });
  it("requires actionable feedback for changes, and rejects oversized or extra fields", () => {
    const decision = { version: 3, promptHash: hash, decision: "changes" };
    expect(problemReviewDecisionSchema.safeParse(decision).success).toBe(false);
    expect(problemReviewDecisionSchema.safeParse({ ...decision, feedback: "Keep the existing Edit action." }).success).toBe(true);
    expect(problemReviewDecisionSchema.safeParse({ ...decision, feedback: "a".repeat(1001) }).success).toBe(false);
    expect(problemReviewDecisionSchema.safeParse({ ...decision, decision: "confirm", orgId: "other-org" }).success).toBe(false);
  });
});
