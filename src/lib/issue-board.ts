import type { ProblemActiveWork } from "./problem-active-work";

export const ISSUE_BOARD_GROUPS = ["Open", "In progress", "Needs your review", "Closed"] as const;
export type IssueBoardGroup = (typeof ISSUE_BOARD_GROUPS)[number];
export type IssueReviewState = "needed" | "attention";

/** Presentation only: a board column never authorizes work or certifies a fix. */
export function issueBoardGroup(issue: {
  stage: string;
  activeWork?: Pick<ProblemActiveWork, "status"> | null;
  reviewState?: IssueReviewState | null;
}): IssueBoardGroup {
  if (issue.stage === "Closed") return "Closed";
  if (issue.reviewState) return "Needs your review";
  if (issue.activeWork || ["In progress", "Release Ready", "Released", "Verified"].includes(issue.stage)) {
    return "In progress";
  }
  // Detected/Needs review are intake states, not evidence of a pending decision.
  // Approved/Planned remain open until work actually begins.
  return "Open";
}
