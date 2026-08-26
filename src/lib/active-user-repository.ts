import { databasePool, persistenceMode } from "./db";
import { normalizeMembershipEmail } from "./organization-repository";

let activitySchemaPromise: Promise<void> | null = null;

export interface ActivePlatformUser {
  email: string;
  displayName: string;
  signInCount: number;
  firstJoinedAt: Date;
  lastSignedInAt: Date;
  organizations: Array<{
    id: string;
    name: string;
    role: string;
  }>;
}

function ensureActivitySchema(): Promise<void> {
  activitySchemaPromise ??= databasePool()
    .query(
      `CREATE TABLE IF NOT EXISTS platform_user_activity (
         email text PRIMARY KEY,
         display_name text,
         sign_in_count integer NOT NULL DEFAULT 1 CHECK (sign_in_count > 0),
         first_signed_in_at timestamptz NOT NULL DEFAULT now(),
         last_signed_in_at timestamptz NOT NULL DEFAULT now(),
         CHECK (char_length(email) BETWEEN 3 AND 320),
         CHECK (email = lower(btrim(email))),
         CHECK (position('@' in email) > 1),
         CHECK (
           display_name IS NULL
           OR char_length(btrim(display_name)) BETWEEN 1 AND 160
         )
       );
       CREATE INDEX IF NOT EXISTS platform_user_activity_last_sign_in_idx
         ON platform_user_activity(last_signed_in_at DESC);`,
    )
    .then(() => undefined)
    .catch((error: unknown) => {
      activitySchemaPromise = null;
      throw error;
    });
  return activitySchemaPromise;
}

function optionalDisplayName(name?: string | null): string | null {
  const trimmed = name?.trim() ?? "";
  return trimmed ? trimmed.slice(0, 160) : null;
}

export async function recordPlatformUserSignIn(
  email: string,
  displayName?: string | null,
): Promise<void> {
  if (persistenceMode() !== "postgres") return;
  const normalizedEmail = normalizeMembershipEmail(email);
  if (!normalizedEmail || !normalizedEmail.includes("@"))
    throw new Error("A valid verified email is required to record a sign-in");

  await ensureActivitySchema();
  await databasePool().query(
    `INSERT INTO platform_user_activity(
       email,display_name,sign_in_count,first_signed_in_at,last_signed_in_at
     ) VALUES($1,$2,1,now(),now())
     ON CONFLICT(email) DO UPDATE SET
       display_name=COALESCE(
         NULLIF(btrim(EXCLUDED.display_name),''),
         platform_user_activity.display_name
       ),
       sign_in_count=platform_user_activity.sign_in_count+1,
       last_signed_in_at=now()`,
    [normalizedEmail, optionalDisplayName(displayName)],
  );
}

export async function listActivePlatformUsers(): Promise<ActivePlatformUser[]> {
  if (persistenceMode() !== "postgres") return [];
  await ensureActivitySchema();

  const [memberships, activity] = await Promise.all([
    databasePool().query<{
      email: string;
      display_name: string;
      role: string;
      organization_id: string;
      organization_name: string;
      organization_created_at: Date;
    }>(
      `SELECT member.email,member.display_name,member.role,
              organization.id AS organization_id,
              organization.name AS organization_name,
              organization.created_at AS organization_created_at
         FROM workspace_members member
         JOIN organizations organization ON organization.id=member.org_id
        ORDER BY organization.created_at DESC,organization.id,member.id`,
    ),
    databasePool().query<{
      email: string;
      display_name: string | null;
      sign_in_count: number;
      first_signed_in_at: Date;
      last_signed_in_at: Date;
    }>(
      `SELECT email,display_name,sign_in_count,
              first_signed_in_at,last_signed_in_at
         FROM platform_user_activity`,
    ),
  ]);

  const activityByEmail = new Map(
    activity.rows.map((row) => [normalizeMembershipEmail(row.email), row]),
  );
  const users = new Map<string, ActivePlatformUser>();

  for (const membership of memberships.rows) {
    const email = normalizeMembershipEmail(membership.email);
    const signIn = activityByEmail.get(email);
    const joinedAt = new Date(membership.organization_created_at);
    const existing = users.get(email);
    const organization = {
      id: membership.organization_id,
      name: membership.organization_name,
      role: membership.role,
    };

    if (existing) {
      if (!existing.organizations.some(({ id }) => id === organization.id))
        existing.organizations.push(organization);
      if (joinedAt < existing.firstJoinedAt) existing.firstJoinedAt = joinedAt;
      continue;
    }

    users.set(email, {
      email,
      displayName:
        signIn?.display_name?.trim() || membership.display_name || email,
      signInCount: signIn?.sign_in_count ?? 0,
      firstJoinedAt: joinedAt,
      lastSignedInAt: new Date(signIn?.last_signed_in_at ?? joinedAt),
      organizations: [organization],
    });
  }

  return [...users.values()].sort(
    (left, right) =>
      right.lastSignedInAt.getTime() - left.lastSignedInAt.getTime(),
  );
}
