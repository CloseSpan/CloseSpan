import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { transaction } from "./db";
import type { RequestContext } from "./request-security";
import { workspacePersistenceMode } from "./workspace-persistence";

type ReviewDecision = "approve" | "reject";
type ReviewStatus = "Approved" | "Rejected";

export interface FeedbackReviewInput {
  orgId: string;
  feedbackId: string;
  decision: ReviewDecision;
  problemId?: string | null;
  context: RequestContext;
}

export interface FeedbackReviewResult {
  analysisId: string;
  feedbackId: string;
  decision: ReviewDecision;
  reviewStatus: ReviewStatus;
  problem: {
    id: string;
    title: string;
    stage: string;
  } | null;
  createdProblem: boolean;
  replayed: boolean;
}

interface AnalysisRow {
  id: string;
  feedback_id: string;
  classification: string;
  severity: "Critical" | "High" | "Medium" | "Low";
  redacted_summary: string;
  proposed_problem_id: string | null;
  classification_confidence: number;
  cluster_confidence: number;
  review_status: "Proposed" | ReviewStatus;
}

interface ProblemRow {
  id: string;
  title: string;
  stage: string;
}

interface StoredReviewAction {
  type: "feedback-analysis-review";
  version: 1;
  analysisId: string;
  feedbackId: string;
  decision: ReviewDecision;
  requestedProblemId: string | null;
  targetProblemId: string | null;
  createdProblem: boolean;
}

export class FeedbackReviewNotFoundError extends Error {}
export class FeedbackReviewConflictError extends Error {}

const normalizedProblemId = (value?: string | null) => value ?? null;

export function feedbackProblemTitle(summary: string): string {
  const compact = summary.replace(/\s+/g, " ").trim();
  const firstSentence = compact.match(/^.*?(?:[.!?](?:\s|$)|$)/)?.[0] ?? compact;
  const title = firstSentence.trim().replace(/[.!?]+$/, "").trim();
  if (!title) return "Feedback needs product review";
  return title.length <= 100 ? title : `${title.slice(0, 97).trimEnd()}…`;
}

function parseStoredAction(value: string): StoredReviewAction | null {
  try {
    const parsed = JSON.parse(value) as Partial<StoredReviewAction>;
    if (
      parsed.type !== "feedback-analysis-review" ||
      parsed.version !== 1 ||
      typeof parsed.analysisId !== "string" ||
      typeof parsed.feedbackId !== "string" ||
      (parsed.decision !== "approve" && parsed.decision !== "reject") ||
      !(parsed.requestedProblemId === null || typeof parsed.requestedProblemId === "string") ||
      !(parsed.targetProblemId === null || typeof parsed.targetProblemId === "string") ||
      typeof parsed.createdProblem !== "boolean"
    ) return null;
    return parsed as StoredReviewAction;
  } catch {
    return null;
  }
}

function sameRequest(action: StoredReviewAction, input: FeedbackReviewInput): boolean {
  return action.feedbackId === input.feedbackId &&
    action.decision === input.decision &&
    action.requestedProblemId === normalizedProblemId(input.problemId);
}

async function readProblem(
  client: PoolClient,
  orgId: string,
  problemId: string,
): Promise<ProblemRow | null> {
  const result = await client.query<ProblemRow>(
    "SELECT id,title,stage FROM product_problems WHERE org_id=$1 AND id=$2",
    [orgId, problemId],
  );
  return result.rows[0] ?? null;
}

async function replayStoredReview(
  client: PoolClient,
  input: FeedbackReviewInput,
  actionValue: string,
): Promise<FeedbackReviewResult> {
  const action = parseStoredAction(actionValue);
  if (!action || !sameRequest(action, input))
    throw new FeedbackReviewConflictError(
      "This idempotency key has already been used for another action",
    );
  const analysis = await client.query<{ review_status: string }>(
    "SELECT review_status FROM ai_feedback_analyses WHERE org_id=$1 AND id=$2 AND feedback_id=$3",
    [input.orgId, action.analysisId, action.feedbackId],
  );
  const expectedStatus = action.decision === "approve" ? "Approved" : "Rejected";
  if (analysis.rows[0]?.review_status !== expectedStatus)
    throw new FeedbackReviewConflictError(
      "The stored review result is no longer available",
    );
  const problem = action.targetProblemId
    ? await readProblem(client, input.orgId, action.targetProblemId)
    : null;
  if (action.targetProblemId && !problem)
    throw new FeedbackReviewConflictError(
      "The reviewed product problem is no longer available",
    );
  return {
    analysisId: action.analysisId,
    feedbackId: action.feedbackId,
    decision: action.decision,
    reviewStatus: expectedStatus,
    problem,
    createdProblem: action.createdProblem,
    replayed: true,
  };
}

