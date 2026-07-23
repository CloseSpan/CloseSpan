import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { persistenceMode } from "./db";
import {
  listOrganizationMemberships,
  normalizeMembershipEmail,
  selectOrganizationMembership,
  type OrganizationMembership,
} from "./organization-repository";
import { ORG_ID } from "./seed";
import {
  isPrivateBetaAccessEnforced,
  isPrivateBetaOwner,
  PRIVATE_BETA_OWNER_EMAIL,
} from "./workspace-access-policy";

export const ACTIVE_ORGANIZATION_COOKIE = "closespan_active_org";
export const LEGACY_ACTIVE_ORGANIZATION_COOKIE = "feelow_active_org";

export function activeOrganizationCookieOptions(): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}

export interface WorkspaceUser {
  id: string;
  orgId: string;
  organizationName: string;
  name: string;
  email: string;
  role: string;
  organizations: Array<{ id: string; name: string; role: string }>;
}

export type WorkspaceAccess =
  | { status: "granted"; user: WorkspaceUser }
  | { status: "unauthenticated" }
  | { status: "denied"; email: string }
  | { status: "unavailable"; email: string };

export type WorkspaceMemberIdentityRow = OrganizationMembership;

export function applicationMode(): "demo" | "production" {
  const configured = process.env.APP_MODE;
  if (configured === "demo" || configured === "production") return configured;
  return process.env.NODE_ENV === "production" ? "production" : "demo";
}

export function normalizeEmail(email: string): string {
  return normalizeMembershipEmail(email);
}

export function displayFirstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}

export function workspaceUserFromMemberships(
  memberships: readonly OrganizationMembership[],
  verifiedEmail: string,
  verifiedSessionName?: string | null,
  activeOrganizationId?: string | null,
): WorkspaceUser | null {
  const member = selectOrganizationMembership(
    memberships,
    activeOrganizationId,
  );
  if (!member) return null;
  const sessionName = verifiedSessionName?.trim();
  return {
    id: member.memberId,
    orgId: member.organizationId,
    organizationName: member.organizationName,
    name: sessionName || member.displayName,
    email: normalizeEmail(verifiedEmail),
    role: member.role,
    organizations: memberships.map((membership) => ({
      id: membership.organizationId,
      name: membership.organizationName,
      role: membership.role,
    })),
  };
}

function demoUser(email: string, name?: string | null): WorkspaceUser {
  const digest = createHash("sha256").update(email).digest("hex").slice(0, 24);
  return {
    id: `google_${digest}`,
    orgId: ORG_ID,
    organizationName: "CloseSpan Demo",
    name: name?.trim() || email,
    email,
    role: "Admin",
    organizations: [{ id: ORG_ID, name: "CloseSpan Demo", role: "Admin" }],
  };
}

function privateBetaOwnerFallbackUser(
  name?: string | null,
): WorkspaceUser {
  const orgId = process.env.PRODUCTION_ORG_ID?.trim() || ORG_ID;
  const organizationName =
    process.env.PRODUCTION_ORG_NAME?.trim() || "CloseSpan";
  const digest = createHash("sha256")
    .update(PRIVATE_BETA_OWNER_EMAIL)
    .digest("hex")
    .slice(0, 24);

  return {
    id: `google_${digest}`,
    orgId,
    organizationName,
    name: name?.trim() || "Shanmukh Sain",
    email: PRIVATE_BETA_OWNER_EMAIL,
    role: "Admin",
    organizations: [{ id: orgId, name: organizationName, role: "Admin" }],
  };
}

export async function hasWorkspaceMembership(email: string): Promise<boolean> {
  if (persistenceMode() !== "postgres") return false;
  return (await listOrganizationMemberships(normalizeEmail(email))).length > 0;
}

async function findWorkspaceMember(
  email: string,
  verifiedSessionName?: string | null,
  activeOrganizationId?: string | null,
): Promise<WorkspaceUser | null> {
  if (persistenceMode() !== "postgres") return null;
  const memberships = await listOrganizationMemberships(normalizeEmail(email));
  return workspaceUserFromMemberships(
    memberships,
    email,
    verifiedSessionName,
    activeOrganizationId,
  );
}

async function activeOrganizationIdFromCookie(): Promise<string | null> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  return (
    store.get(ACTIVE_ORGANIZATION_COOKIE)?.value ??
    store.get(LEGACY_ACTIVE_ORGANIZATION_COOKIE)?.value ??
    null
  );
}

export async function resolveWorkspaceAccess(): Promise<WorkspaceAccess> {
  const session = await auth();
  const email = session?.user?.email
    ? normalizeEmail(session.user.email)
    : "";
  const name = session?.user?.name;
  if (!email) return { status: "unauthenticated" };

  if (!isPrivateBetaAccessEnforced()) {
    const activeOrganizationId = await activeOrganizationIdFromCookie();
    const member = await findWorkspaceMember(email, name, activeOrganizationId);
    if (member) return { status: "granted", user: member };
    return {
      status: "granted",
      user: demoUser(email, name),
    };
  }

  if (!isPrivateBetaOwner(email)) return { status: "denied", email };

  try {
    const activeOrganizationId = await activeOrganizationIdFromCookie();
    const member = await findWorkspaceMember(email, name, activeOrganizationId);
    if (member) return { status: "granted", user: member };
    return { status: "granted", user: privateBetaOwnerFallbackUser(name) };
  } catch (error) {
    console.error("Unable to load the private beta owner workspace", error);
  }

  return { status: "unavailable", email };
}

export async function requireWorkspaceUser(): Promise<WorkspaceUser> {
  const access = await resolveWorkspaceAccess();
  if (access.status === "granted") return access.user;
  if (access.status === "denied") redirect("/waitlist");
  if (access.status === "unavailable")
    redirect("/login?error=WorkspaceUnavailable");
  redirect("/login");
}
