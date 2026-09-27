"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ACTIVE_ORGANIZATION_COOKIE,
  LEGACY_ACTIVE_ORGANIZATION_COOKIE,
  activeOrganizationCookieOptions,
  requireWorkspaceUser,
} from "@/lib/auth-user";
import {
  DEMO_RETURN_COOKIE,
  DEMO_SESSION_COOKIE,
  demoSessionCookieValue,
  getOnboardingDemoWorkspace,
  onboardingAppearanceCookie,
  onboardingStartedCookie,
} from "@/lib/onboarding-entry";

export interface OnboardingEntryState {
  error: string | null;
}

export async function completeOnboardingAppearanceAction(): Promise<OnboardingEntryState> {
  const user = await requireWorkspaceUser();
  try {
    const store = await cookies();
    store.set(onboardingAppearanceCookie(user.email), "true", {
      ...activeOrganizationCookieOptions(),
      maxAge: 60 * 60 * 24 * 365,
    });
  } catch {
    return { error: "Couldn’t save your progress. Please try again." };
  }
  revalidatePath("/onboarding");
  redirect("/onboarding?step=welcome");
}

export async function exploreDemoAction(): Promise<OnboardingEntryState> {
  const user = await requireWorkspaceUser();
  let demo: Awaited<ReturnType<typeof getOnboardingDemoWorkspace>>;
  try {
    demo = await getOnboardingDemoWorkspace();
  } catch {
    return { error: "The demo couldn’t load. Try again or set up your workspace." };
  }
  if (!demo) return { error: "The demo is temporarily unavailable. You can still set up your workspace." };
  const returnOrgId = user.demoSession?.returnOrgId ?? user.orgId;
  if (returnOrgId === demo.id) return { error: "You’re already in the demo. Switch to your own workspace to start setup." };
  const store = await cookies();
  const options = activeOrganizationCookieOptions();
  store.set(DEMO_SESSION_COOKIE, demoSessionCookieValue(user.email, demo.id), options);
  store.set(DEMO_RETURN_COOKIE, returnOrgId, options);
  store.set(ACTIVE_ORGANIZATION_COOKIE, demo.id, options);
  store.delete(LEGACY_ACTIVE_ORGANIZATION_COOKIE);
  revalidatePath("/", "layout");
  redirect("/overview");
}

export async function continueOnboardingAction(): Promise<void> {
  const user = await requireWorkspaceUser();
  const orgId = user.demoSession?.returnOrgId ?? user.orgId;
  // Return only to a membership resolved from the signed-in identity, never a
  // posted org ID or the unvalidated return cookie.
  if (!user.organizations.some((organization) => organization.id === orgId))
    throw new Error("Workspace access is not available");
  const store = await cookies();
  const options = activeOrganizationCookieOptions();
  store.set(ACTIVE_ORGANIZATION_COOKIE, orgId, options);
  store.set(onboardingStartedCookie(user.email, orgId), "true", options);
  store.delete(DEMO_SESSION_COOKIE);
  store.delete(DEMO_RETURN_COOKIE);
  store.delete(LEGACY_ACTIVE_ORGANIZATION_COOKIE);
  revalidatePath("/", "layout");
  redirect("/onboarding");
}
