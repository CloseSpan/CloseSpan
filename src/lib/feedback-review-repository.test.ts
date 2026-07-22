import { describe, expect, it } from "vitest";
import { feedbackProblemTitle } from "./feedback-review-repository";

describe("feedback review problem titles", () => {
  it("uses only the first compact sentence", () => {
    expect(feedbackProblemTitle("  Export fails on Safari.  More context follows. "))
      .toBe("Export fails on Safari");
  });

  it("bounds generated titles while preserving a visible ellipsis", () => {
    const title = feedbackProblemTitle("x".repeat(140));
    expect(title).toHaveLength(98);
    expect(title.endsWith("…")).toBe(true);
  });

  it("provides a safe fallback for an empty summary", () => {
    expect(feedbackProblemTitle("   ")).toBe("Feedback needs product review");
  });
});
