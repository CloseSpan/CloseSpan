import { describe, expect, it } from "vitest";
import { summarizeSlackThread } from "./slack-intake";

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
