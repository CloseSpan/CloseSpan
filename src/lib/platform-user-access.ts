import { databasePool, persistenceMode } from "./db";
import { normalizeMembershipEmail } from "./organization-repository";

export type PlatformUserStatus = "Active" | "Blocked" | "Deleted";

// Kept additive, like the existing platform sign-in activity schema, so access
// checks work on installations that have not yet run the migration command.
export const platformUserAccessSchema = `
  CREATE TABLE IF NOT EXISTS platform_user_access (
    email text PRIMARY KEY CHECK (email = lower(btrim(email))),
    status text NOT NULL CHECK (status IN ('Active','Blocked','Deleted')),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS platform_user_admin_events (
    id uuid PRIMARY KEY,
    actor_email text NOT NULL,
    target_email text NOT NULL,
    action text NOT NULL CHECK (action IN ('block','unblock','delete')),
    previous_status text NOT NULL,
    organization_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    request_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (actor_email,request_id)
  );`;

let schemaPromise: Promise<void> | null = null;
export function ensurePlatformUserAccessSchema(): Promise<void> {
  schemaPromise ??= databasePool().query(platformUserAccessSchema)
    .then(() => undefined)
    .catch((error: unknown) => { schemaPromise = null; throw error; });
  return schemaPromise;
}

export async function readPlatformUserStatus(email: string): Promise<PlatformUserStatus> {
  if (persistenceMode() !== "postgres") return "Active";
  await ensurePlatformUserAccessSchema();
  const result = await databasePool().query<{ status: PlatformUserStatus }>(
    "SELECT status FROM platform_user_access WHERE email=$1",
    [normalizeMembershipEmail(email)],
  );
  return result.rows[0]?.status ?? "Active";
}
