import { describe, expect, it } from "vitest";
import {
  demoWorkspaceGuide,
  parseDemoGuideSteps,
} from "./demo-guide-repository";
import { resolveDemoGuideStepIndex } from "./demo-guide-navigation";

describe("guided demo parsing", () => {
  it("ships an internal presentation route for every demo step", () => {
    expect(demoWorkspaceGuide.steps.length).toBeGreaterThanOrEqual(6);
    expect(
      demoWorkspaceGuide.steps.every(
        (step) => step.path.startsWith("/") && !step.path.startsWith("//"),
      ),
    ).toBe(true);
  });

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

  it("preserves a later walkthrough step when the guide revisits a route", () => {
    const repeatedRouteSteps = [
      ...demoWorkspaceGuide.steps,
      {
        ...demoWorkspaceGuide.steps[4]!,
        id: "lifecycle",
        title: "Return to the problem lifecycle",
      },
    ];
    const laterIndex = repeatedRouteSteps.length - 1;

    expect(resolveDemoGuideStepIndex(
      repeatedRouteSteps,
      repeatedRouteSteps[laterIndex]!.path,
      laterIndex,
    )).toBe(laterIndex);
  });

  it("uses the current route when the saved walkthrough step is stale", () => {
    expect(resolveDemoGuideStepIndex(
      demoWorkspaceGuide.steps,
      "/settings",
      2,
    )).toBe(demoWorkspaceGuide.steps.length - 1);
  });
});
