import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { databasePool, transaction } from "./db";
import { HttpError, type RequestContext } from "./request-security";
import { workspacePersistenceMode } from "./workspace-persistence";
import {
  domainResultReworkEnabled, issueResultReviewSchema, resultBindingMatches, resultReworkRecommendation,
  type IssueResultBinding, type IssueResultDecision, type IssueResultReviewState,
} from "./issue-result-review";

type Database = Pick<Pool | PoolClient, "query">;

interface ResultRow {
  id: string;
  status: string;
  prompt_hash: string;
  prompt_revision_id: string;
  implementation_commit_sha: string | null;
  current_prompt_hash: string | null;
  current_prompt_id: string | null;
  coding_approval_status: string;
  coding_approval_hash: string;
  problem_stage: string;
}

interface DecisionRow {
  id: string;
  run_id: string;
  commit_sha: string;
  prompt_hash: string;
  version: number;
  decision: "accept" | "changes";
  feedback: string;
  actor_name: string;
  created_at: Date;
  request_hash: string;
}

/** Probe before querying so older installations remain readable until migration. */
export async function issueResultReviewStorageReady(db: Database): Promise<boolean> {
  const result = await db.query<{ ready: boolean }>("SELECT to_regclass('public.issue_result_reviews') IS NOT NULL AS ready");
  return result.rows[0]?.ready === true;
}

export async function issueResultReworkStorageReady(db: Database): Promise<boolean> {
  const result = await db.query<{ ready: boolean }>("SELECT to_regclass('public.issue_result_rework_requests') IS NOT NULL AS ready");
  return result.rows[0]?.ready === true;
}

async function latestResult(db: Database, orgId: string, problemId: string, lock = false): Promise<ResultRow | null> {
  const result = await db.query<ResultRow>(
    `SELECT run.id,run.status,run.prompt_hash,run.prompt_revision_id,run.implementation_commit_sha,
            prompt.content_hash AS current_prompt_hash,prompt.id AS current_prompt_id,
            coding.status AS coding_approval_status,coding.prompt_hash AS coding_approval_hash,problem.stage AS problem_stage
       FROM agent_runs run
       JOIN product_problems problem ON problem.org_id=run.org_id AND problem.id=run.problem_id
       JOIN approval_requests coding ON coding.org_id=run.org_id AND coding.id=run.approval_id
         AND coding.problem_id=run.problem_id AND coding.action_type='agent_run'
       LEFT JOIN LATERAL (SELECT id,content_hash FROM implementation_prompts
         WHERE org_id=run.org_id AND problem_id=run.problem_id AND status <> 'Superseded'
         ORDER BY revision DESC LIMIT 1) prompt ON true
      WHERE run.org_id=$1 AND run.problem_id=$2
      ORDER BY run.queued_at DESC,run.id DESC LIMIT 1${lock ? " FOR UPDATE OF run" : ""}`,
    [orgId, problemId],
  );
  const row = result.rows[0] ?? null;
  if (lock && row) {
    // A review correction may have inserted its successor while this statement
    // waited on the source run lock. Read again after acquiring the lock.
    const current = await latestResult(db, orgId, problemId);
    if (current?.id !== row.id) throw new HttpError(409, "A newer implementation started. Refresh before reviewing its result.");
    return current;
  }
  return row;
}

function bindingFor(row: ResultRow | null): IssueResultBinding | null {
  return row?.implementation_commit_sha ? {
    runId: row.id, commitSha: row.implementation_commit_sha, promptHash: row.prompt_hash,
  } : null;
}

function resultUnavailable(row: ResultRow | null): string | null {
  if (!row) return "There is no implementation result to review yet.";
  if (["Closed", "Released"].includes(row.problem_stage)) return "This issue has already been closed or released.";
  if (["Queued", "Running"].includes(row.status)) return "Wait for the current implementation to finish before reviewing its result.";
  if (!["Tests passed", "Draft PR opened"].includes(row.status) || !row.implementation_commit_sha) {
    return "This run did not produce a completed implementation result to review.";
  }
  if (row.current_prompt_id !== row.prompt_revision_id || row.current_prompt_hash !== row.prompt_hash
    || row.coding_approval_hash !== row.prompt_hash || row.coding_approval_status !== "Approved") {
    return "The expected behavior or coding authorization changed. Review the latest implementation result.";
  }
  return null;
}

