import { describe, expect, it } from "vitest";
import { pddPromptReviewSchema } from "./pdd-prompt-review";

describe("PDD prompt review contract", () => {
  it("accepts a compact actionable PDD result without an invented score", () => {
    const result = pddPromptReviewSchema.parse({
      verdict: "Needs revision",
      summary: "PDD found 1 change to make before approval.",
      changes: ["Require the downloaded CSV to contain every expected row."],
      suggestedRevision: "Ensure large exports contain every expected row.",
      pddVersion: "0.0.309",
      executionMode: "cloud",
      model: "gpt-5.6-sol",
      costUsd: 0.02,
      promptHash: "a".repeat(64),
      alignmentReceipt: null,
      revisionReceipt: "signed.receipt",
    });
    expect(result.verdict).toBe("Needs revision");
    expect(result).not.toHaveProperty("score");
  });
});
