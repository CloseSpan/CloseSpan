import { describe, expect, it } from "vitest";
import { promptAlignmentEvaluationSchema } from "./prompt-alignment-evaluation";

describe("prompt alignment evaluation contract", () => {
  it("accepts a bounded prompt-to-prompt result", () => {
    expect(
      promptAlignmentEvaluationSchema.parse({
        verdict: "Aligned",
        score: 92,
        summary: "The prompt preserves the requested outcome.",
        strengths: ["The actor and business outcome are explicit."],
        gaps: [],
        acceptanceScenarios: [
          {
            title: "Large export",
            given: "A report contains one gigabyte of data",
            when: "The user exports the report",
            then: "The complete export can be downloaded",
          },
        ],
        suggestedRevision: null,
      }),
    ).toMatchObject({ verdict: "Aligned", score: 92 });
  });

  it("rejects unverifiable or unbounded output", () => {
    expect(() =>
      promptAlignmentEvaluationSchema.parse({
        verdict: "Maybe",
        score: 101,
        summary: "",
        strengths: [],
        gaps: [],
        acceptanceScenarios: [],
        suggestedRevision: null,
      }),
    ).toThrow();
  });
});
