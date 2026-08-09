import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertPromptAlignmentReceipt,
  createPromptAlignmentReceipt,
} from "./prompt-alignment-receipt";

const expected = {
  orgId: "org_test",
  problemId: "prob_test",
  promptHash: "a".repeat(64),
  storyHash: "b".repeat(64),
};

describe("prompt alignment receipt", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("binds an aligned result to one prompt and story", () => {
    vi.stubEnv("PROMPT_ALIGNMENT_SECRET", "s".repeat(32));
    const token = createPromptAlignmentReceipt({ ...expected, now: 1_000 });
    expect(() =>
      assertPromptAlignmentReceipt(token, { ...expected, now: 2_000 }),
    ).not.toThrow();
    expect(() =>
      assertPromptAlignmentReceipt(token, {
        ...expected,
        promptHash: "c".repeat(64),
        now: 2_000,
      }),
    ).toThrow("does not match");
  });

  it("rejects tampering and expiry", () => {
    vi.stubEnv("PROMPT_ALIGNMENT_SECRET", "s".repeat(32));
    const token = createPromptAlignmentReceipt({ ...expected, now: 1_000 });
    expect(() =>
      assertPromptAlignmentReceipt(`${token}x`, { ...expected, now: 2_000 }),
    ).toThrow("valid prompt-alignment receipt");
    expect(() =>
      assertPromptAlignmentReceipt(token, {
        ...expected,
        now: 31 * 60_000,
      }),
    ).toThrow("expired");
  });
});