function decisionFromRow(row: DecisionRow, binding: IssueResultBinding | null): IssueResultDecision {
  const result = {
    id: row.id, runId: row.run_id, commitSha: row.commit_sha, promptHash: row.prompt_hash,
    version: row.version, decision: row.decision, feedback: row.feedback, actorName: row.actor_name,
    createdAt: row.created_at.toISOString(),
  };
  return { ...result, current: resultBindingMatches(result, binding) };
}

export async function readIssueResultReview(orgId: string, problemId: string): Promise<IssueResultReviewState> {
  const empty: IssueResultReviewState = { storageReady: false, binding: null, version: 0,
    latestDecision: null, canReview: false, unavailableReason: "Result review storage is not available in this workspace.", reworkRecommendation: null };
  if (workspacePersistenceMode(orgId) !== "postgres") return empty;
  const db = databasePool();
  if (!await issueResultReviewStorageReady(db)) return empty;
  const row = await latestResult(db, orgId, problemId);
  const reviews = await db.query<DecisionRow>(
    "SELECT * FROM issue_result_reviews WHERE org_id=$1 AND problem_id=$2 ORDER BY version DESC LIMIT 1", [orgId, problemId],
  );
  const binding = bindingFor(row);
  const latestDecision = reviews.rows[0] ? decisionFromRow(reviews.rows[0], binding) : null;
  let unavailableReason = resultUnavailable(row);
  if (row && !unavailableReason) {
    const executing = await db.query(
      `SELECT 1 FROM final_execution_attempts WHERE org_id=$1 AND agent_run_id=$2 AND status IN ('Running','Succeeded') LIMIT 1`,
      [orgId, row.id],
    );
    if (executing.rowCount) unavailableReason = "The final action has already started or completed; this result can no longer be changed.";
  }
  const reworkReady = await issueResultReworkStorageReady(db);
  const existingRework = reworkReady && latestDecision ? await db.query<{ run_id: string }>(
    "SELECT run_id FROM issue_result_rework_requests WHERE org_id=$1 AND problem_id=$2 AND review_id=$3", [orgId, problemId, latestDecision.id],
  ) : null;
  const reworkUnavailable = !domainResultReworkEnabled() ? "An administrator must enable follow-up execution after updating the coding executor."
    : !reworkReady ? "Follow-up execution requires a workspace update."
    : existingRework?.rows[0] ? "A follow-up run has already been authorized for this feedback."
      : !latestDecision?.current || latestDecision.decision !== "changes" ? "Record current result feedback before authorizing a follow-up run."
        : unavailableReason || (row?.status !== "Draft PR opened" ? "A current pull request is required for a follow-up run." : null);
  return { storageReady: true, binding, version: latestDecision?.version ?? 0, latestDecision,
    canReview: !unavailableReason, unavailableReason,
    rework: { available: !reworkUnavailable, unavailableReason: reworkUnavailable, runId: existingRework?.rows[0]?.run_id ?? null },
    reworkRecommendation: latestDecision?.current && latestDecision.decision === "changes" ? resultReworkRecommendation : null };
}

/** Caller must hold the run row lock; approval, claim and feedback share this lock. */
export async function issueResultChangesBlockExecution(db: Database, input: {
  orgId: string; problemId: string; runId: string; commitSha: string;
}): Promise<boolean> {
  if (!await issueResultReviewStorageReady(db)) return false;
  const result = await db.query<{ decision: string }>(
    `SELECT review.decision FROM issue_result_reviews review
       JOIN agent_runs run ON run.org_id=review.org_id AND run.problem_id=review.problem_id AND run.id=review.run_id
      WHERE review.org_id=$1 AND review.problem_id=$2 AND review.run_id=$3 AND review.commit_sha=$4
        AND review.prompt_hash=run.prompt_hash AND review.commit_sha=run.implementation_commit_sha
      ORDER BY review.version DESC LIMIT 1`, [input.orgId, input.problemId, input.runId, input.commitSha],
  );
  return result.rows[0]?.decision === "changes";
}

