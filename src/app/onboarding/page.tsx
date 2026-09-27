import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { OnboardingAgentPanel } from "@/components/onboarding-agent-panel";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { getWorkspaceSetupStatus } from "@/lib/integration-repository";
import { getOnboardingState } from "@/lib/onboarding-repository";
import { cookies } from "next/headers";
import { OnboardingWelcome } from "@/components/onboarding-welcome";
import { OnboardingAppearance } from "@/components/onboarding-appearance";
import { needsOnboardingChoice, onboardingAppearanceCookie, onboardingStartedCookie } from "@/lib/onboarding-entry";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{
    github?: string | string[];
    discord?: string | string[];
    reason?: string | string[];
    step?: string | string[];
  }>;
}) {
  const user = await requireWorkspaceUser();
  const [setup, onboarding, params] = await Promise.all([
    getWorkspaceSetupStatus(user.orgId),
    getOnboardingState(user.orgId),
    searchParams,
  ]);
  const githubCallback = Array.isArray(params.github)
    ? params.github[0]
    : params.github;
  const githubCallbackReason = Array.isArray(params.reason)
    ? params.reason[0]
    : params.reason;
  const discordCallback = Array.isArray(params.discord)
    ? params.discord[0]
    : params.discord;
  const returningFromGithub =
    githubCallback === "connected" || githubCallback === "error";
  const returningFromDiscord =
    discordCallback === "connected" || discordCallback === "error";
  const showOnboarding =
    returningFromGithub ||
    returningFromDiscord ||
    (onboarding.phase !== "complete" &&
      !setup.setupComplete &&
      setup.feedbackCount === 0);

  const welcomeRequested = params.step === "welcome";
  const appearanceRequested = params.step === "appearance";
  if (!showOnboarding && !welcomeRequested && !appearanceRequested) redirect("/overview");
  const store = await cookies();
  const showChoice =
    !returningFromGithub &&
    !returningFromDiscord &&
    (welcomeRequested || appearanceRequested || needsOnboardingChoice(
      onboarding,
      setup,
      store.get(onboardingStartedCookie(user.email, user.orgId))?.value === "true",
    ));
  const showAppearance = showChoice && (appearanceRequested ||
    store.get(onboardingAppearanceCookie(user.email))?.value !== "true");

  return (
    <AppShell user={user} immersive>
      {showAppearance ? (
        <OnboardingAppearance />
      ) : showChoice ? (
        <OnboardingWelcome />
      ) : (
        <OnboardingAgentPanel
          orgId={user.orgId}
          canManageGithub={user.role === "Admin"}
          initialSetup={setup}
          githubCallbackStatus={githubCallback ?? null}
          githubCallbackReason={githubCallbackReason ?? null}
          discordCallbackStatus={discordCallback ?? null}
          discordCallbackReason={githubCallbackReason ?? null}
        />
      )}
    </AppShell>
  );
}
