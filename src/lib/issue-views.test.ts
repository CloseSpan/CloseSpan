import { describe, expect, it } from "vitest";
import { calculateOverviewAnalytics } from "./overview-analytics";
import { PRODUCT_PROBLEM_STAGES } from "./problem-stage-transition";
import { activeIssueFilterCount, EMPTY_ISSUE_FILTERS, filterIssues, groupIssues, issueProductArea, type Issue } from "./issue-views";

const base = calculateOverviewAnalytics(new Date("2026-07-21T18:00:00.000Z")).problems[0];
const issues: Issue[] = [
  { ...base, id: "csv", title: "CSV exports are empty", productArea: "Exports", type: "Bug", stage: "Needs review", severity: "High" },
  { ...base, id: "usage", title: "Usage limits", productArea: "Billing", type: "Feature request", stage: "In progress", severity: "Medium" },
  { ...base, id: "pdf", title: "PDF download fails", productArea: "Exports", type: "Bug", stage: "Detected", severity: "Medium" },
];

describe("shared issue view data", () => {
  it("preserves the full inventory and original order without filters", () => {
    expect(filterIssues(issues, EMPTY_ISSUE_FILTERS)).toEqual(issues);
  });
  it("searches titles, product areas and types without case or whitespace surprises", () => {
    expect(filterIssues(issues, { ...EMPTY_ISSUE_FILTERS, query: "  cSv  " }).map((i) => i.id)).toEqual(["csv"]);
    expect(filterIssues(issues, { ...EMPTY_ISSUE_FILTERS, query: "exports" }).map((i) => i.id)).toEqual(["csv", "pdf"]);
    expect(filterIssues(issues, { ...EMPTY_ISSUE_FILTERS, query: "FEATURE" }).map((i) => i.id)).toEqual(["usage"]);
  });
  it("combines classification and lifecycle filters with AND semantics", () => {
    const filters = { ...EMPTY_ISSUE_FILTERS, productArea: "Exports", type: "Bug", stage: "Detected", severity: "Medium" };
    expect(filterIssues(issues, filters).map((i) => i.id)).toEqual(["pdf"]);
    expect(activeIssueFilterCount(filters)).toBe(4);
    expect(filterIssues(issues, { ...filters, query: "CSV" })).toEqual([]);
  });
  it.each(["none", "productArea", "type", "stage"] as const)("retains each issue exactly once when grouped by %s", (grouping) => {
    const grouped = groupIssues(issues, grouping).flatMap((g) => g.issues);
    expect(grouped.map((i) => i.id).sort()).toEqual(issues.map((i) => i.id).sort());
    expect(issues.map((i) => i.id)).toEqual(["csv", "usage", "pdf"]);
  });
  it("uses lifecycle order and only adds empty stages when requested for the board", () => {
    expect(groupIssues(issues, "stage").map((g) => g.key)).toEqual(["Detected", "Needs review", "In progress"]);
    expect(groupIssues(issues, "stage", true).map((g) => g.key)).toEqual(PRODUCT_PROBLEM_STAGES);
  });
  it("labels missing product areas consistently in filtering and grouping", () => {
    const missing = { ...issues[0], productArea: " " };
    expect(issueProductArea(missing)).toBe("Unassigned");
    expect(groupIssues([missing], "productArea")[0].key).toBe("Unassigned");
    expect(filterIssues([missing], { ...EMPTY_ISSUE_FILTERS, productArea: "Unassigned" })).toEqual([missing]);
  });
});
