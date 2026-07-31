import { randomUUID } from "node:crypto";
import { databasePool, persistenceMode, transaction } from "./db";

export const FEATURE_REQUEST_STATUSES = [
  "Planned",
  "In progress",
  "Backlog",
  "Shipped",
] as const;

export type FeatureRequestStatus = (typeof FEATURE_REQUEST_STATUSES)[number];
export type FeatureRequestVoteDirection = "up" | "down";

export interface PublicFeatureRequest {
  id: string;
  title: string;
  description: string;
  status: FeatureRequestStatus;
  votingOpen: boolean;
  upvoteCount: number;
  downvoteCount: number;
  viewerVote: FeatureRequestVoteDirection | null;
  createdAt: string;
}

export interface CreateFeatureRequestInput {
  title: string;
  description: string;
}

export interface FeatureRequestSubmission {
  id: string;
  title: string;
  description: string;
  moderationStatus: "Pending review" | "Rejected";
  createdAt: string;
}

export type FeatureRequestModerationDecision = "publish" | "reject";

export interface FeatureRequestModerationResult {
  requestId: string;
  decision: FeatureRequestModerationDecision;
  request: PublicFeatureRequest | null;
  submission: FeatureRequestSubmission | null;
  replayed: boolean;
}

export interface FeatureRequestModerationContext {
  orgId: string;
  actorId: string;
  actorName: string;
  idempotencyKey: string;
  traceId: string;
}

export interface FeatureRequestRateLimitInput {
  actorHash: string;
  windowStart: Date;
}

interface StoredFeatureRequest extends PublicFeatureRequest {
  moderationStatus: "Pending review" | "Published" | "Rejected";
}

export class FeatureRequestRepositoryError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const globalFeatureRequests = globalThis as typeof globalThis & {
  closespanFeatureRequests?: Map<string, StoredFeatureRequest>;
  closespanFeatureRequestVotes?: Map<
    string,
    Map<string, FeatureRequestVoteDirection>
  >;
  closespanFeatureRequestRateLimits?: Map<string, number>;
  closespanFeatureRequestModerations?: Map<
    string,
    FeatureRequestModerationResult
  >;
};

function memoryRequests(): Map<string, StoredFeatureRequest> {
  globalFeatureRequests.closespanFeatureRequests ??= new Map();
  return globalFeatureRequests.closespanFeatureRequests;
}

function memoryVotes(): Map<string, Map<string, FeatureRequestVoteDirection>> {
  globalFeatureRequests.closespanFeatureRequestVotes ??= new Map();
  return globalFeatureRequests.closespanFeatureRequestVotes;
}

function memoryRequestVotes(
  requestId: string,
): Map<string, FeatureRequestVoteDirection> {
  const existing = memoryVotes().get(requestId);
  if (existing instanceof Map) return existing;

  // Preserve votes created by an older hot-reloaded development process.
  const legacyVotes = existing as unknown as Set<string> | undefined;
  const migrated = new Map<string, FeatureRequestVoteDirection>();
  if (legacyVotes instanceof Set) {
    for (const voterHash of legacyVotes) migrated.set(voterHash, "up");
  }
  memoryVotes().set(requestId, migrated);
  return migrated;
}

function memoryRateLimits(): Map<string, number> {
  globalFeatureRequests.closespanFeatureRequestRateLimits ??= new Map();
  return globalFeatureRequests.closespanFeatureRequestRateLimits;
}

function memoryModerations(): Map<string, FeatureRequestModerationResult> {
  globalFeatureRequests.closespanFeatureRequestModerations ??= new Map();
  return globalFeatureRequests.closespanFeatureRequestModerations;
}

const statusOrder = new Map<FeatureRequestStatus, number>(
  FEATURE_REQUEST_STATUSES.map((status, index) => [status, index]),
);

function compareRequests(
  first: PublicFeatureRequest,
  second: PublicFeatureRequest,
): number {
  const group =
    (statusOrder.get(first.status) ?? 99) -
    (statusOrder.get(second.status) ?? 99);
  if (group !== 0) return group;
  const firstScore = first.upvoteCount - first.downvoteCount;
  const secondScore = second.upvoteCount - second.downvoteCount;
  if (firstScore !== secondScore) return secondScore - firstScore;
  if (first.upvoteCount !== second.upvoteCount)
    return second.upvoteCount - first.upvoteCount;
  return second.createdAt.localeCompare(first.createdAt);
}

