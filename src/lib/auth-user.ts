import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { databasePool, persistenceMode } from "./db";
import { ORG_ID } from "./seed";

export interface WorkspaceUser {
  id: string;
  orgId: string;
  organizationName: string;
  name: string;
  email: string;
  role: string;
}

export type WorkspaceAccess =
  | { status: "granted"; user: WorkspaceUser }
  | { status: "unauthenticated" }
  | { status: "denied"; email: string };

export interface WorkspaceMemberIdentityRow {
  id: string;
  org_id: string;
  organization_name: string;
  display_name: string;
  email: string;
  role: string;
}

export function applicationMode(): "demo" | "production" {
  const configured = process.env.APP_MODE;
  if (configured === "demo" || configured === "production") return configured;
  return process.env.NODE_ENV === "production" ? "production" : "demo";
}

export function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const [localPart, domainPart] = trimmed.split("@");
  if (!localPart || !domainPart) return trimmed;
  const domain =
    domainPart === "googlemail.com" ? "gmail.com" : domainPart;
  if (domain === "gmail.com") {
    const local = localPart.split("+")[0]?.replace(/\./g, "") ?? localPart;
    return `${local}@${domain}`;
  }
  return `${localPart}@${domain}`;
}

export function displayFirstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}

export function workspaceUserFromMemberships(
  memberships: WorkspaceMemberIdentityRow[],
  verifiedEmail: string,
  verifiedSessionName?: string | null,
): WorkspaceUser | null {
  if (memberships.length !== 1) return null;
  const member = memberships[0];
  const sessionName = verifiedSessionName?.trim();
  return {
    id: member.id,
    orgId: member.org_id,
    organizationName: member.organization_name,
    name: sessionName || member.display_name,
    email: normalizeEmail(verifiedEmail),
    role: member.role,
  };
}

function demoUser(email: string, name?: string | null): WorkspaceUser {
  const digest = createHash("sha256").update(email).digest("hex").slice(0, 24);
  return {
    id: `google_${digest}`,
    orgId: ORG_ID,
    organizationName: "Feelow AI Demo",
    name: name?.trim() || email,
    email,
    role: "Admin",
  };
}

function membershipLookupSql(): string {
  return `SELECT m.id, m.org_id, o.name AS organization_name,
            m.display_name, m.email, m.role
       FROM workspace_members m
       JOIN organizations o ON o.id = m.org_id
      WHERE lower(replace(split_part(btrim(m.email), '@', 1), '.', ''))
            || '@'
            || CASE
                 WHEN lower(split_part(btrim(m.email), '@', 2)) = 'googlemail.com'
                   THEN 'gmail.com'
                 ELSE lower(split_part(btrim(m.email), '@', 2))
               END
            = $1
      ORDER BY m.org_id, m.id`;
}

export async function hasWorkspaceMembership(email: string): Promise<boolean> {
  if (persistenceMode() !== "postgres") return false;
  const result = await databasePool().query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM workspace_members m
      WHERE lower(replace(split_part(btrim(m.email), '@', 1), '.', ''))
            || '@'
            || CASE
                 WHEN lower(split_part(btrim(m.email), '@', 2)) = 'googlemail.com'
                   THEN 'gmail.com'
                 ELSE lower(split_part(btrim(m.email), '@', 2))
               END
            = $1`,
    [normalizeEmail(email)],
  );
  return Number(result.rows[0]?.count ?? 0) > 0;
}

async function findWorkspaceMember(
  email: string,
  verifiedSessionName?: string | null,
): Promise<WorkspaceUser | null> {
  if (persistenceMode() !== "postgres") return null;
  const result = await databasePool().query<WorkspaceMemberIdentityRow>(
    membershipLookupSql(),
    [normalizeEmail(email)],
  );
  return workspaceUserFromMemberships(
    result.rows,
    email,
    verifiedSessionName,
  );
}

export async function resolveWorkspaceAccess(): Promise<WorkspaceAccess> {
  const session = await auth();
  const email = session?.user?.email
    ? normalizeEmail(session.user.email)
    : "";
  const name = session?.user?.name;
  if (!email) return { status: "unauthenticated" };

  const member = await findWorkspaceMember(email, name);
  if (member) return { status: "granted", user: member };
  if (applicationMode() === "demo") {
    return {
      status: "granted",
      user: demoUser(email, name),
    };
  }
  return { status: "denied", email };
}

export async function requireWorkspaceUser(): Promise<WorkspaceUser> {
  const access = await resolveWorkspaceAccess();
  if (access.status === "granted") return access.user;
  if (access.status === "denied") redirect("/login?error=AccessDenied");
  redirect("/login");
}
