import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { databasePool, transaction } from "./db";
import { HttpError, type RequestContext } from "./request-security";
import { workspacePersistenceMode } from "./workspace-persistence";
import { problemReviewDecisionSchema, reviewDecisionIssue, type ProblemPromptReview, type ProblemPromptReviewStatus } from "./problem-prompt-review";
import { automaticCodingBudgetAllowsExecution } from "./autonomy-policy";
import { ticketReadiness, type ImplementationPromptSnapshot } from "./engineering-prompt";
import {
  AUTOMATIC_PROMPT_POLICY, AUTOMATIC_PROMPT_ACTIVATION_ACTION, MAX_PROMPT_REVIEW_EVALUATIONS,
  automaticPromptAcceptanceSql, type AutomaticPromptAcceptance,
} from "./automatic-prompt-acceptance";

export interface ReviewRow {
  org_id: string;
  problem_id: string;
  status: ProblemPromptReviewStatus;
  version: number;
  prompt_hash: string | null;
  user_story: string;
  feedback: string;
  evaluation: (NonNullable<ProblemPromptReview["result"]> & { policyAcceptance?: AutomaticPromptAcceptance }) | null;
  attempts: number;
  failure_message: string | null;
  confirmed_at: Date | null;
  updated_at: Date;
  lease_id: string | null;
}

