import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DemoState } from "@/lib/store";
import { approval, feedback, primaryProblem } from "@/lib/seed";
import { IssueFollowUp } from "./screens";

function state(problemStage: DemoState["problemStage"], notifications: DemoState["notifications"] = "Drafted"): DemoState {
  return {
    orgId: primaryProblem.orgId,
    version: 1,
    approval: structuredClone(approval),
    problemStage,
    notifications,
    audit: [],
    processedActions: {},
  };
}

function render(workflow: DemoState, problem: { id: string; title: string } = primaryProblem) {
  return renderToStaticMarkup(
    <IssueFollowUp initialState={workflow} problem={problem} orgId={primaryProblem.orgId} feedbackItems={feedback} />,
  );
}

describe("IssueFollowUp", () => {
  it("shows agent-merge drafts immediately but locks approval until verification", () => {
    const markup = render(state("Release Ready"));

    expect(markup).toContain("Customer follow-up");
    expect(markup).toContain("3 drafts");
    expect(markup).toContain("Agent PR merged · awaiting release verification");
    expect(markup).toContain("Awaiting release verification");
    expect(markup).toContain("disabled");
    expect(markup).not.toContain("The verified fix is now available");
  });

  it("unlocks prepared drafts after release verification", () => {
    const markup = render(state("Verified"));

    expect(markup).toContain("Verified resolution");
    expect(markup).toContain("Approve all drafts");
    expect(markup).toContain("The verified fix is now available");
  });

  it("waits for the merge before showing any drafts", () => {
    const markup = render(state("In progress", "Not drafted"));

    expect(markup).toContain("Waiting for agent merge");
    expect(markup).not.toContain("Approve all drafts");
  });

  it("drafts only for customers who reported this issue", () => {
    const markup = render(state("Verified"), { id: "prob_other", title: "Another issue" });

    expect(markup).toContain("No recipients found");
    expect(markup).not.toContain("Northstar Labs");
  });
});
