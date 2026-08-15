import { describe, expect, it } from "vitest";
import { promptConversationResultSchema } from "./prompt-conversation";

describe("prompt conversation contract", () => {
  it("accepts a direct answer with a complete optional improvement", () => {
    expect(promptConversationResultSchema.parse({
      answer: "The Undo control appears only after a caption is regenerated. I improved the prompt to make that timing explicit.",
      improvement: {
        summary: "Clarified that Undo is contextual and appears only after regeneration.",
        revisedPrompt: "Preserve the current prompt. Show Undo only after regeneration succeeds.",
      },
    })).toMatchObject({
      improvement: {
        summary: "Clarified that Undo is contextual and appears only after regeneration.",
      },
    });
  });

  it("accepts an answer that does not change the prompt", () => {
    expect(promptConversationResultSchema.parse({
      answer: "The current prompt already specifies that behavior.",
      improvement: null,
    }).improvement).toBeNull();
  });

  it("rejects an empty or partial improvement", () => {
    expect(() => promptConversationResultSchema.parse({
      answer: "",
      improvement: { summary: "Clarify it", revisedPrompt: "" },
    })).toThrow();
  });
});
