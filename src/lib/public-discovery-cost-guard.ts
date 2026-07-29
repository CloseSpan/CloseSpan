import { transaction } from "./db";
import { workspacePersistenceMode } from "./workspace-persistence";

export type PublicDiscoveryClaimResult =
  | "claimed"
  | "duplicate"
  | "rate_limited";

interface PublicDiscoveryClaim {
  orgId: string;
  actorId: string;
  idempotencyKey: string;
  now?: Date;
}

interface MemoryClaim {
  orgId: string;
  action: string;
  createdAt: number;
}

const MAX_CLAIMS_PER_MINUTE = 5;
const CLAIM_WINDOW_MS = 60_000;
const ACTION_PREFIX = "public_feedback_discovery:";
const memoryClaims = new Map<string, MemoryClaim>();

function actionFor(actorId: string): string {
  return `${ACTION_PREFIX}${actorId}`;
}

function memoryClaim(input: PublicDiscoveryClaim): PublicDiscoveryClaimResult {
  const key = JSON.stringify([input.orgId, input.idempotencyKey]);
  if (memoryClaims.has(key)) return "duplicate";

  const action = actionFor(input.actorId);
  const now = (input.now ?? new Date()).getTime();
  let recentClaims = 0;
  for (const claim of memoryClaims.values()) {
    if (
      claim.orgId === input.orgId &&
      claim.action === action &&
      claim.createdAt >= now - CLAIM_WINDOW_MS
    ) {
      recentClaims += 1;
    }
  }
  if (recentClaims >= MAX_CLAIMS_PER_MINUTE) return "rate_limited";

  memoryClaims.set(key, { orgId: input.orgId, action, createdAt: now });
  return "claimed";
}

async function postgresClaim(
  input: PublicDiscoveryClaim,
): Promise<PublicDiscoveryClaimResult> {
  const action = actionFor(input.actorId);
  return transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`${input.orgId}:${input.actorId}`],
    );

    const prior = await client.query(
      "SELECT 1 FROM idempotency_keys WHERE org_id=$1 AND key=$2",
      [input.orgId, input.idempotencyKey],
    );
    if (prior.rowCount) return "duplicate";

    const recent = input.now
      ? await client.query<{ count: number }>(
          `SELECT count(*)::int AS count
             FROM idempotency_keys
            WHERE org_id=$1
              AND action=$2
              AND created_at >= $3::timestamptz - interval '1 minute'`,
          [input.orgId, action, input.now.toISOString()],
        )
      : await client.query<{ count: number }>(
          `SELECT count(*)::int AS count
             FROM idempotency_keys
            WHERE org_id=$1
              AND action=$2
              AND created_at >= clock_timestamp() - interval '1 minute'`,
          [input.orgId, action],
        );
    if ((recent.rows[0]?.count ?? 0) >= MAX_CLAIMS_PER_MINUTE) {
      return "rate_limited";
    }

    const inserted = input.now
      ? await client.query(
          `INSERT INTO idempotency_keys(org_id,key,action,created_at)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (org_id,key) DO NOTHING`,
          [input.orgId, input.idempotencyKey, action, input.now.toISOString()],
        )
      : await client.query(
          `INSERT INTO idempotency_keys(org_id,key,action)
           VALUES ($1,$2,$3)
           ON CONFLICT (org_id,key) DO NOTHING`,
          [input.orgId, input.idempotencyKey, action],
        );
    return inserted.rowCount ? "claimed" : "duplicate";
  });
}

/**
 * Atomically claims one paid public-discovery request. PostgreSQL is the
 * production coordination point; the in-memory implementation exists for
 * local/demo mode and deterministic unit tests.
 */
export async function claimPublicDiscoveryRequest(
  input: PublicDiscoveryClaim,
): Promise<PublicDiscoveryClaimResult> {
  return workspacePersistenceMode(input.orgId) === "postgres"
    ? postgresClaim(input)
    : memoryClaim(input);
}

export function resetPublicDiscoveryCostGuardForTests(): void {
  if (process.env.NODE_ENV === "test") memoryClaims.clear();
}