async function existingIdempotencyAction(
  client: PoolClient,
  orgId: string,
  key: string,
): Promise<string | null> {
  const result = await client.query<{ action: string }>(
    "SELECT action FROM idempotency_keys WHERE org_id=$1 AND key=$2",
    [orgId, key],
  );
  return result.rows[0]?.action ?? null;
}

async function createProblem(
  client: PoolClient,
  input: FeedbackReviewInput,
  analysis: AnalysisRow,
): Promise<ProblemRow> {
  const problem: ProblemRow = {
    id: `prob_${randomUUID().replaceAll("-", "")}`,
    title: feedbackProblemTitle(analysis.redacted_summary),
    stage: "Needs review",
  };
  await client.query(
    `INSERT INTO product_problems(
       id,org_id,title,statement,summary,stage,severity,confidence,
       product_area,team,churn_risk,suspected_repository,suspected_files,impact_factors
     ) VALUES($1,$2,$3,$4,$4,'Needs review',$5,$6,$7,'Unassigned',0,'Not yet identified','[]'::jsonb,'[]'::jsonb)`,
    [
      problem.id,
      input.orgId,
      problem.title,
      analysis.redacted_summary,
      analysis.severity,
      Math.max(0, Math.min(1, analysis.classification_confidence)),
      analysis.classification,
    ],
  );
  return problem;
}

async function findOrCreateProblem(
  client: PoolClient,
  input: FeedbackReviewInput,
  analysis: AnalysisRow,
): Promise<{ problem: ProblemRow; created: boolean }> {
  const title = feedbackProblemTitle(analysis.redacted_summary);
  // Serialize fallback problem creation within a workspace. The AI candidate
  // snapshot can be stale when multiple feedback records are analyzed together
  // or when two intake jobs overlap.
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
    [`${input.orgId}:problem-cluster-create`],
  );
  const existing = await client.query<ProblemRow>(
    `SELECT id,title,stage FROM product_problems
      WHERE org_id=$1 AND stage <> 'Closed' AND lower(title)=lower($2)
      ORDER BY created_at,id LIMIT 1 FOR UPDATE`,
    [input.orgId, title],
  );
  if (existing.rows[0]) return { problem: existing.rows[0], created: false };
  return { problem: await createProblem(client, input, analysis), created: true };
}

