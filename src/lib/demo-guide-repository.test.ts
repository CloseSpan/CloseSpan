import { describe, expect, it } from "vitest";
import { parseDemoGuideSteps } from "./demo-guide-repository";

describe("guided demo parsing", () => {
  it("accepts internal presentation steps and drops malformed records", () => {
    expect(parseDemoGuideSteps([
      {
        id: "overview",
        title: "Start with the operating picture",
        description: "Show the cost of fragmented feedback.",
        path: "/overview",
        actionLabel: "Open overview",
        talkingPoints: ["Eight weeks of signals", "Revenue context"],
      },
      { id: "unsafe", title: "Unsafe", description: "No", path: "https://example.com", actionLabel: "Leave" },
      null,
    ])).toEqual([
      {
        id: "overview",
        title: "Start with the operating picture",
        description: "Show the cost of fragmented feedback.",
        path: "/overview",
        actionLabel: "Open overview",
        talkingPoints: ["Eight weeks of signals", "Revenue context"],
      },
    ]);
  });

  it("rejects protocol-relative paths and ignores invalid talking points", () => {
    expect(parseDemoGuideSteps([
      { id: "unsafe", title: "Unsafe", description: "No", path: "//example.com", actionLabel: "Leave" },
      {
        id: "feedback",
        title: "Triage feedback",
        description: "Review customer evidence.",
        path: "/feedback",
        actionLabel: "Open feedback",
        talkingPoints: ["PII redaction", 42, "Human review"],
      },
    ])).toEqual([
      expect.objectContaining({
        id: "feedback",
        talkingPoints: ["PII redaction", "Human review"],
      }),
    ]);
  });
});