export async function recordIssueResultReview(context: RequestContext, problemId: string, body: unknown): Promise<IssueResultReviewState> {
  if (!["Admin", "Contributor"].includes(context.role) || !context.actorId.trim()
    || context.actorId.trim().toLowerCase().startsWith("system:")) throw new HttpError(403, "A human contributor must review the result.");
  const parsed = issueResultReviewSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid result review.");
  if (workspacePersistenceMode(context.orgId) !== "postgres") throw new HttpError(409, "Result reviews require a persistent workspace.");
  const input = parsed.data;
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  await transaction(async (client) => {
    if (!await issueResultReviewStorageReady(client)) throw new HttpError(409, "Result review storage requires a workspace update.");
    // Serializes version allocation and duplicate submissions for this issue.
    const problem = await client.query<{ stage: string }>(
      "SELECT stage FROM product_problems WHERE org_id=$1 AND id=$2 FOR UPDATE", [context.orgId, problemId],
    );
    if (!problem.rows[0]) throw new HttpError(404, "Issue not found.");
    const prior = await client.query<DecisionRow>(
      "SELECT * FROM issue_result_reviews WHERE org_id=$1 AND problem_id=$2 AND actor_id=$3 AND idempotency_key=$4",
      [context.orgId, problemId, context.actorId, context.idempotencyKey],
    );
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== requestHash) throw new HttpError(409, "This request key was already used for different feedback.");
      return;
    }
    if (["Closed", "Released"].includes(problem.rows[0].stage)) throw new HttpError(409, "This issue has already been closed or released.");
    const row = await latestResult(client, context.orgId, problemId, true);
    const unavailable = resultUnavailable(row);
    if (unavailable) throw new HttpError(409, unavailable);
    if (!resultBindingMatches(input, bindingFor(row))) throw new HttpError(409, "The implementation result changed. Refresh before reviewing it.");
    const prompt = await client.query<{ id: string; content_hash: string }>(
      "SELECT id,content_hash FROM implementation_prompts WHERE org_id=$1 AND problem_id=$2 AND status <> 'Superseded' ORDER BY revision DESC LIMIT 1 FOR SHARE",
      [context.orgId, problemId],
    );
    if (prompt.rows[0]?.id !== row!.prompt_revision_id || prompt.rows[0]?.content_hash !== input.promptHash) {
      throw new HttpError(409, "The expected behavior changed before result review. Refresh before reviewing it.");
    }
    const current = await client.query<DecisionRow>(
      "SELECT * FROM issue_result_reviews WHERE org_id=$1 AND problem_id=$2 ORDER BY version DESC LIMIT 1", [context.orgId, problemId],
    );
    if (input.version !== (current.rows[0]?.version ?? 0)) throw new HttpError(409, "Another result review was recorded. Refresh before reviewing it.");
    if (input.decision === "accept" && current.rows[0]?.decision === "changes"
      && decisionFromRow(current.rows[0], bindingFor(row)).current) {
      throw new HttpError(409, "This result needs changes. Review a new implementation result before accepting it.");
    }
    const attempts = await client.query<{ status: string }>(
      "SELECT status FROM final_execution_attempts WHERE org_id=$1 AND agent_run_id=$2 FOR UPDATE", [context.orgId, input.runId],
    );
    if (attempts.rows.some((attempt) => ["Running", "Succeeded"].includes(attempt.status))) {
      throw new HttpError(409, "The final action has already started or completed; this result can no longer be changed.");
    }
    const id = randomUUID();
    await client.query(
      `INSERT INTO issue_result_reviews(id,org_id,problem_id,run_id,commit_sha,prompt_hash,version,decision,feedback,
        actor_id,actor_name,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, context.orgId, problemId, input.runId, input.commitSha, input.promptHash, input.version + 1,
        input.decision, input.feedback, context.actorId, context.actorName, context.idempotencyKey, requestHash],
    );
    if (input.decision === "changes") {
      await client.query(
        `UPDATE approval_requests SET status='Rejected',reason=$5,updated_at=now()
          WHERE org_id=$1 AND problem_id=$2 AND agent_run_id=$3 AND head_sha=$4
            AND action_type='final_execution' AND status IN ('Pending','Approved')`,
        [context.orgId, problemId, input.runId, input.commitSha, "Changes requested in the human result review. Scoped rework and a fresh final approval are required."],
      );
      await client.query(
        `UPDATE final_execution_attempts SET status='Failed',failure_message=$4,completed_at=now()
          WHERE org_id=$1 AND agent_run_id=$2 AND expected_head_sha=$3 AND status='Queued'`,
        [context.orgId, input.runId, input.commitSha, "Human result review requested changes before execution started."],
      );
    }
    await client.query(
      `INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id)
       VALUES($1,$2,$3,$4,$5,'IssueResultReview',$6,$7)`,
      [randomUUID(), context.orgId, context.actorId, context.actorName,
        JSON.stringify({ kind: "human_result_review", reviewId: id, ...input, version: input.version + 1 }), problemId, context.traceId],
    );
    await client.query("UPDATE workspaces SET version=version+1,updated_at=now() WHERE org_id=$1", [context.orgId]);
  });
  return readIssueResultReview(context.orgId, problemId);
}