async function performReview(
  client: PoolClient,
  input: FeedbackReviewInput,
): Promise<FeedbackReviewResult> {
  // Serialize all uses of one workspace/idempotency key, including requests
  // that happen to target different feedback records.
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
    [`${input.orgId}:${input.context.idempotencyKey}`],
  );
  const initialAction = await existingIdempotencyAction(
    client,
    input.orgId,
    input.context.idempotencyKey,
  );
  if (initialAction) return replayStoredReview(client, input, initialAction);

  const latest = await client.query<AnalysisRow>(
    `SELECT analysis.id,analysis.feedback_id,analysis.classification,
            analysis.severity,analysis.redacted_summary,
            analysis.proposed_problem_id,analysis.classification_confidence,
            analysis.cluster_confidence,analysis.review_status
       FROM ai_feedback_analyses analysis
       JOIN model_runs run
         ON run.org_id=analysis.org_id AND run.id=analysis.model_run_id
      WHERE analysis.org_id=$1 AND analysis.feedback_id=$2
        AND run.status='Succeeded'
      ORDER BY analysis.created_at DESC,analysis.id DESC
      LIMIT 1
      FOR UPDATE OF analysis`,
    [input.orgId, input.feedbackId],
  );
  const analysis = latest.rows[0];
  if (!analysis)
    throw new FeedbackReviewNotFoundError(
      "Analyze this feedback before reviewing it",
    );

  // A concurrent request may have committed while this transaction waited on
  // the analysis row lock. Re-read the key after obtaining that lock.
  const committedAction = await existingIdempotencyAction(
    client,
    input.orgId,
    input.context.idempotencyKey,
  );
  if (committedAction)
    return replayStoredReview(client, input, committedAction);
  if (analysis.review_status !== "Proposed")
    throw new FeedbackReviewConflictError(
      "This analysis has already been reviewed",
    );

  let problem: ProblemRow | null = null;
  let createdProblem = false;
  if (input.decision === "approve") {
    const targetProblemId = normalizedProblemId(input.problemId) ??
      analysis.proposed_problem_id;
    if (targetProblemId) {
      const target = await client.query<ProblemRow>(
        "SELECT id,title,stage FROM product_problems WHERE org_id=$1 AND id=$2 FOR UPDATE",
        [input.orgId, targetProblemId],
      );
      problem = target.rows[0] ?? null;
      if (!problem)
        throw new FeedbackReviewNotFoundError(
          "The selected product problem does not exist in this workspace",
        );
      if (problem.stage === "Closed")
        throw new FeedbackReviewConflictError(
          "Closed product problems cannot receive new feedback",
        );
    } else {
      const fallback = await findOrCreateProblem(client, input, analysis);
      problem = fallback.problem;
      createdProblem = fallback.created;
    }

    const humanSelectedDifferentProblem = Boolean(
      input.problemId && input.problemId !== analysis.proposed_problem_id,
    );
    const similarity = humanSelectedDifferentProblem || createdProblem
      ? 1
      : Math.max(0, Math.min(1, analysis.cluster_confidence));
    await client.query(
      `INSERT INTO feedback_cluster_memberships(
         org_id,problem_id,feedback_id,similarity,explanation
       ) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (org_id,problem_id,feedback_id) DO UPDATE
       SET similarity=EXCLUDED.similarity,explanation=EXCLUDED.explanation`,
      [
        input.orgId,
        problem.id,
        analysis.feedback_id,
        similarity,
        createdProblem
          ? "A reviewer created this problem from the approved analysis."
          : "A reviewer approved this feedback-to-problem link.",
      ],
    );
    const updated = await client.query(
      `UPDATE ai_feedback_analyses
          SET review_status='Approved',proposed_problem_id=$3
        WHERE org_id=$1 AND id=$2 AND review_status='Proposed'`,
      [input.orgId, analysis.id, problem.id],
    );
    if (updated.rowCount !== 1)
      throw new FeedbackReviewConflictError(
        "This analysis has already been reviewed",
      );
  } else {
    const updated = await client.query(
      `UPDATE ai_feedback_analyses SET review_status='Rejected'
        WHERE org_id=$1 AND id=$2 AND review_status='Proposed'`,
      [input.orgId, analysis.id],
    );
    if (updated.rowCount !== 1)
      throw new FeedbackReviewConflictError(
        "This analysis has already been reviewed",
      );
  }

  const storedAction: StoredReviewAction = {
    type: "feedback-analysis-review",
    version: 1,
    analysisId: analysis.id,
    feedbackId: analysis.feedback_id,
    decision: input.decision,
    requestedProblemId: normalizedProblemId(input.problemId),
    targetProblemId: problem?.id ?? null,
    createdProblem,
  };
  await client.query(
    "INSERT INTO idempotency_keys(org_id,key,action) VALUES($1,$2,$3)",
    [input.orgId, input.context.idempotencyKey, JSON.stringify(storedAction)],
  );
  const auditAction = input.decision === "reject"
    ? `Rejected AI feedback analysis ${analysis.id}`
    : createdProblem
      ? `Approved AI feedback analysis and created Needs review product problem ${problem!.id}`
      : `Approved AI feedback analysis and linked feedback to product problem ${problem!.id}`;
  await client.query(
    `INSERT INTO audit_events(
       id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
     ) VALUES($1,$2,$3,$4,$5,'AiFeedbackAnalysis',$6,$7)`,
    [
      randomUUID(),
      input.orgId,
      input.context.actorId,
      input.context.actorName,
      auditAction,
      analysis.id,
      input.context.traceId,
    ],
  );
  return {
    analysisId: analysis.id,
    feedbackId: analysis.feedback_id,
    decision: input.decision,
    reviewStatus: input.decision === "approve" ? "Approved" : "Rejected",
    problem,
    createdProblem,
    replayed: false,
  };
}

export async function reviewLatestFeedbackAnalysis(
  input: FeedbackReviewInput,
): Promise<FeedbackReviewResult> {
  if (workspacePersistenceMode(input.orgId) !== "postgres")
    throw new FeedbackReviewConflictError(
      "PostgreSQL persistence is required for feedback review",
    );
  return transaction((client) => performReview(client, input));
}
