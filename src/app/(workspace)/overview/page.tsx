import { redirect } from "next/navigation";
import { OverviewScreen } from "@/components/screens";
import { displayFirstName, requireWorkspaceUser } from "@/lib/auth-user";
import { pendingActionApprovalCount } from "@/lib/engineering-workflow-repository";
import { getWorkspaceSetupStatus } from "@/lib/integration-repository";
import { getOnboardingState } from "@/lib/onboarding-repository";
import { getOverviewAnalytics } from "@/lib/overview-repository";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const user = await requireWorkspaceUser();
  const [analytics, setup, onboarding, pendingApprovals] = await Promise.all([
    getOverviewAnalytics(user.orgId),
    getWorkspaceSetupStatus(user.orgId),
    getOnboardingState(user.orgId),
    pendingActionApprovalCount(user.orgId),
  ]);
  const showOnboarding =
    onboarding.phase !== "complete" &&
    !setup.setupComplete &&
    setup.feedbackCount === 0;

  if (showOnboarding) redirect("/onboarding");

  return (
    <OverviewScreen
      analytics={analytics}
      firstName={displayFirstName(user.name)}
      organizationName={user.organizationName}
      pendingApprovals={pendingApprovals}
    />
  );
}
