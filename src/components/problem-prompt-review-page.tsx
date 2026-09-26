import { notFound } from "next/navigation";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { getOverviewAnalytics } from "@/lib/overview-repository";
import { getEngineeringWorkflow } from "@/lib/engineering-workflow-repository";
import { readProblemPromptReview } from "@/lib/problem-prompt-review-repository";
import { readAutonomyLevel } from "@/lib/workspace-settings-repository";
import { autonomyCapabilities } from "@/lib/autonomy-policy";
import { workspacePersistenceMode } from "@/lib/workspace-persistence";
import { readIssueCodeReview } from "@/lib/issue-lifecycle-repository";
import { currentIssueCodingApprovalId, summarizeIssueExecution } from "@/lib/issue-lifecycle";
import { ProblemPromptReviewScreen } from "./problem-prompt-review-screen";
import { readPresentationDemo } from "@/lib/presentation-demo";
import { readIssueWorkspaceContext } from "@/lib/issue-workspace-context";
import { readIssueConversation } from "@/lib/issue-conversation-repository";
import { readIssueResultReview } from "@/lib/issue-result-review-repository";

export async function ProblemPromptReviewPage({ problemId }: { problemId: string }) {
  const user = await requireWorkspaceUser();
  const analytics = await getOverviewAnalytics(user.orgId);
  const problem = analytics.problems.find((item) => item.id === problemId);
  if (!problem) notFound();
  const [workflow, reviewState, autonomy, presentationDemo] = await Promise.all([
    getEngineeringWorkflow(user.orgId, problemId),
    readProblemPromptReview(user.orgId, problemId).then((review) => ({ review, storageReady: true })).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "42P01") {
        return { review: null, storageReady: false };
      }
      throw error;
    }),
    readAutonomyLevel(user.orgId),
    readPresentationDemo(user.orgId),
  ]);
  const [codeReview, issueContext, conversation, resultReview] = await Promise.all([
    workflow.run ? readIssueCodeReview(user.orgId, problemId, workflow.run.id) : null,
    readIssueWorkspaceContext(user.orgId, problemId, workflow),
    readIssueConversation(user.orgId, problemId),
    readIssueResultReview(user.orgId, problemId),
  ]);
  return <ProblemPromptReviewScreen problemId={problemId} title={problem.title}
    expectedBehavior={workflow.specification?.expectedBehavior ?? ""}
    reportCount={issueContext.reportCount}
    issueContext={issueContext} conversation={conversation} resultReview={resultReview}
    discussionDisabledReason={process.env.APP_MODE === "demo" ? "Live conversation and scenario checks are off while the app is in demo mode." : undefined}
    scenarioCheck={workflow.promptEvaluation?.review ?? null}
    execution={summarizeIssueExecution(workflow, codeReview)}
    currentPromptHash={workflow.prompt?.contentHash ?? null} currentPromptStatus={workflow.prompt?.status ?? null} review={reviewState.review}
    canReview={!presentationDemo && ["Admin", "Contributor"].includes(user.role)} preparationEnabled={autonomyCapabilities(autonomy).preparePrompt}
    canManage={user.role === "Admin"}
    closed={problem.stage === "Closed"}
    demo={workspacePersistenceMode(user.orgId) === "memory"} storageReady={reviewState.storageReady}
    presentationDemo={presentationDemo}
    approvalId={currentIssueCodingApprovalId(workflow)}
    runStatus={workflow.run?.status ?? null} />;
}
