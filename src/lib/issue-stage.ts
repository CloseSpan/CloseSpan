import type { ProblemActiveWork } from "./problem-active-work";

export type IssueStageTone = "neutral" | "review" | "active";
export type IssueGroup = "Open" | "Needs review" | "In progress" | "Release" | "Closed";

export const ISSUE_GROUPS: IssueGroup[] = [
  "Open", "Needs review", "In progress", "Release", "Closed",
];

export interface IssueStage {
  label: string;
  tone: IssueStageTone;
  group: IssueGroup;
}

/** A list status describes recorded work; it never certifies that a fix is safe to merge. */
export function getIssueStage(issue: {
  stage: string;
  activeWork?: ProblemActiveWork | null;
  reviewState?: "needed" | "attention" | null;
}): IssueStage {
  if (issue.stage === "Closed") return { label: "Closed", tone: "neutral", group: "Closed" };
  if (issue.reviewState) return { label: issue.reviewState === "attention" ? "Needs attention" : "Needs your review", tone: "review", group: "Needs review" };

  const active = issue.activeWork?.status;
  if (active) {
    const activeStages: Record<ProblemActiveWork["status"], IssueStage> = {
      Testing: { label: "Checking expected behavior", tone: "active", group: "In progress" },
      Preparing: { label: "Preparing the fix", tone: "active", group: "In progress" },
      Queued: { label: "Queued", tone: "neutral", group: "In progress" },
      Tenki: { label: "Implementing", tone: "active", group: "In progress" },
      Working: { label: "Implementing", tone: "active", group: "In progress" },
      CI: { label: "Checking the fix", tone: "active", group: "In progress" },
      Merging: { label: "Merging", tone: "active", group: "Release" },
      Deploying: { label: "Releasing", tone: "active", group: "Release" },
      Verifying: { label: "Checking the release", tone: "active", group: "Release" },
    };
    return activeStages[active];
  }

  switch (issue.stage) {
    case "Detected": return { label: "Reported", tone: "neutral", group: "Open" };
    // This legacy stage means intake triage, not an available human decision.
    case "Needs review": return { label: "Reported", tone: "neutral", group: "Open" };
    case "Approved": return { label: "Approved", tone: "neutral", group: "Open" };
    case "Planned": return { label: "Planned", tone: "neutral", group: "Open" };
    case "In progress": return { label: "In progress", tone: "active", group: "In progress" };
    case "Release Ready": return { label: "Release review", tone: "review", group: "Needs review" };
    case "Released": return { label: "Release recorded", tone: "neutral", group: "Release" };
    case "Verified": return { label: "Verification recorded", tone: "neutral", group: "Release" };
    default: return { label: issue.stage.trim() || "Status unavailable", tone: "neutral", group: "Open" };
  }
}