export function reviewFromRow(row: ReviewRow): ProblemPromptReview {
  return {
    status: row.status, version: row.version, promptHash: row.prompt_hash,
    userStory: row.user_story, feedback: row.feedback, result: row.evaluation ? {
      verdict: row.evaluation.verdict, summary: row.evaluation.summary, changes: row.evaluation.changes,
    } : null,
    failureMessage: row.failure_message, confirmedAt: row.confirmed_at?.toISOString() ?? null,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function readProblemPromptReview(orgId: string, problemId: string) {
  if (workspacePersistenceMode(orgId) !== "postgres") return null;
  const result = await databasePool().query<ReviewRow>(
    "SELECT * FROM problem_prompt_reviews WHERE org_id=$1 AND problem_id=$2", [orgId, problemId],
  );
  return result.rows[0] ? reviewFromRow(result.rows[0]) : null;
}

export async function readAutomaticPromptReviewActivation(orgId: string) {
  const result = await databasePool().query<{ id: string; occurred_at: Date }>(
    `SELECT activation.id,activation.occurred_at FROM audit_events activation
     JOIN workspace_settings settings ON settings.org_id=activation.org_id
     WHERE activation.org_id=$1 AND activation.entity_type='WorkspaceSettings'
       AND activation.entity_id=$1 AND activation.action=$2 AND settings.autonomy_level=$3
     ORDER BY activation.occurred_at DESC,activation.id DESC LIMIT 1`,
    [orgId, AUTOMATIC_PROMPT_ACTIVATION_ACTION, AUTOMATIC_PROMPT_POLICY],
  );
  return result.rows[0] ?? null;
}

/** Recheck the separate receipt before every continuation that can start paid work. */
export async function automaticPromptReviewAcceptanceIsCurrent(row: ReviewRow): Promise<boolean> {
  const result = await databasePool().query(
    `SELECT 1 FROM problem_prompt_reviews review
     JOIN LATERAL (SELECT p.content_hash,p.created_at FROM implementation_prompts p
       WHERE p.org_id=review.org_id AND p.problem_id=review.problem_id AND p.status <> 'Superseded'
       ORDER BY p.revision DESC LIMIT 1) prompt ON true
     WHERE review.org_id=$1 AND review.problem_id=$2 AND review.lease_id=$3 AND review.version=$4
       AND review.leased_at > now()-interval '15 minutes'
       AND ${automaticPromptAcceptanceSql("review", "prompt.content_hash")}`,
    [row.org_id, row.problem_id, row.lease_id, row.version],
  );
  return Boolean(result.rowCount);
}

/** Accept only a complete exact-version result, with a distinct policy audit receipt. */
export async function acceptProblemPromptReviewByPolicy(row: ReviewRow, input: {
  promptHash: string; userStory: string; evaluation: NonNullable<ProblemPromptReview["result"]>; attempts: number;
}): Promise<boolean> {
  const leaseId = row.lease_id;
  if (!leaseId || input.evaluation.verdict !== "Passed" || input.evaluation.changes.length
    || !input.userStory.trim() || !Number.isInteger(input.attempts)
    || input.attempts < 1 || input.attempts > MAX_PROMPT_REVIEW_EVALUATIONS) return false;
  return transaction(async (client) => {
    const settings = await client.query<{ autonomy_level: string; monthly_model_budget: number; used_model_cost: number; hard_stop: boolean }>(
      "SELECT autonomy_level,monthly_model_budget,used_model_cost,hard_stop FROM workspace_settings WHERE org_id=$1 FOR UPDATE", [row.org_id],
    );
    if (settings.rows[0]?.autonomy_level !== AUTOMATIC_PROMPT_POLICY
      || !automaticCodingBudgetAllowsExecution(settings.rows[0])) return false;
    const activation = await client.query<{ id: string; occurred_at: Date }>(
      `SELECT id,occurred_at FROM audit_events WHERE org_id=$1 AND entity_type='WorkspaceSettings'
       AND entity_id=$1 AND action=$2 ORDER BY occurred_at DESC,id DESC LIMIT 1`,
      [row.org_id, AUTOMATIC_PROMPT_ACTIVATION_ACTION],
    );
    if (!activation.rows[0]) return false;
    const current = await client.query<ReviewRow>(
      `SELECT * FROM problem_prompt_reviews WHERE org_id=$1 AND problem_id=$2
       AND lease_id=$3 AND version=$4 AND leased_at > now()-interval '15 minutes' FOR UPDATE`,
      [row.org_id, row.problem_id, row.lease_id, row.version],
    );
    if (!current.rows[0] || !["Queued", "Waiting for verification", "Testing", "Ready"].includes(current.rows[0].status)) return false;
    const prompt = await client.query<{ content_hash: string; status: string; structured_snapshot: ImplementationPromptSnapshot; created_at: Date }>(
      `SELECT content_hash,status,structured_snapshot,created_at FROM implementation_prompts
       WHERE org_id=$1 AND problem_id=$2 AND status <> 'Superseded'
       ORDER BY revision DESC LIMIT 1 FOR SHARE`, [row.org_id, row.problem_id],
    );
    const latest = prompt.rows[0];
    const promptTime = latest ? new Date(latest.created_at).getTime() : NaN;
    const activatedTime = new Date(activation.rows[0].occurred_at).getTime();
    if (!latest || latest.status !== "Ready" || latest.content_hash !== input.promptHash
      || !Number.isFinite(promptTime) || !Number.isFinite(activatedTime) || promptTime < activatedTime) return false;
    if (!ticketReadiness(latest.structured_snapshot?.ticket).ready
      || !Array.isArray(latest.structured_snapshot?.evidence?.missingInformation)
      || latest.structured_snapshot.evidence.missingInformation.length) {
      throw new Error("The expected behavior still has missing or ambiguous information. Administrator review is needed.");
    }
    const acceptance: AutomaticPromptAcceptance = {
      kind: "automatic_prompt_acceptance", policy: AUTOMATIC_PROMPT_POLICY, receiptId: randomUUID(),
      activationId: activation.rows[0].id, promptHash: input.promptHash, userStory: input.userStory,
      reviewVersion: row.version + 1, leaseId,
    };
    // Keep the audit's JSON text canonical so it can be compared without parsing arbitrary audit actions.
    await client.query(
      `INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id)
       VALUES($1,$2,'agent_prompt_review','CloseSpan Prompt Agent',($3::jsonb)::text,'ProblemPromptPolicyAcceptance',$4,$5)`,
      [acceptance.receiptId, row.org_id, JSON.stringify(acceptance), row.problem_id, row.lease_id],
    );
    await client.query(
      `UPDATE problem_prompt_reviews SET status='Preparing tests',prompt_hash=$3,user_story=$4,
       evaluation=$5,attempts=$6,confirmed_by=NULL,confirmed_at=NULL,failure_message=NULL,
       lease_id=NULL,leased_at=NULL,version=version+1,updated_at=now()
       WHERE org_id=$1 AND problem_id=$2`,
      [row.org_id, row.problem_id, input.promptHash, input.userStory,
        JSON.stringify({ ...input.evaluation, policyAcceptance: acceptance }), input.attempts],
    );
    return true;
  });
}

/** A read-only inbox: stale prompt checks never become actionable reviews. */
export async function listProblemReviewInbox(orgId: string): Promise<Array<{ problemId: string; needsHelp: boolean }>> {
  if (workspacePersistenceMode(orgId) !== "postgres") return [];
  const result = await databasePool().query<{ problem_id: string; status: string }>(
    `SELECT r.problem_id,r.status FROM problem_prompt_reviews r
     JOIN product_problems p ON p.org_id=r.org_id AND p.id=r.problem_id
     WHERE r.org_id=$1 AND p.stage NOT IN ('Closed','Released') AND (
       r.status='Needs attention' OR (
         r.status='Ready' AND r.confirmed_at IS NULL AND r.evaluation->>'verdict'='Passed'
         AND r.prompt_hash=(SELECT i.content_hash FROM implementation_prompts i
           WHERE i.org_id=r.org_id AND i.problem_id=r.problem_id AND i.status <> 'Superseded'
           ORDER BY i.revision DESC LIMIT 1)
         AND NOT EXISTS (SELECT 1 FROM approval_requests a
           WHERE a.org_id=r.org_id AND a.problem_id=r.problem_id AND a.status IN ('Pending','Approved'))
       )) ORDER BY r.updated_at,r.problem_id`, [orgId],
  );
  return result.rows.map((row) => ({ problemId: row.problem_id, needsHelp: row.status === "Needs attention" }));
}

export async function recordProblemReviewDecision(context: RequestContext, problemId: string, body: unknown) {
  const parsed = problemReviewDecisionSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid review decision.");
  if (workspacePersistenceMode(context.orgId) !== "postgres") throw new HttpError(409, "Reviews require a persistent workspace.");
  const input = parsed.data;
  return transaction(async (client) => {
    const current = await client.query<ReviewRow>(
      "SELECT * FROM problem_prompt_reviews WHERE org_id=$1 AND problem_id=$2 FOR UPDATE",
      [context.orgId, problemId],
    );
    const row = current.rows[0];
    if (!row) throw new HttpError(404, "Prompt review not found.");
    const prompt = await client.query<{ content_hash: string; status: string }>(
      `SELECT content_hash,status FROM implementation_prompts
       WHERE org_id=$1 AND problem_id=$2 AND status <> 'Superseded'
       ORDER BY revision DESC LIMIT 1 FOR UPDATE`, [context.orgId, problemId],
    );
    const issue = reviewDecisionIssue({
      review: reviewFromRow(row), version: input.version, promptHash: input.promptHash,
      currentPromptHash: prompt.rows[0]?.content_hash ?? null,
      executionStarted: ["Awaiting approval", "Approved"].includes(prompt.rows[0]?.status ?? ""),
    });
    if (issue) throw new HttpError(409, issue);
    if (input.decision === "changes" && `${row.user_story}\n\nRequested changes: ${input.feedback}`.length > 2000) {
      throw new HttpError(400, "Keep the requested change shorter so it fits the test scenario.");
    }
    const updated = await client.query<ReviewRow>(
      `UPDATE problem_prompt_reviews SET status=$3,version=version+1,feedback=$4,
       user_story=$5,confirmed_by=$6,confirmed_at=CASE WHEN $3='Confirmed' THEN now() ELSE NULL END,
       attempts=0,failure_message=NULL,updated_at=now()
       WHERE org_id=$1 AND problem_id=$2 RETURNING *`,
      [context.orgId, problemId, input.decision === "confirm" ? "Confirmed" : "Testing", input.feedback,
        input.decision === "changes" ? `${row.user_story}\n\nRequested changes: ${input.feedback}` : row.user_story,
        input.decision === "confirm" ? context.actorId : null],
    );
    await reviewAudit(client, context.orgId, problemId, context.actorId, context.actorName,
      JSON.stringify({ decision: input.decision, version: input.version, promptHash: input.promptHash, feedback: input.feedback }), context.traceId);
    return reviewFromRow(updated.rows[0]);
  });
}

export async function reviewAudit(client: Pick<PoolClient, "query">, orgId: string, problemId: string,
  actorId: string, actorName: string, action: string, traceId: string) {
  await client.query(`INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id)
    VALUES($1,$2,$3,$4,$5,'ProblemPromptReview',$6,$7)`,
  [randomUUID(), orgId, actorId, actorName, action, problemId, traceId]);
}

/** One durable claim per tick. Expired work is blocked, never silently retried. */
export async function claimProblemPromptReview(orgId: string, automaticEnabledAt: Date | null = null): Promise<ReviewRow | null> {
  return transaction(async (client) => {
    await client.query(`UPDATE problem_prompt_reviews SET status='Needs attention',
      failure_message='Background testing stopped before completing. An administrator needs to check the worker.',
      lease_id=NULL,leased_at=NULL,version=version+1,updated_at=now()
      WHERE org_id=$1 AND leased_at < now()-interval '15 minutes'`, [orgId]);
    await client.query(`INSERT INTO problem_prompt_reviews(org_id,problem_id)
      SELECT p.org_id,p.id FROM product_problems p
      WHERE p.org_id=$1 AND p.stage IN ('Detected','Needs review')
        AND EXISTS (SELECT 1 FROM feedback_cluster_memberships m WHERE m.org_id=p.org_id AND m.problem_id=p.id)
        AND NOT EXISTS (SELECT 1 FROM approval_requests a WHERE a.org_id=p.org_id AND a.problem_id=p.id AND a.status IN ('Pending','Approved'))
      ON CONFLICT DO NOTHING`, [orgId]);
    // A manually replaced prompt invalidates the old domain decision too.
    await client.query(`UPDATE problem_prompt_reviews r SET status='Testing',version=version+1,
      attempts=0,confirmed_by=NULL,confirmed_at=NULL,evaluation=NULL,failure_message=NULL,updated_at=now()
      WHERE r.org_id=$1 AND r.lease_id IS NULL AND r.status IN ('Ready','Confirmed','Awaiting approval')
        AND EXISTS (SELECT 1 FROM implementation_prompts p WHERE p.org_id=r.org_id
          AND p.problem_id=r.problem_id AND p.status IN ('Draft','Ready') AND p.content_hash IS DISTINCT FROM r.prompt_hash)
        AND NOT EXISTS (SELECT 1 FROM approval_requests a WHERE a.org_id=r.org_id AND a.problem_id=r.problem_id AND a.status IN ('Pending','Approved'))`, [orgId]);
    const candidate = await client.query<ReviewRow>(`SELECT review.* FROM problem_prompt_reviews review
      JOIN product_problems p ON p.org_id=review.org_id AND p.id=review.problem_id
      WHERE review.org_id=$1 AND p.stage NOT IN ('Closed','Released') AND review.lease_id IS NULL
      AND (review.status IN ('Queued','Waiting for verification','Testing','Confirmed','Preparing tests')
        OR ($2::timestamptz IS NOT NULL AND review.status='Ready'))
      AND ($2::timestamptz IS NULL
        OR (review.confirmed_at IS NOT NULL AND review.status IN ('Confirmed','Preparing tests'))
        OR NOT EXISTS (SELECT 1 FROM implementation_prompts old_prompt
        WHERE old_prompt.org_id=review.org_id AND old_prompt.problem_id=review.problem_id AND old_prompt.status <> 'Superseded')
        OR (SELECT current_prompt.created_at FROM implementation_prompts current_prompt
          WHERE current_prompt.org_id=review.org_id AND current_prompt.problem_id=review.problem_id
            AND current_prompt.status <> 'Superseded' ORDER BY current_prompt.revision DESC LIMIT 1) >= $2::timestamptz)
      ORDER BY review.updated_at,review.problem_id LIMIT 1 FOR UPDATE OF review SKIP LOCKED`, [orgId, automaticEnabledAt]);
    if (!candidate.rows[0]) return null;
    const updated = await client.query<ReviewRow>(`UPDATE problem_prompt_reviews SET lease_id=$3,leased_at=now()
      WHERE org_id=$1 AND problem_id=$2 RETURNING *`, [orgId, candidate.rows[0].problem_id, randomUUID()]);
    return updated.rows[0];
  });
}

export async function finishProblemPromptReview(row: ReviewRow, update: {
  status: ProblemPromptReviewStatus; promptHash?: string | null; userStory?: string;
  evaluation?: ProblemPromptReview["result"]; attempts?: number; failureMessage?: string | null;
}) {
  await transaction(async (client) => {
    const result = await client.query(`UPDATE problem_prompt_reviews SET status=$4,prompt_hash=$5,user_story=$6,
      evaluation=$7,attempts=$8,failure_message=$9,lease_id=NULL,leased_at=NULL,version=version+1,updated_at=now()
      WHERE org_id=$1 AND problem_id=$2 AND lease_id=$3
        AND leased_at > now()-interval '15 minutes' RETURNING problem_id`,
    [row.org_id,row.problem_id,row.lease_id,update.status,update.promptHash ?? row.prompt_hash,
      update.userStory ?? row.user_story,JSON.stringify(update.evaluation ?? row.evaluation),
      update.attempts ?? row.attempts,update.failureMessage ?? null]);
    if (result.rowCount) await reviewAudit(client,row.org_id,row.problem_id,"agent_prompt_review","CloseSpan Prompt Agent",
      JSON.stringify({ status: update.status, promptHash: update.promptHash ?? row.prompt_hash, evaluation: update.evaluation, failure: update.failureMessage }),row.lease_id!);
  });
}

export async function retryProblemPromptReview(context: RequestContext, problemId: string, version: number) {
  if (context.role !== "Admin") throw new HttpError(403, "Administrator permission is required.");
  return transaction(async (client) => {
    const updated = await client.query(`UPDATE problem_prompt_reviews r SET status='Queued',version=version+1,
      attempts=0,failure_message=NULL,evaluation=NULL,confirmed_by=NULL,confirmed_at=NULL,lease_id=NULL,leased_at=NULL,updated_at=now()
      WHERE r.org_id=$1 AND r.problem_id=$2 AND r.version=$3 AND r.status='Needs attention' AND r.lease_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM approval_requests a WHERE a.org_id=r.org_id AND a.problem_id=r.problem_id AND a.status IN ('Pending','Approved'))
      RETURNING problem_id`, [context.orgId, problemId, version]);
    if (!updated.rowCount) throw new HttpError(409, "The workflow changed or already has an execution approval. Refresh its diagnostics.");
    await reviewAudit(client,context.orgId,problemId,context.actorId,context.actorName,"Requested one new bounded background preparation attempt",context.traceId);
  });
}

export async function reviewLeaseIsCurrent(row: ReviewRow): Promise<boolean> {
  const result = await databasePool().query(`SELECT 1 FROM problem_prompt_reviews
    WHERE org_id=$1 AND problem_id=$2 AND lease_id=$3 AND leased_at > now()-interval '15 minutes'`,
  [row.org_id,row.problem_id,row.lease_id]);
  return Boolean(result.rowCount);
}
