import { redirect } from "next/navigation";
import { ProblemsScreen } from "@/components/screens";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { getOverviewAnalytics } from "@/lib/overview-repository";
import { readIssueReviewStates } from "@/lib/issue-review-repository";
import { getWorkspaceSetupStatus } from "@/lib/integration-repository";
import { getOnboardingState } from "@/lib/onboarding-repository";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireWorkspaceUser();
  const [analytics, reviewStates, setup, onboarding] = await Promise.all([
    getOverviewAnalytics(user.orgId),
    readIssueReviewStates(user.orgId),
    getWorkspaceSetupStatus(user.orgId),
    getOnboardingState(user.orgId),
  ]);
  // Issues is home, so a workspace with no setup and no feedback starts onboarding here.
  if (onboarding.phase !== "complete" && !setup.setupComplete && setup.feedbackCount === 0) redirect("/onboarding");

  return <ProblemsScreen analytics={{ ...analytics, problems: analytics.problems.map((problem) => ({
    ...problem, reviewState: reviewStates[problem.id] ?? null,
  })) }} />;
}
