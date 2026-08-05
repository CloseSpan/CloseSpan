import { databasePool, persistenceMode } from "./db";
import {
  createOrganization,
  listOrganizationMemberships,
  normalizeMembershipEmail,
} from "./organization-repository";

let waitlistSchemaPromise: Promise<void> | null = null;

export type WorkspaceAccessWaitlistStatus = "Pending" | "Approved" | "Declined";

export interface WorkspaceAccessWaitlistEntry {
  email: string;
  displayName: string | null;
  status: WorkspaceAccessWaitlistStatus;
  loginAttemptCount: number;
  firstAttemptedAt: Date;
  lastAttemptedAt: Date;
}

export interface ApprovedWorkspaceAccess {
  entry: WorkspaceAccessWaitlistEntry;
  organizationId: string;
  organizationName: string;
}

function ensureWaitlistSchema(): Promise<void> {
  waitlistSchemaPromise ??= databasePool()
    .query(
      `CREATE TABLE IF NOT EXISTS workspace_access_waitlist (
         email text PRIMARY KEY,
         display_name text,
         status text NOT NULL DEFAULT 'Pending'
           CHECK (status IN ('Pending','Approved','Declined')),
         login_attempt_count integer NOT NULL DEFAULT 1
           CHECK (login_attempt_count > 0),
         first_attempted_at timestamptz NOT NULL DEFAULT now(),
         last_attempted_at timestamptz NOT NULL DEFAULT now(),
         CHECK (char_length(email) BETWEEN 3 AND 320),
         CHECK (email = lower(btrim(email))),
         CHECK (position('@' in email) > 1),
         CHECK (
           display_name IS NULL
           OR char_length(btrim(display_name)) BETWEEN 1 AND 160
         )
       );
       CREATE INDEX IF NOT EXISTS workspace_access_waitlist_last_attempt_idx
         ON workspace_access_waitlist(last_attempted_at DESC);`,
    )
    .then(() => undefined)
    .catch((error: unknown) => {
      waitlistSchemaPromise = null;
      throw error;
    });

  return waitlistSchemaPromise;
}

function optionalDisplayName(name?: string | null): string | null {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return null;
  return trimmed.slice(0, 160);
}

export async function recordWorkspaceAccessAttempt(
  email: string,
  displayName?: string | null,
): Promise<void> {
  if (persistenceMode() !== "postgres") return;

  const normalizedEmail = normalizeMembershipEmail(email);
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("A valid verified email is required for the access waitlist");
  }

  await ensureWaitlistSchema();
  await databasePool().query(
    `INSERT INTO workspace_access_waitlist(
       email,display_name,status,login_attempt_count,
       first_attempted_at,last_attempted_at
     ) VALUES($1,$2,'Pending',1,now(),now())
     ON CONFLICT(email) DO UPDATE SET
       display_name=COALESCE(
         NULLIF(btrim(EXCLUDED.display_name),''),
         workspace_access_waitlist.display_name
       ),
       login_attempt_count=workspace_access_waitlist.login_attempt_count+1,
       last_attempted_at=now()`,
    [normalizedEmail, optionalDisplayName(displayName)],
  );
}

export async function ensureWorkspaceAccessWaitlistEntry(
  email: string,
): Promise<boolean> {
  if (persistenceMode() !== "postgres") return false;

  const normalizedEmail = normalizeMembershipEmail(email);
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("A valid verified email is required for the access waitlist");
  }

  await ensureWaitlistSchema();
  const result = await databasePool().query<{ status: string }>(
    `INSERT INTO workspace_access_waitlist(
       email,display_name,status,login_attempt_count,
       first_attempted_at,last_attempted_at
     ) VALUES($1,NULL,'Pending',1,now(),now())
     ON CONFLICT(email) DO UPDATE SET
       last_attempted_at=workspace_access_waitlist.last_attempted_at
     RETURNING status`,
    [normalizedEmail],
  );
  return result.rows[0]?.status !== "Declined";
}

