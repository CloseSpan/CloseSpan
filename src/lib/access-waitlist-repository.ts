import { databasePool, persistenceMode } from "./db";
import { normalizeMembershipEmail } from "./organization-repository";

let waitlistSchemaPromise: Promise<void> | null = null;

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
