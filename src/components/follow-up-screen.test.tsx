import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DemoState } from "@/lib/store";
import { approval, feedback, primaryProblem } from "@/lib/seed";
import { FollowUpScreen } from "./screens";

function state(problemStage: DemoState["problemStage"]): DemoState {
  return {
    orgId: primaryProblem.orgId,
    version: 1,
    approval: structuredClone(approval),
    problemStage,
    notifications: "Drafted",
    audit: [],
    processedActions: {},
  };
}

describe("FollowUpScreen", () => {
  it("shows agent-merge drafts immediately but locks approval until verification", () => {
    const markup = renderToStaticMarkup(
      <FollowUpScreen
        initialState={state("Release Ready")}
        problem={primaryProblem}
        feedbackItems={feedback}
      />,
    );

    expect(markup).toContain("Follow-up prepared");
    expect(markup).toContain("Agent PR merged · awaiting release verification");
    expect(markup).toContain("Awaiting release verification");
    expect(markup).toContain("disabled");
    expect(markup).not.toContain("The verified fix is now available");
  });

  it("unlocks prepared drafts after release verification", () => {
    const markup = renderToStaticMarkup(
      <FollowUpScreen
        initialState={state("Verified")}
        problem={primaryProblem}
        feedbackItems={feedback}
      />,
    );

    expect(markup).toContain("Verified resolution");
    expect(markup).toContain("Approve all drafts");
    expect(markup).toContain("The verified fix is now available");
  });
});
