import { createHash } from "node:crypto";
import { cache } from "react";
import { databasePool, persistenceMode } from "./db";
import type { OnboardingState } from "./onboarding-repository";
import type { WorkspaceSetupStatus } from "./integration-repository";

export const DEMO_SESSION_COOKIE = "closespan_demo_org";
export const DEMO_RETURN_COOKIE = "closespan_demo_return_org";

// Bind this preference to the verified account so another account signing in
// on the same browser still gets its own first-run choice. This is not an auth
// credential: the server independently validates the eligible demo on every request.
export function demoSessionCookieValue(email: string, orgId: string): string {
  return createHash("sha256").update(`demo:${email}:${orgId}`).digest("hex");
}

export function onboardingStartedCookie(email: string, orgId: string): string {
  const key = createHash("sha256").update(`${email}:${orgId}`).digest("hex").slice(0, 24);
  return `closespan_onboarding_${key}`;
}

// Appearance is personal, so remember this step across the user's workspaces.
export function onboardingAppearanceCookie(email: string): string {
  const key = createHash("sha256").update(email).digest("hex").slice(0, 24);
  return `closespan_appearance_${key}`;
}

export function needsOnboardingChoice(
  onboarding: OnboardingState,
  setup: WorkspaceSetupStatus,
  started: boolean,
): boolean {
  return !started && onboarding.phase === "discover" &&
    onboarding.messages.length === 0 &&
    !onboarding.productProfile.companyProfileConfirmed &&
    !setup.githubConnected && !setup.feedbackConnected &&
    !setup.setupComplete && setup.feedbackCount === 0;
}

/** Never infer a publicly explorable demo from its name or an arbitrary org ID.
 * Only the explicitly marked, guided presentation fixture is eligible. If more
 * than one exists, the operator must select one with ONBOARDING_DEMO_ORG_ID.
 */
export const getOnboardingDemoWorkspace = cache(async (): Promise<{
  id: string;
  name: string;
} | null> => {
  if (persistenceMode() !== "postgres") return null;
  const configuredId = process.env.ONBOARDING_DEMO_ORG_ID?.trim() || null;
  const result = await databasePool().query<{ id: string; name: string }>(
    `SELECT o.id, o.name FROM organizations o
       JOIN workspace_onboarding onboarding ON onboarding.org_id=o.id
       JOIN workspace_demo_guides guide ON guide.org_id=o.id
      WHERE onboarding.product_profile->>'demoMode'='presentation'
        AND guide.enabled=true
        AND ($1::text IS NULL OR o.id=$1)
      ORDER BY o.id LIMIT 2`,
    [configuredId],
  );
  return result.rows.length === 1 ? result.rows[0] : null;
});