function publicMemoryRequest(
  request: StoredFeatureRequest,
  viewerHashForRequest?: (requestId: string) => string,
): PublicFeatureRequest {
  const votes = memoryRequestVotes(request.id);
  const viewerVote = viewerHashForRequest
    ? (votes.get(viewerHashForRequest(request.id)) ?? null)
    : null;
  return {
    id: request.id,
    title: request.title,
    description: request.description,
    status: request.status,
    votingOpen: request.votingOpen,
    upvoteCount: [...votes.values()].filter((vote) => vote === "up").length,
    downvoteCount: [...votes.values()].filter((vote) => vote === "down").length,
    viewerVote,
    createdAt: request.createdAt,
  };
}

export async function listFeatureRequests(
  viewerHashForRequest?: (requestId: string) => string,
): Promise<PublicFeatureRequest[]> {
  if (persistenceMode() === "memory") {
    return [...memoryRequests().values()]
      .filter((request) => request.moderationStatus === "Published")
      .map((request) => publicMemoryRequest(request, viewerHashForRequest))
      .sort(compareRequests);
  }

  const pool = databasePool();
  const result = await pool.query<{
    id: string;
    title: string;
    description: string;
    status: FeatureRequestStatus;
    voting_open: boolean;
    upvote_count: number;
    downvote_count: number;
    created_at: Date | string;
  }>(`SELECT request.id,request.title,request.description,request.status,
       request.voting_open,
       count(vote.request_id) FILTER (WHERE vote.direction='up')::int AS upvote_count,
       count(vote.request_id) FILTER (WHERE vote.direction='down')::int AS downvote_count,
       request.created_at
      FROM feature_requests request
      LEFT JOIN feature_request_votes vote ON vote.request_id=request.id
     WHERE request.moderation_status='Published'
     GROUP BY request.id
     ORDER BY CASE request.status
       WHEN 'Planned' THEN 0 WHEN 'In progress' THEN 1
       WHEN 'Backlog' THEN 2 WHEN 'Shipped' THEN 3 ELSE 99 END,
       (count(vote.request_id) FILTER (WHERE vote.direction='up') -
        count(vote.request_id) FILTER (WHERE vote.direction='down')) DESC,
       count(vote.request_id) FILTER (WHERE vote.direction='up') DESC,
       request.created_at DESC`);

  const viewerVotes = new Map<string, FeatureRequestVoteDirection>();
  if (viewerHashForRequest && result.rows.length > 0) {
    const identities = result.rows.map((row) => ({
      request_id: row.id,
      voter_hash: viewerHashForRequest(row.id),
    }));
    const recordedVotes = await pool.query<{
      request_id: string;
      direction: FeatureRequestVoteDirection;
    }>(
      `SELECT vote.request_id,vote.direction
         FROM feature_request_votes vote
         JOIN jsonb_to_recordset($1::jsonb)
           AS viewer(request_id uuid,voter_hash text)
           ON viewer.request_id=vote.request_id
          AND viewer.voter_hash=vote.voter_hash`,
      [JSON.stringify(identities)],
    );
    for (const row of recordedVotes.rows)
      viewerVotes.set(row.request_id, row.direction);
  }

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    votingOpen: row.voting_open,
    upvoteCount: row.upvote_count,
    downvoteCount: row.downvote_count,
    viewerVote: viewerVotes.get(row.id) ?? null,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function listPendingFeatureRequests(): Promise<
  FeatureRequestSubmission[]
> {
  if (persistenceMode() === "memory") {
    return [...memoryRequests().values()]
      .filter((request) =>
        ["Pending review", "Rejected"].includes(request.moderationStatus),
      )
      .sort((first, second) => first.createdAt.localeCompare(second.createdAt))
      .map((request) => ({
        id: request.id,
        title: request.title,
        description: request.description,
        moderationStatus: request.moderationStatus as
          | "Pending review"
          | "Rejected",
        createdAt: request.createdAt,
      }));
  }

  const result = await databasePool().query<{
    id: string;
    title: string;
    description: string;
    moderation_status: "Pending review" | "Rejected";
    created_at: Date | string;
  }>(`SELECT id,title,description,moderation_status,created_at
        FROM feature_requests
       WHERE moderation_status IN ('Pending review','Rejected')
       ORDER BY CASE moderation_status WHEN 'Pending review' THEN 0 ELSE 1 END,
                created_at ASC`);
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    moderationStatus: row.moderation_status,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function consumeFeatureRequestRateLimit(
  action: "submit" | "vote",
  identity: FeatureRequestRateLimitInput,
  limit: number,
): Promise<void> {
  const key = `${action}:${identity.actorHash}:${identity.windowStart.toISOString()}`;
  if (persistenceMode() === "memory") {
    const next = (memoryRateLimits().get(key) ?? 0) + 1;
    if (next > limit)
      throw new FeatureRequestRepositoryError(
        429,
        action === "submit"
          ? "You can submit up to three requests per hour"
          : "Too many vote attempts. Please try again shortly",
      );
    memoryRateLimits().set(key, next);
    return;
  }

  const result = await databasePool().query<{ request_count: number }>(
    `WITH cleaned AS (
       DELETE FROM feature_request_rate_limits
        WHERE updated_at < now() - interval '2 days'
     ), consumed AS (
       INSERT INTO feature_request_rate_limits(
         action,actor_hash,window_start,request_count,updated_at
       ) VALUES ($1,$2,$3,1,now())
       ON CONFLICT (action,actor_hash,window_start) DO UPDATE
         SET request_count=feature_request_rate_limits.request_count + 1,
             updated_at=now()
         WHERE feature_request_rate_limits.request_count < $4
       RETURNING request_count
     )
     SELECT request_count FROM consumed`,
    [action, identity.actorHash, identity.windowStart, limit],
  );
  if (result.rows.length === 0)
    throw new FeatureRequestRepositoryError(
      429,
      action === "submit"
        ? "You can submit up to three requests per hour"
        : "Too many vote attempts. Please try again shortly",
    );
}

export async function createFeatureRequest(
  input: CreateFeatureRequestInput,
  rateLimitIdentity: FeatureRequestRateLimitInput,
): Promise<FeatureRequestSubmission> {
  const title = input.title.trim();
  const description = input.description.trim();

  await consumeFeatureRequestRateLimit("submit", rateLimitIdentity, 3);

  if (persistenceMode() === "memory") {
    const createdAt = new Date().toISOString();
    const request: StoredFeatureRequest = {
      id: randomUUID(),
      title,
      description,
      status: "Backlog",
      votingOpen: true,
      upvoteCount: 0,
      downvoteCount: 0,
      viewerVote: null,
      createdAt,
      moderationStatus: "Pending review",
    };
    memoryRequests().set(request.id, request);
    return {
      id: request.id,
      title: request.title,
      description: request.description,
      moderationStatus: "Pending review",
      createdAt,
    };
  }

  const id = randomUUID();
  const inserted = await databasePool().query<{
    id: string;
    title: string;
    description: string;
    moderation_status: "Pending review";
    created_at: Date | string;
  }>(`INSERT INTO feature_requests(
        id,title,description,status,voting_open,moderation_status
      ) VALUES ($1,$2,$3,'Backlog',true,'Pending review')
      RETURNING id,title,description,moderation_status,created_at`, [
    id,
    title,
    description,
  ]);
  const row = inserted.rows[0];
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    moderationStatus: row.moderation_status,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function moderationAction(
  requestId: string,
  decision: FeatureRequestModerationDecision,
): string {
  return JSON.stringify({
    type: "feature-request-moderation",
    version: 1,
    requestId,
    decision,
  });
}

function matchingModerationAction(
  value: string,
  requestId: string,
  decision: FeatureRequestModerationDecision,
): boolean {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return (
      parsed.type === "feature-request-moderation" &&
      parsed.version === 1 &&
      parsed.requestId === requestId &&
      parsed.decision === decision
    );
  } catch {
    return false;
  }
}

export async function moderateFeatureRequest(
  requestId: string,
  decision: FeatureRequestModerationDecision,
  context: FeatureRequestModerationContext,
): Promise<FeatureRequestModerationResult> {
  const replayKey = `${context.orgId}:${context.idempotencyKey}`;
  if (persistenceMode() === "memory") {
    const prior = memoryModerations().get(replayKey);
    if (prior) {
      if (prior.requestId !== requestId || prior.decision !== decision)
        throw new FeatureRequestRepositoryError(
          409,
          "This idempotency key was already used for another action",
        );
      return { ...prior, replayed: true };
    }
    const request = memoryRequests().get(requestId);
    if (!request)
      throw new FeatureRequestRepositoryError(404, "Request not found");
    if (request.moderationStatus !== "Pending review")
      throw new FeatureRequestRepositoryError(
        409,
        "This request has already been reviewed",
      );
    request.moderationStatus =
      decision === "publish" ? "Published" : "Rejected";
    if (decision === "reject") request.votingOpen = false;
    const result: FeatureRequestModerationResult = {
      requestId,
      decision,
      request: decision === "publish" ? publicMemoryRequest(request) : null,
      submission:
        decision === "reject"
          ? {
              id: request.id,
              title: request.title,
              description: request.description,
              moderationStatus: "Rejected",
              createdAt: request.createdAt,
            }
          : null,
      replayed: false,
    };
    memoryModerations().set(replayKey, result);
    return result;
  }

  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `${context.orgId}:${context.idempotencyKey}`,
    ]);
    const prior = await client.query<{ action: string }>(
      `SELECT action FROM idempotency_keys WHERE org_id=$1 AND key=$2`,
      [context.orgId, context.idempotencyKey],
    );
    if (prior.rows[0]) {
      if (!matchingModerationAction(prior.rows[0].action, requestId, decision))
        throw new FeatureRequestRepositoryError(
          409,
          "This idempotency key was already used for another action",
        );
      const replay = await client.query<{
        id: string;
        title: string;
        description: string;
        status: FeatureRequestStatus;
        voting_open: boolean;
        upvote_count: number;
        downvote_count: number;
        created_at: Date | string;
      }>(`SELECT request.id,request.title,request.description,request.status,
            request.voting_open,
            count(vote.request_id) FILTER (WHERE vote.direction='up')::int AS upvote_count,
            count(vote.request_id) FILTER (WHERE vote.direction='down')::int AS downvote_count,
            request.created_at
           FROM feature_requests request
           LEFT JOIN feature_request_votes vote ON vote.request_id=request.id
          WHERE request.id=$1 AND request.moderation_status='Published'
          GROUP BY request.id`, [requestId]);
      const row = replay.rows[0];
      return {
        requestId,
        decision,
        request: row
          ? {
              id: row.id,
              title: row.title,
              description: row.description,
              status: row.status,
              votingOpen: row.voting_open,
              upvoteCount: row.upvote_count,
              downvoteCount: row.downvote_count,
              viewerVote: null,
              createdAt: new Date(row.created_at).toISOString(),
            }
          : null,
        submission: null,
        replayed: true,
      };
    }

    const target = await client.query<{
      id: string;
      title: string;
      description: string;
      status: FeatureRequestStatus;
      voting_open: boolean;
      moderation_status: "Pending review" | "Published" | "Rejected";
      created_at: Date | string;
    }>(`SELECT id,title,description,status,voting_open,moderation_status,created_at
          FROM feature_requests WHERE id=$1 FOR UPDATE`, [requestId]);
    const row = target.rows[0];
    if (!row)
      throw new FeatureRequestRepositoryError(404, "Request not found");
    if (row.moderation_status !== "Pending review")
      throw new FeatureRequestRepositoryError(
        409,
        "This request has already been reviewed",
      );

    await client.query(
      `UPDATE feature_requests
          SET moderation_status=$2,
              voting_open=CASE WHEN $2='Rejected' THEN false ELSE voting_open END,
              updated_at=now()
        WHERE id=$1`,
      [requestId, decision === "publish" ? "Published" : "Rejected"],
    );
    await client.query(
      `INSERT INTO idempotency_keys(org_id,key,action) VALUES($1,$2,$3)`,
      [context.orgId, context.idempotencyKey, moderationAction(requestId, decision)],
    );
    await client.query(
      `INSERT INTO audit_events(
         id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
       ) VALUES($1,$2,$3,$4,$5,'FeatureRequest',$6,$7)`,
      [
        randomUUID(),
        context.orgId,
        context.actorId,
        context.actorName,
        decision === "publish"
          ? `Published feature request ${requestId}`
          : `Rejected feature request ${requestId}`,
        requestId,
        context.traceId,
      ],
    );
    return {
      requestId,
      decision,
      request:
        decision === "publish"
          ? {
              id: row.id,
              title: row.title,
              description: row.description,
              status: row.status,
              votingOpen: row.voting_open,
              upvoteCount: 0,
              downvoteCount: 0,
              viewerVote: null,
              createdAt: new Date(row.created_at).toISOString(),
            }
          : null,
      submission:
        decision === "reject"
          ? {
              id: row.id,
              title: row.title,
              description: row.description,
              moderationStatus: "Rejected",
              createdAt: new Date(row.created_at).toISOString(),
            }
          : null,
      replayed: false,
    };
  });
}

