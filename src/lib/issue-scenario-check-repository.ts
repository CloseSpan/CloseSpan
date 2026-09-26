import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { databasePool, transaction } from "./db";
import { workspacePersistenceMode } from "./workspace-persistence";
import { readPresentationDemo } from "./presentation-demo";
import { HttpError, type RequestContext } from "./request-security";
import { automaticCodingBudgetAllowsExecution, autonomyLevels } from "./autonomy-policy";
import { testPromptWithCloseSpanAgent } from "./closespan-prompt-agent";
import { beginPddPromptEvaluation, failPddPromptEvaluation, readPddAcceptanceContract } from "./pdd-prompt-evaluation-repository";
import { pddPromptReviewSchema } from "./pdd-prompt-review";
import { createPromptAlignmentReceipt } from "./prompt-alignment-receipt";
import { createPddPromptRevisionReceipt } from "./pdd-prompt-revision-receipt";
import { sha256 } from "./pdd-verification";
import { sanitizeIssueConversationText } from "./issue-conversation";
import { issueScenarioCheckSchema, type IssueScenarioCheckResult, type IssueScenarioCheckView } from "./issue-scenario-check";

const SETUP_NOTICE = "Scenario checks need database setup before they can be saved.";
const FAILED_NOTICE = "This scenario check could not be completed. It will not retry automatically; start a new check to continue.";
const CHECK_TTL_MS = 600_000;
type Queryable = Pick<Pool | PoolClient, "query">;
interface PromptRow {
  id: string; content_hash: string; status: string; rendered_content: string;
  specification_id: string; specification_revision: number;
}
interface CheckRow {
  id: string; actor_id: string; request_hash: string; prompt_id: string; prompt_hash: string;
  user_story: string; status: IssueScenarioCheckResult["status"]; evaluation_id: string | null;
  prompt_evaluation: IssueScenarioCheckResult["promptEvaluation"] | null;
  reserved_budget_usd: number | string; created_at: Date;
}

function missingStorage(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "42P01";
}

function checkResult(row: CheckRow, replayed: boolean): IssueScenarioCheckResult {
  const expired = row.status === "processing" && Date.now() - new Date(row.created_at).getTime() > CHECK_TTL_MS;
  const status = expired ? "failed" : row.status;
  return { status, replayed, promptHash: row.prompt_hash,
    ...(row.evaluation_id ? { evaluationId: row.evaluation_id } : {}),
    ...(status === "completed" && row.prompt_evaluation ? { promptEvaluation: row.prompt_evaluation } : {}),
    ...(status === "failed" ? { notice: FAILED_NOTICE } : {}),
  };
}

async function requireIssue(client: Queryable, orgId: string, problemId: string, lock = false) {
  const result = await client.query<{ stage: string }>(
    `SELECT stage FROM product_problems WHERE org_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`, [orgId, problemId],
  );
  if (!result.rows[0]) throw new HttpError(404, "Issue was not found");
  return result.rows[0];
}

async function readPrompt(client: Queryable, orgId: string, problemId: string, lock = false) {
  const result = await client.query<PromptRow>(
    `SELECT id,content_hash,status,rendered_content,specification_id,specification_revision
     FROM implementation_prompts WHERE org_id=$1 AND problem_id=$2 AND status <> 'Superseded'
     ORDER BY revision DESC LIMIT 1${lock ? " FOR SHARE" : ""}`, [orgId, problemId],
  );
  return result.rows[0] ?? null;
}

async function eligiblePrompt(client: Queryable, orgId: string, problemId: string, promptHash: string) {
  const prompt = await readPrompt(client, orgId, problemId, true);
  if (!prompt || prompt.content_hash !== promptHash)
    throw new HttpError(409, "The requirement changed. Refresh the issue before checking this scenario.");
  if (prompt.status === "Approved") throw new HttpError(409, "Scenario checks are locked while this requirement is approved for implementation");
  const active = await client.query(
    "SELECT 1 FROM agent_runs WHERE org_id=$1 AND problem_id=$2 AND status IN ('Queued','Running') LIMIT 1", [orgId, problemId],
  );
  if (active.rowCount) throw new HttpError(409, "Wait for the current implementation before checking another scenario");
  if (!prompt.rendered_content.trim() || prompt.rendered_content.length > 64_000)
    throw new HttpError(409, "The complete requirement is not ready for a scenario check");
  return prompt;
}