export async function listWorkspaceAccessWaitlist(): Promise<
  WorkspaceAccessWaitlistEntry[]
> {
  if (persistenceMode() !== "postgres") return [];

  await ensureWaitlistSchema();
  const result = await databasePool().query<{
    email: string;
    display_name: string | null;
    status: WorkspaceAccessWaitlistStatus;
    login_attempt_count: number;
    first_attempted_at: Date;
    last_attempted_at: Date;
  }>(
    `SELECT email,display_name,status,login_attempt_count,
            first_attempted_at,last_attempted_at
       FROM workspace_access_waitlist
      ORDER BY last_attempted_at DESC,email ASC`,
  );

  return result.rows.map((row) => ({
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    loginAttemptCount: row.login_attempt_count,
    firstAttemptedAt: new Date(row.first_attempted_at),
    lastAttemptedAt: new Date(row.last_attempted_at),
  }));
}

export async function isWorkspaceAccessApproved(email: string): Promise<boolean> {
  if (persistenceMode() !== "postgres") return false;
  const normalizedEmail = normalizeMembershipEmail(email);
  if (!normalizedEmail || !normalizedEmail.includes("@")) return false;
  await ensureWaitlistSchema();
  const result = await databasePool().query<{ approved: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM workspace_access_waitlist
        WHERE email=$1 AND status='Approved'
     ) AS approved`,
    [normalizedEmail],
  );
  return result.rows[0]?.approved === true;
}

export async function approveWorkspaceAccessWaitlistEntry(
  email: string,
): Promise<ApprovedWorkspaceAccess> {
  if (persistenceMode() !== "postgres")
    throw new Error("PostgreSQL persistence is required to approve waitlist users");
  const normalizedEmail = normalizeMembershipEmail(email);
  if (!normalizedEmail || !normalizedEmail.includes("@"))
    throw new Error("A valid waitlist email is required");

  await ensureWaitlistSchema();
  const existing = await databasePool().query<{
    email: string;
    display_name: string | null;
  }>(
    `SELECT email,display_name FROM workspace_access_waitlist WHERE email=$1`,
    [normalizedEmail],
  );
  const waitlistUser = existing.rows[0];
  if (!waitlistUser) throw new Error("Waitlist user was not found");

  const displayName = waitlistUser.display_name?.trim() || normalizedEmail.split("@")[0] || "CloseSpan user";
  let membership = (await listOrganizationMemberships(normalizedEmail))[0];
  if (!membership) {
    const created = await createOrganization({
      name: `${displayName}'s workspace`.slice(0, 120),
      productName: null,
      productUrl: null,
      productDescription: null,
      creator: { name: displayName, email: normalizedEmail },
    });
    membership = {
      memberId: created.memberId,
      organizationId: created.organizationId,
      organizationName: created.organizationName,
      displayName,
      email: normalizedEmail,
      role: "Admin",
    };
  }

  const approved = await databasePool().query<{
    email: string;
    display_name: string | null;
    status: WorkspaceAccessWaitlistStatus;
    login_attempt_count: number;
    first_attempted_at: Date;
    last_attempted_at: Date;
  }>(
    `UPDATE workspace_access_waitlist
        SET status='Approved',last_attempted_at=now()
      WHERE email=$1
      RETURNING email,display_name,status,login_attempt_count,
                first_attempted_at,last_attempted_at`,
    [normalizedEmail],
  );
  const row = approved.rows[0];
  if (!row) throw new Error("Waitlist approval could not be saved");
  return {
    entry: {
      email: row.email,
      displayName: row.display_name,
      status: row.status,
      loginAttemptCount: row.login_attempt_count,
      firstAttemptedAt: new Date(row.first_attempted_at),
      lastAttemptedAt: new Date(row.last_attempted_at),
    },
    organizationId: membership.organizationId,
    organizationName: membership.organizationName,
  };
}
