import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { problemActiveWorkStatuses } from "@/lib/problem-active-work";
import { filterIssues, getIssueQueueCounts, IssueCollection, IssuesScreen, type IssueListItem } from "./issues-screen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const issues: IssueListItem[] = [
  { id: "issue-1", title: "Export omits selected date range", severity: "High", stage: "Needs review", reviewState: "needed", reportCount: 2 },
  { id: "issue-2", title: "Saved views lose advanced filters", severity: "Medium", stage: "Detected" },
  { id: "issue-3", title: "Invoice page fails to load", severity: "Critical", stage: "In progress", activeWork: { problemId: "issue-3", status: "CI", startedAt: "2026-09-12T12:00:00Z" } },
];

describe("IssuesScreen", () => {
  it("labels presentation data without changing issue navigation", () => {
    const html = renderToStaticMarkup(<IssuesScreen issues={issues} presentationDemo />);
    expect(html).toContain("Demo · sample data");
    expect(html).toContain('href="/problems/issue-1"');
  });
  it("puts subjects, recorded statuses and compact metadata in the default list", () => {
    const markup = renderToStaticMarkup(<IssuesScreen issues={issues} />);
    expect(markup).toContain("<h1>Issues</h1>");
    expect(markup).toContain('aria-label="Search issues"');
    expect(markup).toMatch(/<label[^>]+data-field-shell="true"/);
    expect(markup).toContain('class="neumorphic-composite-field"');
    expect(markup).toContain('aria-label="Issue view"');
    expect(markup).toContain("Needs your review");
    expect(markup).toContain("Checking the fix");
    expect(markup).toContain("2 reports");
    expect(markup).toContain("High severity");
    expect(markup).not.toContain("<span>Severity</span>");
    expect(markup).toContain("Review issue");
    expect(markup).toContain("View progress");
    for (const issue of issues) expect(markup).toContain(`href="/problems/${issue.id}"`);
    for (const hiddenTerm of ["Confidence", "ARR", "Readiness", "Classification", "clustering", "Report issue"]) {
      expect(markup).not.toContain(hiddenTerm);
    }
  });

  it("starts with All selected and shows the total count for every queue", () => {
    const markup = renderToStaticMarkup(<IssuesScreen issues={issues} />);
    expect(markup).toContain('aria-label="Filter issues"');
    expect(markup).toContain('aria-pressed="true" aria-label="All, 3 issues"');
    expect(markup).toContain('aria-pressed="false" aria-label="Needs attention, 1 issue"');
    expect(markup).toContain('aria-pressed="false" aria-label="In progress, 1 issue"');
    expect(markup).toContain('aria-pressed="false" aria-label="Closed, 0 issues"');
    expect(markup).toContain("Needs attention first");
    expect(markup.indexOf(issues[0].title)).toBeLessThan(markup.indexOf(issues[2].title));
    expect(markup.indexOf(issues[2].title)).toBeLessThan(markup.indexOf(issues[1].title));
  });

  it("finds issues by subject, displayed stage and severity", () => {
    expect(filterIssues(issues, " saved FILTERS ").map(({ id }) => id)).toEqual(["issue-2"]);
    expect(filterIssues(issues, "checking critical").map(({ id }) => id)).toEqual(["issue-3"]);
    expect(filterIssues(issues, "needs your review").map(({ id }) => id)).toEqual(["issue-1"]);
    expect(filterIssues(issues, "no matching phrase")).toEqual([]);
    expect(filterIssues(issues, " ").map(({ id }) => id)).toEqual(["issue-1", "issue-3", "issue-2"]);
  });

  it("uses result navigation for release records and neutral navigation for Closed", () => {
    const recordedIssues = ["Released", "Verified", "Closed"].map((stage) => ({
      id: stage, title: `${stage} issue`, severity: "Low", stage,
    }));
    const markup = renderToStaticMarkup(<IssueCollection issues={recordedIssues} view="list" />);
    expect(markup.match(/View result/g)).toHaveLength(2);
    expect(markup).toContain("View issue");
    expect(markup).not.toContain("View progress");
    expect(markup).toContain("Release recorded");
    expect(markup).toContain("Verification recorded");
  });

  it("groups board issues by recorded stage and keeps each issue reachable", () => {
    const markup = renderToStaticMarkup(<IssueCollection issues={issues} view="board" />);
    expect(markup).toContain('aria-label="Issues by stage"');
    expect(markup).toContain("Needs review");
    expect(markup).toContain("Checking the fix");
    expect(markup).not.toContain("Release review");
    for (const issue of issues) expect(markup.match(new RegExp(`href="/problems/${issue.id}"`, "g"))).toHaveLength(1);
  });

  it("shows an honest empty state with the existing feedback entry point", () => {
    const markup = renderToStaticMarkup(<IssuesScreen issues={[]} />);
    expect(markup).toContain("No issues yet");
    expect(markup).toContain('href="/feedback"');
    expect(markup).not.toContain('aria-label="Search issues"');
    expect(markup).not.toContain("Report issue");
  });
});

