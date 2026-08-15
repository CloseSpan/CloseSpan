import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertPromptConversationRevisionReceipt,
  createPromptConversationRevisionReceipt,
} from "./prompt-conversation-revision-receipt";

const expected = {
  orgId: "org_1",
  problemId: "problem_1",
  promptHash: "a".repeat(64),
  revisionHash: "b".repeat(64),
  messageHash: "c".repeat(64),
};

describe("prompt conversation revision receipt", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("binds an improvement to its prompt and conversation message", () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-that-is-at-least-32-characters-long");
    const token = createPromptConversationRevisionReceipt({
      ...expected,
      now: 1_800_000_000_000,
    });
    expect(() => assertPromptConversationRevisionReceipt(token, {
      ...expected,
      now: 1_800_000_000_100,
    })).not.toThrow();
    expect(() => assertPromptConversationRevisionReceipt(token, {
      ...expected,
      messageHash: "d".repeat(64),
      now: 1_800_000_000_100,
    })).toThrow("no longer matches");
  });

  it("expires rather than applying a stale suggestion", () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-that-is-at-least-32-characters-long");
    const token = createPromptConversationRevisionReceipt({
      ...expected,
      now: 1_800_000_000_000,
    });
    expect(() => assertPromptConversationRevisionReceipt(token, {
      ...expected,
      now: 1_800_001_800_001,
    })).toThrow("expired");
  });
});
