import { describe, expect, it } from "vitest";
import { classificationConfidence, clusterConfidence, redactUntrustedText, validateAiAnalysisForTest } from "./ai-provider";

const analysis = {
  feedbackId: "fb_001",
  classification: "Bug" as const,
  severity: "High" as const,
  redactedSummary: "CSV export completes with an empty file.",
  proposedProblemId: "prob_export",
  evidenceQuality: 0.8,
  classificationClarity: 0.9,
  clusterMatch: 0.92,
  ambiguityPenalty: 0.1,
  evidence: ["The export output is empty."],
  rationale: "The symptom matches the existing export problem.",
};

describe("AI provider feedback intelligence boundary", () => {
  it("computes transparent confidence from evidence factors", () => {
    expect(classificationConfidence(analysis)).toBe(0.865);
    expect(clusterConfidence(analysis)).toBe(0.893);
  });

  it("redacts common secrets and direct identifiers before model processing", () => {
    const value = redactUntrustedText("Email me at user@example.com, token=abc123 or +1 (415) 555-1212");
    expect(value).not.toContain("user@example.com");
    expect(value).not.toContain("abc123");
    expect(value).not.toContain("555-1212");
  });

  it("rejects invented cluster identifiers", () => {
    expect(() => validateAiAnalysisForTest({ analyses: [{ ...analysis, proposedProblemId: "prob_invented" }] }, ["fb_001"], ["prob_export"]))
      .toThrow("outside the allowed candidate set");
  });

  it("requires every requested feedback item exactly once", () => {
    expect(() => validateAiAnalysisForTest({ analyses: [analysis] }, ["fb_001", "fb_002"], ["prob_export"]))
      .toThrow("every requested feedback ID exactly once");
  });
});