/** Polling after a refresh only returns the result for the current immutable requirement. */
export async function readIssueScenarioCheck(orgId: string, problemId: string): Promise<IssueScenarioCheckView> {
  if (workspacePersistenceMode(orgId) !== "postgres") return { check: null, currentPromptHash: null, storageReady: false, notice: SETUP_NOTICE };
  const pool = databasePool();
  await requireIssue(pool, orgId, problemId);
  const prompt = await readPrompt(pool, orgId, problemId);
  try {
    const result = await pool.query<CheckRow>(
      `SELECT * FROM issue_scenario_checks WHERE org_id=$1 AND problem_id=$2 AND prompt_hash=$3
       ORDER BY created_at DESC,id DESC LIMIT 1`, [orgId, problemId, prompt?.content_hash ?? null],
    );
    return { check: result.rows[0] ? checkResult(result.rows[0], true) : null,
      currentPromptHash: prompt?.content_hash ?? null, storageReady: true };
  } catch (error) {
    if (missingStorage(error)) return { check: null, currentPromptHash: prompt?.content_hash ?? null, storageReady: false, notice: SETUP_NOTICE };
    throw error;
  }
}

async function reserve(context: RequestContext, problemId: string, body: { userStory: string; currentPromptHash: string }) {
  const requestHash = sha256(JSON.stringify({ actorId: context.actorId, ...body }));
  return transaction(async (client) => {
    const issue = await requireIssue(client, context.orgId, problemId, true);
    const previous = await client.query<CheckRow>(
      "SELECT * FROM issue_scenario_checks WHERE org_id=$1 AND problem_id=$2 AND idempotency_key=$3",
      [context.orgId, problemId, context.idempotencyKey],
    );
    if (previous.rows[0]) {
      if (previous.rows[0].request_hash !== requestHash || previous.rows[0].actor_id !== context.actorId)
        throw new HttpError(409, "This send key was already used for a different scenario check");
      return { row: previous.rows[0], replayed: true, prompt: null };
    }
    if (issue.stage === "Closed") throw new HttpError(409, "Reopen this issue before checking another scenario");
    const settings = await client.query<{ autonomy_level: string; monthly_model_budget: number; used_model_cost: number; hard_stop: boolean }>(
      "SELECT autonomy_level,monthly_model_budget,used_model_cost,hard_stop FROM workspace_settings WHERE org_id=$1 FOR UPDATE", [context.orgId],
    );
    const policy = settings.rows[0];
    if (!policy || policy.autonomy_level === "Observe" || !autonomyLevels.includes(policy.autonomy_level as typeof autonomyLevels[number]))
      throw new HttpError(409, "Workspace policy must allow requirement preparation before checking a scenario");
    if (!automaticCodingBudgetAllowsExecution(policy))
      throw new HttpError(409, "Scenario checks require an available model budget with its hard stop enabled");
    const prompt = await eligiblePrompt(client, context.orgId, problemId, body.currentPromptHash);
    await client.query(
      `UPDATE issue_scenario_checks SET status='failed',completed_at=now()
       WHERE org_id=$1 AND problem_id=$2 AND status='processing' AND created_at < now()-interval '10 minutes'`, [context.orgId, problemId],
    );
    const active = await client.query(
      "SELECT 1 FROM issue_scenario_checks WHERE org_id=$1 AND problem_id=$2 AND status='processing'", [context.orgId, problemId],
    );
    if (active.rowCount) throw new HttpError(409, "Wait for the current scenario check before starting another one");
    // Retain the full reservation when a provider charge is unknown, including ambiguous failures.
    const spent = await client.query<{ committed: string }>(
      `SELECT COALESCE(sum(COALESCE(cost_usd,reserved_budget_usd)),0)::text AS committed
       FROM issue_scenario_checks WHERE org_id=$1 AND created_at >= date_trunc('month',now())`, [context.orgId],
    );
    const remaining = policy.monthly_model_budget - policy.used_model_cost - Number(spent.rows[0]?.committed ?? 0);
    if (!Number.isFinite(remaining) || remaining <= 0) throw new HttpError(409, "The available scenario-check budget is already used or reserved");
    const budget = Math.min(5, remaining);
    const inserted = await client.query<CheckRow>(
      `INSERT INTO issue_scenario_checks(id,org_id,problem_id,actor_id,idempotency_key,request_hash,
       prompt_id,prompt_hash,user_story,status,reserved_budget_usd)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'processing',$10) RETURNING *`,
      [randomUUID(), context.orgId, problemId, context.actorId, context.idempotencyKey, requestHash,
        prompt.id, prompt.content_hash, body.userStory, budget],
    );
    return { row: inserted.rows[0], replayed: false, prompt };
  });
}