export async function voteForFeatureRequest(
  requestId: string,
  voterHash: string,
  direction: FeatureRequestVoteDirection,
): Promise<{
  requestId: string;
  upvoteCount: number;
  downvoteCount: number;
  viewerVote: FeatureRequestVoteDirection;
  recorded: boolean;
  changed: boolean;
}> {
  if (persistenceMode() === "memory") {
    const request = memoryRequests().get(requestId);
    if (!request || request.moderationStatus !== "Published")
      throw new FeatureRequestRepositoryError(404, "Request not found");
    if (!request.votingOpen)
      throw new FeatureRequestRepositoryError(409, "Voting is closed");
    const votes = memoryRequestVotes(requestId);
    const previous = votes.get(voterHash);
    votes.set(voterHash, direction);
    memoryVotes().set(requestId, votes);
    return {
      requestId,
      upvoteCount: [...votes.values()].filter((vote) => vote === "up").length,
      downvoteCount: [...votes.values()].filter((vote) => vote === "down").length,
      viewerVote: direction,
      recorded: previous === undefined,
      changed: previous !== undefined && previous !== direction,
    };
  }

  return transaction(async (client) => {
    const target = await client.query<{ voting_open: boolean }>(
      `SELECT voting_open FROM feature_requests
        WHERE id=$1 AND moderation_status='Published'
        FOR UPDATE`,
      [requestId],
    );
    const request = target.rows[0];
    if (!request)
      throw new FeatureRequestRepositoryError(404, "Request not found");
    if (!request.voting_open)
      throw new FeatureRequestRepositoryError(409, "Voting is closed");

    const prior = await client.query<{
      direction: FeatureRequestVoteDirection;
    }>(
      `SELECT direction FROM feature_request_votes
        WHERE request_id=$1 AND voter_hash=$2`,
      [requestId, voterHash],
    );
    const previous = prior.rows[0]?.direction;
    await client.query(
      `INSERT INTO feature_request_votes(request_id,voter_hash,direction)
       VALUES ($1,$2,$3)
       ON CONFLICT (request_id,voter_hash) DO UPDATE
         SET direction=EXCLUDED.direction,
             created_at=now()`,
      [requestId, voterHash, direction],
    );
    const count = await client.query<{
      upvote_count: number;
      downvote_count: number;
    }>(
      `SELECT
         count(*) FILTER (WHERE direction='up')::int AS upvote_count,
         count(*) FILTER (WHERE direction='down')::int AS downvote_count
         FROM feature_request_votes WHERE request_id=$1`,
      [requestId],
    );
    return {
      requestId,
      upvoteCount: count.rows[0]?.upvote_count ?? 0,
      downvoteCount: count.rows[0]?.downvote_count ?? 0,
      viewerVote: direction,
      recorded: previous === undefined,
      changed: previous !== undefined && previous !== direction,
    };
  });
}

export function resetFeatureRequestStoreForTests(): void {
  globalFeatureRequests.closespanFeatureRequests = new Map();
  globalFeatureRequests.closespanFeatureRequestVotes = new Map();
  globalFeatureRequests.closespanFeatureRequestRateLimits = new Map();
  globalFeatureRequests.closespanFeatureRequestModerations = new Map();
}

export function publishFeatureRequestForTests(requestId: string): void {
  const request = memoryRequests().get(requestId);
  if (!request) throw new Error("Feature request not found");
  request.moderationStatus = "Published";
}
