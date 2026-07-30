import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { OnboardingAgentPanel } from "@/components/onboarding-agent-panel";
import { displayFirstName, requireWorkspaceUser } from "@/lib/auth-user";
import { getWorkspaceSetupStatus } from "@/lib/integration-repository";
import { getOnboardingState } from "@/lib/onboarding-repository";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireWorkspaceUser();
  const [setup, onboarding] = await Promise.all([
    getWorkspaceSetupStatus(user.orgId),
    getOnboardingState(user.orgId),
  ]);
  const showOnboarding =
    onboarding.phase !== "complete" &&
    !setup.setupComplete &&
    setup.feedbackCount === 0;

  if (!showOnboarding) redirect("/overview");

  return (
    <AppShell user={user} immersive>
      <OnboardingAgentPanel
        orgId={user.orgId}
        firstName={displayFirstName(user.name)}
        organizationName={user.organizationName}
        initialSetup={setup}
      />
    </AppShell>
  );
}
