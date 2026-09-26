import { ApprovalsScreen } from "@/components/screens";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { listEngineeringApprovalWorkflows } from "@/lib/engineering-workflow-repository";
import { getWorkspaceData } from "@/lib/workspace-repository";
import { listProblemReviewInbox } from "@/lib/problem-prompt-review-repository";
import { autonomyCapabilities } from "@/lib/autonomy-policy";
import { readPresentationDemo } from "@/lib/presentation-demo";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ approval?: string }> }) {
  const user = await requireWorkspaceUser();
  const [data, workflows, inbox, query, presentationDemo] = await Promise.all([
    getWorkspaceData(user.orgId), listEngineeringApprovalWorkflows(user.orgId),
    listProblemReviewInbox(user.orgId).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "42P01") return null;
      throw error;
    }), searchParams, readPresentationDemo(user.orgId),
  ]);
  const titles = Object.fromEntries(data.analytics.problems.map((problem) => [problem.id, problem.title]));
  const preparationEnabled = autonomyCapabilities(data.settings.autonomyLevel).preparePrompt;
  const requirementReviews = (inbox ?? []).filter((item) => titles[item.problemId] && (presentationDemo || item.needsHelp || preparationEnabled))
    .map((item) => ({ ...item, title: titles[item.problemId] }));
  return <ApprovalsScreen problem={data.primaryProblem} problemTitles={titles}
    initialEngineeringWorkflows={structuredClone(workflows)} orgId={user.orgId}
    canApprove={!presentationDemo && user.role === "Admin"} initialApprovalId={query.approval} presentationDemo={presentationDemo}
    requirementReviews={requirementReviews} reviewStorageReady={inbox !== null} />;
}