export async function postIssueScenarioCheck(context: RequestContext, problemId: string, body: unknown): Promise<IssueScenarioCheckResult> {
  if (!["Admin", "Contributor"].includes(context.role)) throw new HttpError(403, "Contributor permission is required");
  const parsed = issueScenarioCheckSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "Provide a scenario of 3 to 2,000 characters and the current requirement version");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(context.idempotencyKey)) throw new HttpError(400, "A valid idempotency key is required");
  if (workspacePersistenceMode(context.orgId) !== "postgres") throw new HttpError(503, SETUP_NOTICE);
  if (process.env.NODE_ENV === "test" || process.env.APP_MODE === "demo" || await readPresentationDemo(context.orgId))
    throw new HttpError(403, "Live scenario checks are disabled in demo and test workspaces");
  let reservation;
  try { reservation = await reserve(context, problemId, parsed.data); }
  catch (error) { if (missingStorage(error)) throw new HttpError(503, SETUP_NOTICE); throw error; }
  if (reservation.replayed) return checkResult(reservation.row, true);
  const { row, prompt } = reservation;
  let evaluationId: string | null = null;
  let providerStarted = false;
  try {
    const storyHash = sha256(parsed.data.userStory.replace(/\s+/g, " ").trim());
    const evaluation = await beginPddPromptEvaluation({ orgId: context.orgId, problemId,
      specificationId: prompt!.specification_id, specificationRevision: prompt!.specification_revision,
      promptRevisionId: prompt!.id, promptHash: prompt!.content_hash,
      userStory: parsed.data.userStory, storyHash, triggerSource: "manual" });
    if (!evaluation.shouldRun) throw new HttpError(409, "This requirement check is already recorded");
    evaluationId = evaluation.evaluation.id;
    await databasePool().query(
      "UPDATE issue_scenario_checks SET evaluation_id=$4 WHERE org_id=$1 AND problem_id=$2 AND id=$3 AND status='processing'",
      [context.orgId, problemId, row.id, evaluationId],
    );
    const acceptanceContract = await readPddAcceptanceContract(context.orgId, problemId, prompt!.id);
    // Recheck the binding just before paid work; never regenerate/reopen an existing prompt here.
    await transaction((client) => eligiblePrompt(client, context.orgId, problemId, row.prompt_hash));
    providerStarted = true;
    const evaluated = await testPromptWithCloseSpanAgent({ orgId: context.orgId, promptHash: row.prompt_hash,
      userStory: parsed.data.userStory, implementationPrompt: prompt!.rendered_content,
      acceptanceContract, budgetUsd: Number(row.reserved_budget_usd) });
    if (evaluated.promptHash !== row.prompt_hash || (evaluated.costUsd !== null && evaluated.costUsd > Number(row.reserved_budget_usd)))
      throw new HttpError(502, "The scenario check did not return a valid result for this requirement");
    const review = pddPromptReviewSchema.parse({ ...evaluated,
      summary: evaluated.verdict === "Passed" ? "The requirement covers this scenario. This is not a live application test."
        : "The requirement needs changes to cover this scenario. This is not a live application test.",
      changes: evaluated.changes.map((change) => sanitizeIssueConversationText(change, 16_000)),
      alignmentReceipt: evaluated.verdict === "Passed" ? createPromptAlignmentReceipt({ orgId: context.orgId, problemId, promptHash: row.prompt_hash, storyHash }) : null,
      revisionReceipt: evaluated.suggestedRevision ? createPddPromptRevisionReceipt({ orgId: context.orgId, problemId,
        promptHash: row.prompt_hash, revisionHash: sha256(evaluated.suggestedRevision), storyHash }) : null,
    });
    const finished = await transaction(async (client) => {
      await eligiblePrompt(client, context.orgId, problemId, row.prompt_hash);
      const saved = await client.query<CheckRow>(
        `UPDATE issue_scenario_checks SET status='completed',prompt_evaluation=$4,cost_usd=$5,completed_at=now()
         WHERE org_id=$1 AND problem_id=$2 AND id=$3 AND status='processing'
           AND created_at >= now()-interval '10 minutes' RETURNING *`,
        [context.orgId, problemId, row.id, JSON.stringify(review), review.costUsd],
      );
      if (!saved.rows[0]) throw new HttpError(409, "This scenario check has expired. Start a new check to continue.");
      // Complete the existing PDD record in the same transaction as the durable response.
      await client.query(
        `UPDATE pdd_prompt_evaluations SET status='Succeeded',review=$3,failure_message=NULL,completed_at=now()
         WHERE org_id=$1 AND id=$2 AND status='Running'`,
        [context.orgId, evaluationId, JSON.stringify({ ...review, alignmentReceipt: null, revisionReceipt: null })],
      );
      return saved.rows[0];
    });
    return checkResult(finished, false);
  } catch {
    await databasePool().query(
      `UPDATE issue_scenario_checks SET status='failed',cost_usd=CASE WHEN $4 THEN cost_usd ELSE 0 END,completed_at=now()
       WHERE org_id=$1 AND problem_id=$2 AND id=$3 AND status='processing'`,
      [context.orgId, problemId, row.id, providerStarted],
    ).catch(() => undefined);
    if (evaluationId) await failPddPromptEvaluation(context.orgId, evaluationId, FAILED_NOTICE).catch(() => undefined);
    return { status: "failed", replayed: false, promptHash: row.prompt_hash, notice: FAILED_NOTICE,
      ...(evaluationId ? { evaluationId } : {}) };
  }
}
