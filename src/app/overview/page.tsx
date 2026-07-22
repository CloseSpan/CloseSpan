import { AppShell } from "@/components/app-shell";
import { OverviewScreen } from "@/components/screens";
import { OnboardingAgentPanel } from "@/components/onboarding-agent-panel";
import { displayFirstName, requireWorkspaceUser } from "@/lib/auth-user";
import { getWorkspaceSetupStatus } from "@/lib/integration-repository";
import { getOnboardingState } from "@/lib/onboarding-repository";
import { getOverviewAnalytics } from "@/lib/overview-repository";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const user = await requireWorkspaceUser();
  const [analytics, setup, onboarding] = await Promise.all([
    getOverviewAnalytics(user.orgId),
    getWorkspaceSetupStatus(user.orgId),
    getOnboardingState(user.orgId),
  ]);
  const showOnboarding =
    onboarding.phase !== "complete" &&
    !setup.setupComplete &&
    setup.feedbackCount === 0;

  return (
    <AppShell
      section="Executive overview"
      user={user}
      immersive={showOnboarding}
    >
      {showOnboarding ? (
        <OnboardingAgentPanel
          orgId={user.orgId}
          firstName={displayFirstName(user.name)}
          organizationName={user.organizationName}
          initialSetup={setup}
        />
      ) : (
        <OverviewScreen
          analytics={analytics}
          firstName={displayFirstName(user.name)}
          organizationName={user.organizationName}
        />
      )}
    </AppShell>
  );
}
