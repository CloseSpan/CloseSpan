import { autonomyCapabilities } from "./autonomy-policy";
import { listEngineeringApprovalWorkflows } from "./engineering-workflow-repository";
import type { IssueReviewState } from "./issue-board";
import { readPresentationDemo } from "./presentation-demo";
import { listProblemReviewInbox } from "./problem-prompt-review-repository";
import { readAutonomyLevel } from "./workspace-settings-repository";

/** Use the same current decisions and policy visibility as Action approvals. */
export async function readIssueReviewStates(orgId: string): Promise<Record<string, IssueReviewState>> {
  const [workflows, inbox, autonomy, presentationDemo] = await Promise.all([
    listEngineeringApprovalWorkflows(orgId),
    listProblemReviewInbox(orgId).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "42P01") return [];
      throw error;
    }),
    readAutonomyLevel(orgId),
    readPresentationDemo(orgId),
  ]);
  const reviews: Record<string, IssueReviewState> = {};
  for (const workflow of workflows) {
    if (workflow.approval?.status === "Pending" || workflow.finalApproval?.status === "Pending") {
      reviews[workflow.problemId] = "needed";
    }
  }
  for (const item of inbox) {
    if (presentationDemo || item.needsHelp || autonomyCapabilities(autonomy).preparePrompt) {
      reviews[item.problemId] = item.needsHelp ? "attention" : "needed";
    }
  }
  return reviews;
}
