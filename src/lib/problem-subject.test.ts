import { describe, expect, it } from "vitest";
import { feedbackProblemTitle, normalizeProblemSubject, PROBLEM_SUBJECT_INSTRUCTIONS } from "./problem-subject";

describe("problem subjects", () => {
  it("uses semantic subjects instead of clipping customer narratives", () => {
    const summary = "Customer requests additional actions in the three-dot menu because it currently duplicates the existing actions.";
    expect(feedbackProblemTitle(summary, "Missing three-dot menu actions")).toBe("Missing three-dot menu actions");
    expect(summary).toContain("because");
  });
  it("normalizes whitespace but rejects prose and truncated subjects", () => {
    expect(normalizeProblemSubject("  CSV export   produces empty files.  ")).toBe("CSV export produces empty files");
    expect(normalizeProblemSubject("Customer requests many new things which may help users do more work")).toBeNull();
    expect(normalizeProblemSubject("Customer requests additional actions…")).toBeNull();
    expect(normalizeProblemSubject(42)).toBeNull();
  });
  it("requires evidence-based clustering independent of subject text", () => {
    expect(PROBLEM_SUBJECT_INSTRUCTIONS).toContain("A shared subject is not evidence");
    expect(PROBLEM_SUBJECT_INSTRUCTIONS).toContain("Never invent a root cause");
  });
});
