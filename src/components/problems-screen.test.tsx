import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { calculateOverviewAnalytics, createEmptyOverviewAnalytics } from "@/lib/overview-analytics";
import { ProblemLifecycleBoard, ProblemsScreen } from "./screens";
import { IssueList, IssueViewControls } from "./issue-list";
import { EMPTY_ISSUE_FILTERS, filterIssues } from "@/lib/issue-views";

describe("ProblemsScreen", () => {
  it("gives an empty issue list a clear next action", () => {
    const markup = renderToStaticMarkup(<ProblemsScreen analytics={createEmptyOverviewAnalytics()} />);
    expect(markup).toContain("<h1>Issues</h1>");
    expect(markup).toContain("No issues yet");
    expect(markup).toContain('href="/feedback"');
    expect(markup).toContain("Open feedback inbox");
    expect(markup).not.toContain("placeholder clusters");
  });
  it("combines classification into a list with only two layout choices", () => {
    const markup = renderToStaticMarkup(
      <ProblemsScreen
        analytics={calculateOverviewAnalytics(
          new Date("2026-07-21T18:00:00.000Z"),
        )}
      />,
    );

    expect(markup).toContain('aria-label="Issue view"');
    expect(markup).toContain('id="problem-view-tab-problems"');
    expect(markup).not.toContain('id="problem-view-tab-classification"');
    expect(markup).toContain('id="problem-view-tab-board"');
    expect(markup).toContain(">List<");
    expect(markup).not.toContain(">Classification<");
    expect(markup).toContain(">Board<");
    expect(markup).toContain("All issues");
    expect(markup).not.toContain('aria-label="Prioritization view"');
    expect(markup).toContain('aria-label="Search issues"');
    expect(markup).toContain('aria-label="Group issues by"');
    expect(markup).toContain('class="issue-taxonomy"');
    expect(markup).toContain('scope="col">Stage');
    expect(markup).toContain('scope="col">Severity');
    expect(markup).toContain('scope="col">Reports');
    expect(markup).not.toContain('scope="col">Confidence');
    expect(markup).not.toContain('scope="col">Revenue');
    expect(markup).not.toContain('scope="col">Trend');
  });

  it("renders the same filtered issues in both layouts without secondary metrics", () => {
    const allIssues = calculateOverviewAnalytics(new Date("2026-07-21T18:00:00.000Z")).problems;
    const issues = filterIssues(allIssues, { ...EMPTY_ISSUE_FILTERS, query: allIssues[0].title });
    const list = renderToStaticMarkup(<IssueList issues={issues} grouping="none" />);
    const board = renderToStaticMarkup(<ProblemLifecycleBoard problems={issues} />);
    for (const markup of [list, board]) {
      expect(markup.match(/href="\/problems\//g)).toHaveLength(issues.length);
      for (const issue of issues) expect(markup).toContain(`href="/problems/${issue.id}"`);
      expect(markup).not.toContain("evidence confidence");
      expect(markup).not.toContain(" ARR");
    }
  });

  it("groups by product area in both views without enabling classification via drag", () => {
    const issues = calculateOverviewAnalytics(new Date("2026-07-21T18:00:00.000Z")).problems;
    const list = renderToStaticMarkup(<IssueList issues={issues} grouping="productArea" />);
    const board = renderToStaticMarkup(<ProblemLifecycleBoard problems={issues} grouping="productArea" />);
    expect(list).toContain('scope="rowgroup"');
    expect(board).toContain('aria-label="Issues by product area"');
    expect(board).toContain('draggable="false"');
    expect(board).not.toContain('draggable="true"');
    expect(board).not.toContain("problem-card-drag-indicator");
    expect(board).toContain("Move stage");
    expect(board).toContain("issue-card-stage");
    for (const markup of [list, board]) {
      for (const issue of issues) expect(markup).toContain(issue.productArea);
    }
  });

  it("keeps controlled search and filter state in either layout", () => {
    const issues = calculateOverviewAnalytics(new Date("2026-07-21T18:00:00.000Z")).problems;
    for (const isBoard of [false, true]) {
      const markup = renderToStaticMarkup(<IssueViewControls
        issues={issues}
        filters={{ ...EMPTY_ISSUE_FILTERS, query: "CSV", severity: "High" }}
        onFiltersChange={() => {}}
        grouping="productArea"
        onGroupingChange={() => {}}
        isBoard={isBoard}
        count={1}
      />);
      expect(markup).toContain('value="CSV"');
      expect(markup).toContain('class="issue-filter-count">1');
      expect(markup).toContain("Group: Product area");
      expect(markup).toContain('role="status">1 issue');
    }
  });

  it("leads board cards with the issue and labels each colored stage", () => {
    const issues = calculateOverviewAnalytics(new Date("2026-07-21T18:00:00.000Z")).problems;
    const board = renderToStaticMarkup(<ProblemLifecycleBoard problems={issues} />);
    expect(board).toContain('data-stage="Detected"');
    expect(board).toContain('class="board-stage-dot" aria-hidden="true"');
    expect(board).toContain('class="board-stage-count"');
    expect(board).toContain('class="issue-card-area"');
    expect(board).toContain('class="issue-card-reports"');
    expect(board.indexOf('class="problem-card-title"')).toBeLessThan(board.indexOf('class="ticket-badges"'));
    expect(board).toContain("Move stage");
  });

  it("shows one-word active work with a spinner on the matching board card", () => {
    const analytics = calculateOverviewAnalytics(
      new Date("2026-07-21T18:00:00.000Z"),
    );
    const problem = analytics.problems[0];
    const markup = renderToStaticMarkup(
      <ProblemLifecycleBoard
        problems={analytics.problems}
        activeWork={[
          {
            problemId: problem.id,
            status: "Tenki",
            startedAt: "2026-08-11T12:00:00.000Z",
          },
        ]}
      />,
    );

    expect(markup).toContain('aria-label="Tenki in progress"');
    expect(markup).toContain("problem-card-work-spinner");
    expect(markup.match(/problem-card-work-status/g)).toHaveLength(1);
    expect(markup).toContain('class="problem-card-title"');
    expect(markup).toContain(`title="${problem.title}"`);
    expect(markup).toContain("Release Ready");
  });
});
