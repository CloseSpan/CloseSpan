import { ProblemsScreen } from "@/components/screens";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { getOverviewAnalytics } from "@/lib/overview-repository";
import { readIssueReviewStates } from "@/lib/issue-review-repository";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireWorkspaceUser();
  const [analytics, reviewStates] = await Promise.all([
    getOverviewAnalytics(user.orgId),
    readIssueReviewStates(user.orgId),
  ]);

  return <ProblemsScreen analytics={{ ...analytics, problems: analytics.problems.map((problem) => ({
    ...problem, reviewState: reviewStates[problem.id] ?? null,
  })) }} />;
}
