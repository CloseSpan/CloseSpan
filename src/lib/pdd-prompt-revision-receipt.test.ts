import { beforeEach, describe, expect, it } from "vitest";
import {
  assertPddPromptRevisionReceipt,
  createPddPromptRevisionReceipt,
} from "./pdd-prompt-revision-receipt";

describe("PDD prompt revision receipts", () => {
  beforeEach(() => {
    process.env.PROMPT_ALIGNMENT_SECRET = "test-secret-that-is-longer-than-thirty-two-characters";
  });

  it("binds a revision to the tenant, problem, prompt, and story", () => {
    const expected = {
      orgId: "org_alpha",
      problemId: "prob_export",
      promptHash: "a".repeat(64),
      revisionHash: "b".repeat(64),
      storyHash: "c".repeat(64),
    };
    const receipt = createPddPromptRevisionReceipt(expected);
    expect(() => assertPddPromptRevisionReceipt(receipt, expected)).not.toThrow();
    expect(() => assertPddPromptRevisionReceipt(receipt, {
      ...expected,
      revisionHash: "d".repeat(64),
    })).toThrow("does not match");
  });
});
