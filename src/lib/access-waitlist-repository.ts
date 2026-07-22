import { databasePool, persistenceMode } from "./db";
import { normalizeMembershipEmail } from "./organization-repository";

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

  await databasePool().query(
    `INSERT INTO workspace_access_waitlist(
       email,display_name,status,login_attempt_count,
       first_attempted_at,last_attempted_at
     ) VALUES($1,NULL,'Pending',1,now(),now())
     ON CONFLICT(email) DO NOTHING`,
    [normalizedEmail],
  );
  return true;
}
