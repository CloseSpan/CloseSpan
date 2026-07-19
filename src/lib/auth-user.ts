import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { databasePool, persistenceMode } from "./db";
import { ORG_ID } from "./seed";

export interface WorkspaceUser {
  id: string;
  orgId: string;
  name: string;
  email: string;
  role: string;
}

export type WorkspaceAccess =
  | { status: "granted"; user: WorkspaceUser }
  | { status: "unauthenticated" }
  | { status: "denied"; email: string };

interface MemberRow {
  id: string;
  org_id: string;
  display_name: string;
  email: string;
  role: string;
}

function appMode(): "demo" | "production" {
  const configured = process.env.APP_MODE;
  if (configured === "demo" || configured === "production") return configured;
  return process.env.NODE_ENV === "production" ? "production" : "demo";
}

function demoUser(email: string, name?: string | null): WorkspaceUser {
  const digest = createHash("sha256").update(email).digest("hex").slice(0, 24);
  return {
    id: `google_${digest}`,
    orgId: ORG_ID,
    name: name?.trim() || email,
    email,
    role: "Admin",
  };
}

async function findWorkspaceMember(email: string): Promise<WorkspaceUser | null> {
  if (persistenceMode() !== "postgres") return null;
  const result = await databasePool().query<MemberRow>(
    `SELECT id, org_id, display_name, email, role
       FROM workspace_members
      WHERE org_id = $1 AND lower(email) = lower($2)
      LIMIT 1`,
    [ORG_ID, email],
  );
  const member = result.rows[0];
  if (!member) return null;
  return {
    id: member.id,
    orgId: member.org_id,
    name: member.display_name,
    email: member.email,
    role: member.role,
  };
}

export async function resolveWorkspaceAccess(): Promise<WorkspaceAccess> {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();
  const name = session?.user?.name;
  if (!email) return { status: "unauthenticated" };

  const member = await findWorkspaceMember(email);
  if (member) return { status: "granted", user: member };
  if (appMode() === "demo") {
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
