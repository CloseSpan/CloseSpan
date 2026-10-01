import type { OverviewAnalytics } from "./overview-analytics";
import { ISSUE_BOARD_GROUPS, issueBoardGroup } from "./issue-board";

export type Issue = OverviewAnalytics["problems"][number];
export type IssueGrouping = "none" | "productArea" | "type" | "stage";
export type IssueFilters = {
  query: string;
  productArea: string;
  type: string;
  stage: string;
  severity: string;
};

export const EMPTY_ISSUE_FILTERS: IssueFilters = {
  query: "", productArea: "", type: "", stage: "", severity: "",
};

export function issueProductArea(issue: Issue): string {
  return issue.productArea.trim() || "Unassigned";
}

/** Both layouts consume this same ordered set; layout never changes membership. */
export function filterIssues(issues: Issue[], filters: IssueFilters): Issue[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return issues.filter((issue) =>
    (!query || `${issue.title} ${issueProductArea(issue)} ${issue.type}`.toLocaleLowerCase().includes(query)) &&
    (!filters.productArea || issueProductArea(issue) === filters.productArea) &&
    (!filters.type || issue.type === filters.type) &&
    (!filters.stage || issue.stage === filters.stage) &&
    (!filters.severity || issue.severity === filters.severity),
  );
}

export function groupIssues<T extends Issue>(
  issues: T[],
  grouping: IssueGrouping,
  includeEmptyStages = false,
): { key: string; issues: T[] }[] {
  if (grouping === "none") return [{ key: "All issues", issues }];
  const groups = new Map<string, T[]>();
  if (grouping === "stage") {
    for (const group of ISSUE_BOARD_GROUPS) groups.set(group, []);
  }
  for (const issue of issues) {
    const key = grouping === "stage" ? issueBoardGroup(issue)
      : grouping === "productArea" ? issueProductArea(issue) : issue[grouping];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(issue);
  }
  const entries = [...groups].filter(([, rows]) => rows.length || includeEmptyStages);
  if (grouping !== "stage") entries.sort(([left], [right]) => left.localeCompare(right));
  return entries.map(([key, rows]) => ({ key, issues: rows }));
}

export function activeIssueFilterCount(filters: IssueFilters): number {
  return [filters.productArea, filters.type, filters.stage, filters.severity].filter(Boolean).length;
}
