import { describe, expect, it } from "vitest";
import { investigationStatusCopy } from "./investigation-status-copy";

const pending = {
  verificationStatus: "Unverified" as const,
  verificationSummary: null,
  runtimeOutcome: null,
  runtimeSummary: null,
  hypothesis: "The reported behavior may be caused by the current implementation.",
};

describe("investigationStatusCopy", () => {
  it.each([
    ["Bug", "Issue not yet reproduced"],
    ["Incident", "Incident not yet reproduced"],
    ["Feature request", "Feature scope not yet confirmed"],
    ["Usability", "Usability impact not yet confirmed"],
    ["Question", "Enquiry needs a response"],
    ["Future feedback type", "Request needs classification"],
  ])("uses type-aware pending copy for %s", (feedbackType, title) => {
    expect(investigationStatusCopy({ ...pending, feedbackType }).title).toBe(title);
  });

  it("uses stored external verification when no runtime report exists", () => {
    expect(investigationStatusCopy({
      ...pending,
      feedbackType: "Feature request",
      verificationStatus: "Confirmed current",
      verificationSummary: "The desired outcome and acceptance boundary were confirmed.",
    })).toEqual({
      title: "Feature need confirmed",
      detail: "The desired outcome and acceptance boundary were confirmed.",
      tone: "success",
      icon: "confirmed",
      showWorkingHypothesis: false,
    });
  });

  it("keeps confirmed issue behavior distinct from an unconfirmed root cause", () => {
    expect(investigationStatusCopy({
      ...pending,
      feedbackType: "Bug",
      runtimeOutcome: "Confirmed current",
      runtimeSummary: "The reported path reproduced the failure.",
    })).toMatchObject({
      title: "Behavior confirmed · root cause unconfirmed",
      detail: "The reported path reproduced the failure.",
      showWorkingHypothesis: true,
    });
  });
});
