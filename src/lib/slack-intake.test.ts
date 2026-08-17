import { describe, expect, it } from "vitest";
import {
  batchProblemSimilarity,
  classifySlackConversation,
  slackConversationControl,
  summarizeSlackThread,
} from "./slack-intake";

describe("Slack intake normalization", () => {
  it("turns a thread, reactions, and attachment metadata into one redacted signal", () => {
    const signal = summarizeSlackThread([
      {
        type: "message",
        ts: "100.000001",
        user: "U123",
        text: "Export is empty for customer@example.com token=top-secret",
        reactions: [{ name: "eyes", count: 3 }],
      },
      {
        type: "message",
        subtype: "file_share",
        ts: "101.000001",
        thread_ts: "100.000001",
        user: "U456",
        text: "Screenshot from the failed export",
        reactions: [{ name: "eyes", count: 1 }],
        files: [
          {
            id: "F123",
            name: "failure.png",
            mimetype: "image/png",
            size: 2400,
          },
        ],
      },
    ]);

    expect(signal).toEqual({
      text:
        "Export is empty for [REDACTED_EMAIL] token=[REDACTED_SECRET]\n\nScreenshot from the failed export\n\nAttachments: failure.png (image/png)",
      authorId: "U123",
      reactions: [{ name: "eyes", count: 4 }],
      files: [
        {
          id: "F123",
          name: "failure.png",
          mimeType: "image/png",
          size: 2400,
        },
      ],
    });
  });

  it("ignores CloseSpan and other bot-authored messages", () => {
    expect(
      summarizeSlackThread([
        {
          type: "message",
          ts: "100.000001",
          bot_id: "B123",
          text: "Approval required",
        },
      ]),
    ).toBeNull();
  });

  it("accepts attachment-only customer messages without fetching file contents", () => {
    expect(
      summarizeSlackThread([
        {
          type: "message",
          subtype: "file_share",
          ts: "100.000001",
          user: "U123",
          files: [{ id: "F1", title: "trace.txt", mimetype: "text/plain" }],
        },
      ])?.text,
    ).toBe("Attachments: trace.txt (text/plain)");
  });
});

describe("Slack intake batch clustering", () => {
  it("treats formatting-only changes as the same problem", () => {
    expect(batchProblemSimilarity(
      "Undo caption regeneration: save the existing caption, then restore it on Undo.",
      "undo caption regeneration — save the existing caption then restore it on undo",
    )).toBe(1);
  });

  it("keeps unrelated feature requests separate", () => {
    expect(batchProblemSimilarity(
      "Undo caption regeneration after replacing an existing caption.",
      "Add bulk export filters for enterprise account reports.",
    )).toBeLessThan(0.9);
  });
});

describe("Slack conversation intent gate", () => {
  it("ignores greetings and accidental casual messages", () => {
    expect(classifySlackConversation({ text: "hi" })).toMatchObject({
      state: "Ignored",
      classification: "Noise",
    });
    expect(classifySlackConversation({ text: "checking" })).toMatchObject({
      state: "Ignored",
      classification: "Noise",
    });
  });

  it("automatically confirms detailed actionable product feedback", () => {
    expect(classifySlackConversation({
      text: "Please add an undo button after the caption is regenerated so users can restore the previous caption.",
    })).toMatchObject({
      state: "Confirmed",
      classification: "Feature request",
    });
  });

  it("holds ambiguous product conversation for confirmation", () => {
    expect(classifySlackConversation({
      text: "Does the export page support saved filters?",
    })).toMatchObject({
      state: "Review",
      classification: "Question",
    });
  });

  it("recognizes explicit confirmation and dismissal controls", () => {
    expect(slackConversationControl([
      { text: "Could the dashboard show the account owner?" },
      { text: "record feedback" },
    ])).toBe("confirm");
    expect(slackConversationControl([
      { text: "The export is confusing" },
      { text: "ignore" },
    ])).toBe("ignore");
  });

  it("does not include confirmation commands in the stored feedback quote", () => {
    expect(summarizeSlackThread([
      { type: "message", ts: "100.1", user: "U1", text: "Could the dashboard show the account owner?" },
      { type: "message", ts: "101.1", user: "U1", text: "record feedback" },
    ])?.text).toBe("Could the dashboard show the account owner?");
  });
});
