import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProblemPromptReviewScreen, type ProblemPromptReviewScreenProps } from "./problem-prompt-review-screen";
import type { IssueExecutionSummary } from "@/lib/issue-lifecycle";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const props: ProblemPromptReviewScreenProps = {
  problemId: "problem", title: "Additional menu actions", expectedBehavior: "The menu offers additional actions.",
  currentPromptHash: "a".repeat(64), canReview: true, preparationEnabled: true, demo: false,
  approvalId: null, runStatus: null,
  review: { status: "Ready", version: 1, promptHash: "a".repeat(64), userStory: "The menu offers additional actions.",
    feedback: "", result: { verdict: "Passed", summary: "Covered", changes: [] }, failureMessage: null,
    confirmedAt: null, updatedAt: "2026-09-06T00:00:00Z" },
};
const execution: IssueExecutionSummary = {
  current: true, status: "Draft PR opened", summary: "Added the missing menu actions.",
  previewUrl: "https://preview.example.test/menu", pullRequestUrl: "https://github.com/acme/app/pull/1",
  checks: [{ label: "Automated tests", value: "4 passed", state: "passed" }, { label: "Live app test", value: "Not run", state: "pending" }],
  criteria: [], remainingRisks: [], manualChecks: [], codeReview: "Review requested",
  liveAppPassed: false, allChecksPassed: true,
  approval: { id: "merge-1", action: "merge_pull_request", status: "Pending", attempt: null, compatible: true, autoDeploy: false },
};