describe("issue queues", () => {
  const issue = (id: string, overrides: Partial<IssueListItem>): IssueListItem => ({
    id, title: id, stage: "Detected", severity: "Medium", ...overrides,
  });

  it("sorts attention before review, then ongoing work, other issues, and Closed without changing source order", () => {
    const unsorted = [
      issue("closed", { stage: "Closed" }),
      issue("reported", {}),
      issue("review", { reviewState: "needed" }),
      issue("working", { stage: "In progress" }),
      issue("attention", { reviewState: "attention" }),
      issue("released", { stage: "Released" }),
      issue("another-review", { reviewState: "needed" }),
    ];
    const originalOrder = unsorted.map(({ id }) => id);
    expect(filterIssues(unsorted, "").map(({ id }) => id)).toEqual([
      "attention", "review", "another-review", "working", "reported", "released", "closed",
    ]);
    expect(unsorted.map(({ id }) => id)).toEqual(originalOrder);
  });

  it("requires a recorded review need rather than legacy intake wording", () => {
    const candidates = [
      issue("legacy-intake", { stage: "Needs review" }),
      issue("decision", { stage: "Needs review", reviewState: "needed" }),
      issue("attention", { reviewState: "attention" }),
      issue("release-review", { stage: "Release Ready" }),
    ];
    expect(filterIssues(candidates, "", "attention").map(({ id }) => id)).toEqual([
      "attention", "decision", "release-review",
    ]);
    expect(filterIssues(candidates, "decision", "attention").map(({ id }) => id)).toEqual(["decision"]);
    expect(filterIssues(candidates, "legacy", "attention")).toEqual([]);
    const legacyMarkup = renderToStaticMarkup(<IssueCollection issues={[candidates[0]]} view="list" />);
    expect(legacyMarkup).toContain("Reported");
    expect(legacyMarkup).toContain("View issue");
    expect(legacyMarkup).not.toContain("Review issue");
  });

  it.each(problemActiveWorkStatuses)("keeps %s in progress unless a review or Closed takes precedence", (status) => {
    const activeWork = { problemId: "active", status, startedAt: "2026-09-12T12:00:00Z" };
    const active = issue("active", { activeWork });
    const review = issue("review", { activeWork, reviewState: "needed" });
    const attention = issue("attention", { activeWork, reviewState: "attention" });
    const closed = issue("closed", { activeWork, reviewState: "attention", stage: "Closed" });
    const candidates = [active, review, attention, closed];
    expect(filterIssues(candidates, "", "in-progress")).toEqual([active]);
    expect(filterIssues(candidates, "", "attention")).toEqual([attention, review]);
    expect(filterIssues(candidates, "", "closed")).toEqual([closed]);
    expect(getIssueQueueCounts(candidates)).toEqual({ all: 4, attention: 2, "in-progress": 1, closed: 1 });
    const closedMarkup = renderToStaticMarkup(<IssueCollection issues={[closed]} view="list" />);
    expect(closedMarkup).toContain("View issue");
    expect(closedMarkup).not.toContain("Review issue");
  });

  it("keeps Released and Verified out of Closed and active work, while retaining bare In progress", () => {
    const candidates = [
      issue("released", { stage: "Released" }),
      issue("verified", { stage: "Verified" }),
      issue("working", { stage: "In progress" }),
      issue("closed", { stage: "Closed" }),
    ];
    expect(filterIssues(candidates, "", "in-progress").map(({ id }) => id)).toEqual(["working"]);
    expect(filterIssues(candidates, "", "closed").map(({ id }) => id)).toEqual(["closed"]);
    expect(getIssueQueueCounts(candidates)).toEqual({ all: 4, attention: 0, "in-progress": 1, closed: 1 });
    expect(filterIssues(candidates, "")).toHaveLength(4);
  });
});
