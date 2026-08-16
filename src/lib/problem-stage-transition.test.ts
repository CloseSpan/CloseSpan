import { describe, expect, it } from "vitest";
import {
  isProductProblemStage,
  problemStageTransitionPreview,
  PRODUCT_PROBLEM_STAGES,
} from "./problem-stage-transition";

describe("manual problem stage transition policy", () => {
  it("recognizes every lifecycle destination and rejects arbitrary values", () => {
    expect(PRODUCT_PROBLEM_STAGES.every(isProductProblemStage)).toBe(true);
    expect(isProductProblemStage("Merged somewhere")).toBe(false);
  });

  it("does not imply that Release Ready performs a merge", () => {
    const preview = problemStageTransitionPreview("Release Ready");
    expect(preview.caution).toContain("does not merge");
  });

  it("limits a manual verification to drafts and an audited status decision", () => {
    const preview = problemStageTransitionPreview("Verified");
    expect(preview.effects).toContain(
      "Prepare customer follow-up drafts where linked customers exist",
    );
    expect(preview.caution).toContain("does not send messages");
  });
});