describe("issue detail", () => {
  it("shows a read-only sample requirement under Observe without enabling a decision", () => {
    const html = renderToStaticMarkup(<ProblemPromptReviewScreen {...props} presentationDemo preparationEnabled={false} canManage />);
    expect(html).toContain("Demo · sample data");
    expect(html).toContain("Confirm expected behavior");
    expect(html).toContain("Read-only sample. No live work is running.");
    expect(html).toMatch(/<button[^>]+disabled=""[^>]*>Confirm<\/button>/);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Diagnostics");
  });
  it("keeps sample execution evidence readable without links to real approvals or previews", () => {
    const html = renderToStaticMarkup(<ProblemPromptReviewScreen {...props} presentationDemo canManage execution={execution} />);
    expect(html).toContain("4 passed");
    expect(html).not.toContain('href="/approvals?approval=merge-1"');
    expect(html).not.toContain("https://preview.example.test");
    expect(html).not.toContain("https://github.com");
  });
  it("shows current progress and the requirement decision without a workflow control bar", () => {
    const html = renderToStaticMarkup(<ProblemPromptReviewScreen {...props} />);
    for (const label of ["Expected behavior", "Confirm", "Needs changes", "not a live application test"]) expect(html).toContain(label);
    for (const label of ["Prompt Testing", "Investigation", "readiness", "Refresh repository", "Generate prompt", "SHA", "Validated", "Ready to merge", "<details", "<ol"]) expect(html).not.toContain(label);
    expect(html).toContain("It does not approve coding, merge, or deployment");
    expect(html).not.toContain("<textarea");
    expect(html).toContain('href="#expected-behavior"');
    expect(html).toContain('id="expected-behavior" tabindex="-1"');
  });
  it("does not offer confirmation while testing, for stale versions, or in demo mode", () => {
    const testing = renderToStaticMarkup(<ProblemPromptReviewScreen {...props} review={{ ...props.review!, status: "Testing" }} />);
    expect(testing).not.toContain('>Confirm</button>');
    const stale = renderToStaticMarkup(<ProblemPromptReviewScreen {...props} currentPromptHash={"b".repeat(64)} />);
    expect(stale).not.toContain('>Confirm</button>');
    const demo = renderToStaticMarkup(<ProblemPromptReviewScreen {...props} demo review={null} />);
    expect(demo).toContain("No live work");
    expect(demo).not.toContain('>Confirm</button>');
  });
  it("keeps the exact confirmed story instead of replacing it with generated boilerplate", () => {
    const html = renderToStaticMarkup(<ProblemPromptReviewScreen {...props}
      review={{ ...props.review!, status: "Confirmed", confirmedAt: "2026-09-11T00:00:00Z" }}
      expectedBehavior="For the reported scenario, users can complete the title and observe the requested result." />);
    expect(html).toContain("The menu offers additional actions.");
    expect(html).toContain("Requirement confirmed");
    expect(html).not.toContain("users can complete the title");
  });
  it("keeps generic generated requirements out of the main view", () => {
    const html = renderToStaticMarkup(<ProblemPromptReviewScreen {...props} review={null}
      expectedBehavior="For the reported scenario, users can complete the title and observe the requested result." />);
    expect(html).toContain("Expected behavior is not yet defined.");
    expect(html).toContain("View draft requirement");
    expect(html).not.toContain("users can complete the title");
  });
  it("does not offer coding approval to contributors", () => {
    const html = renderToStaticMarkup(<ProblemPromptReviewScreen {...props} approvalId="approval-1" canManage={false} />);
    expect(html).not.toContain('href="/approvals?approval=approval-1"');
    expect(html).toContain("A workspace administrator can approve this action.");
  });
  it("preserves execution approval as a separate action", () => {
    const html = renderToStaticMarkup(<ProblemPromptReviewScreen {...props} canManage approvalId="approval-1" />);
    expect(html).toContain('href="/approvals?approval=approval-1"');
    expect(html).not.toContain('>Confirm</button>');
  });
  it("shows blockers instead of indefinite progress when storage or policy is unavailable", () => {
    expect(renderToStaticMarkup(<ProblemPromptReviewScreen {...props} storageReady={false} review={null} />)).toContain("finish workspace setup");
    expect(renderToStaticMarkup(<ProblemPromptReviewScreen {...props} preparationEnabled={false} review={null} />)).toContain("paused by workspace policy");
  });
  it("does not present closed problems as pending work", () => {
    const html = renderToStaticMarkup(<ProblemPromptReviewScreen {...props} closed review={null} />);
    expect(html).toContain("This issue is closed.");
    expect(html).not.toContain("Waiting for agent");
    expect(html).not.toContain('>Confirm</button>');
  });
  it("shows actual run results with a separate original-reports link", () => {
    const html = renderToStaticMarkup(<ProblemPromptReviewScreen {...props} canManage execution={execution} reportCount={1} />);
    for (const text of ["Original reports (1)", "Added the missing menu actions", "4 passed", "Live app test", "Open preview", "Review merge"]) expect(html).toContain(text);
    expect(html).toContain('href="/problems/problem/reports"');
    expect(html).not.toContain("<blockquote");
    expect(html).toContain('href="/approvals?approval=merge-1"');
    expect(html).not.toContain('>Confirm</button>');
    expect(html).not.toContain("Ready to merge");
    expect(html).toContain("A live application test has not passed");
    expect(html).toContain('href="#issue-result"');
  });
  it("does not allow a viewer to decide or expose administrator diagnostics", () => {
    const html = renderToStaticMarkup(<ProblemPromptReviewScreen {...props} canReview={false} />);
    expect(html).not.toContain('>Confirm</button>');
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Diagnostics");
    expect(html).toContain("contributor or administrator");
    expect(renderToStaticMarkup(<ProblemPromptReviewScreen {...props} canManage />)).toContain('href="/admin/problems/problem"');
  });
  it("does not offer approval or a current preview for a previous result", () => {
    const html = renderToStaticMarkup(<ProblemPromptReviewScreen {...props} execution={{ ...execution, current: false }} />);
    expect(html).toContain("Previous result");
    expect(html).toContain("does not validate the current issue");
    expect(html).not.toContain("Open preview");
    expect(html).not.toContain('href="/approvals?approval=merge-1"');
    expect(html).not.toContain('href="#issue-result"');
  });
  it("uses the latest specification when an older requirement review is stale", () => {
    const html = renderToStaticMarkup(<ProblemPromptReviewScreen {...props} expectedBehavior="A new expected outcome."
      currentPromptHash={"b".repeat(64)} />);
    expect(html).toContain("A new expected outcome.");
    expect(html).not.toContain("The menu offers additional actions.");
  });
  it("keeps successful behavior checks summarized and shows only unresolved statements", () => {
    const html = renderToStaticMarkup(<ProblemPromptReviewScreen {...props} execution={{ ...execution,
      criteria: [{ id: "AC-1", statement: "A completed behavior check.", status: "Passed" }, { id: "AC-2", statement: "A behavior still needing attention.", status: "Pending manual" }],
    }} />);
    expect(html).not.toContain("A completed behavior check.");
    expect(html).toContain("A behavior still needing attention.");
  });
  it("requires an administrator for the final action link", () => {
    const html = renderToStaticMarkup(<ProblemPromptReviewScreen {...props} canReview execution={execution} />);
    expect(html).not.toContain('href="/approvals?approval=merge-1"');
    expect(html).toContain("A workspace administrator can approve");
    expect(html).toContain("View proposed changes");
  });
  it("links long excerpts to the full context without shortening risk or manual-check text", () => {
    const risk = "Keep the original behavior for archived records. ".repeat(12);
    const html = renderToStaticMarkup(<ProblemPromptReviewScreen {...props} review={null}
      expectedBehavior={`The menu offers archive. ${"Additional expected behavior. ".repeat(20)}`}
      execution={{ ...execution, summary: `Added archive. ${"Implementation details. ".repeat(20)}`, remainingRisks: [risk], manualChecks: [risk] }} />);
    expect(html).toContain("Full expected behavior");
    expect(html).toContain("Full result summary");
    expect(html).toContain(risk);
  });
});
