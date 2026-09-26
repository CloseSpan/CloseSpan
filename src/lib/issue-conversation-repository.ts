import { randomUUID } from "node:crypto";
import { databasePool, transaction } from "./db";
import { workspacePersistenceMode } from "./workspace-persistence";
import { readPresentationDemo } from "./presentation-demo";
import { HttpError, type RequestContext } from "./request-security";
import { getAiRuntimeConfiguration } from "./ai-config";
import { automaticCodingBudgetAllowsExecution, autonomyLevels } from "./autonomy-policy";
import { getEngineeringWorkflow } from "./engineering-workflow-repository";
import { discussImplementationPrompt, promptConversationResultSchema } from "./prompt-conversation";
import { createPromptConversationRevisionReceipt } from "./prompt-conversation-revision-receipt";
import { sha256 } from "./pdd-verification";
import {
  boundedIssueConversationEvidence,
  issueConversationMessageSchema,
  sanitizeIssueConversationText,
  type IssueConversationMessage,
  type IssueConversationProposal,
  type IssueConversationView,
} from "./issue-conversation";

const SETUP_NOTICE = "Issue discussion needs database setup before messages can be saved.";
const FAILED_NOTICE = "The last reply could not be completed. Your message is saved. Send a new message to continue.";
const REQUEST_TTL_MS = 180_000;
const HISTORY_LIMIT = 100;

interface RequestRow {
  id: string;
  actor_id: string;
  request_hash: string;
  status: "processing" | "completed" | "failed";
  created_at: Date;
}

interface MessageRow {
  id: string;
  role: IssueConversationMessage["role"];
  content: string;
  proposal: IssueConversationProposal | null;
  status: RequestRow["status"];
  created_at: Date;
  request_created_at: Date;
}

function missingStorage(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && error.code === "42P01";
}

function unavailableView(): IssueConversationView {
  return { messages: [], storageReady: false, pending: false, notice: SETUP_NOTICE };
}

function effectiveStatus(row: Pick<RequestRow, "status" | "created_at">): RequestRow["status"] {
  return row.status === "processing" && Date.now() - new Date(row.created_at).getTime() > REQUEST_TTL_MS
    ? "failed" : row.status;
}

async function requireIssue(orgId: string, problemId: string): Promise<void> {
  const result = await databasePool().query(
    "SELECT 1 FROM product_problems WHERE org_id=$1 AND id=$2", [orgId, problemId],
  );
  if (!result.rowCount) throw new HttpError(404, "Issue was not found");
}

/** History is always fetched from storage, never accepted from the browser. */
export async function readIssueConversation(orgId: string, problemId: string): Promise<IssueConversationView> {
  if (workspacePersistenceMode(orgId) !== "postgres") return unavailableView();
  await requireIssue(orgId, problemId);
  try {
    const result = await databasePool().query<MessageRow>(
      `SELECT message.id,message.role,message.content,message.proposal,message.created_at,
              request.status,request.created_at AS request_created_at
       FROM issue_conversation_messages message
       JOIN issue_conversation_requests request
         ON request.org_id=message.org_id AND request.problem_id=message.problem_id AND request.id=message.request_id
       WHERE message.org_id=$1 AND message.problem_id=$2
       ORDER BY message.created_at DESC,CASE WHEN message.role='assistant' THEN 1 ELSE 0 END DESC,message.id DESC LIMIT $3`,
      [orgId, problemId, HISTORY_LIMIT],
    );
    const messages = result.rows.reverse().map((row): IssueConversationMessage => ({
      id: row.id, role: row.role, content: row.content,
      createdAt: new Date(row.created_at).toISOString(),
      status: effectiveStatus({ status: row.status, created_at: row.request_created_at }),
      ...(row.proposal ? { proposal: row.proposal } : {}),
    }));
    const latest = messages.at(-1);
    return {
      messages, storageReady: true,
      pending: messages.some((message) => message.status === "processing"),
      ...(latest?.status === "failed" ? { notice: FAILED_NOTICE } : {}),
    };
  } catch (error) {
    if (missingStorage(error)) return unavailableView();
    throw error;
  }
}

/** Build bounded, explicit evidence fields. Never include raw logs, credentials, or whole workspace data. */
export async function readIssueConversationContext(orgId: string, problemId: string) {
  const pool = databasePool();
  const problem = await pool.query<{ title: string; statement: string; summary: string; stage: string }>(
    "SELECT title,statement,summary,stage FROM product_problems WHERE org_id=$1 AND id=$2", [orgId, problemId],
  );
  if (!problem.rows[0]) throw new HttpError(404, "Issue was not found");
  const [reports, investigation, workflow] = await Promise.all([
    pool.query<{ source: string; observed_at: string; quote: string }>(
      `SELECT feedback.source,feedback.observed_at,left(feedback.quote,2000) AS quote
       FROM feedback_cluster_memberships membership
       JOIN feedback_items feedback ON feedback.org_id=membership.org_id AND feedback.id=membership.feedback_id
       WHERE membership.org_id=$1 AND membership.problem_id=$2 AND feedback.redacted=true
       ORDER BY feedback.created_at DESC,feedback.id DESC LIMIT 8`, [orgId, problemId],
    ),
    pool.query<Record<string, unknown>>(
      `SELECT status,hypothesis,assumptions,missing_information,verification_status,verification_summary
       FROM investigations WHERE org_id=$1 AND problem_id=$2 ORDER BY updated_at DESC,id DESC LIMIT 1`, [orgId, problemId],
    ),
    getEngineeringWorkflow(orgId, problemId),
  ]);
  const specification = workflow.specification;
  const run = workflow.run;
  // Allocate per-source budgets so verbose reports cannot hide current results or gaps.
  const evidence: Record<string, unknown> = {
    issue: boundedIssueConversationEvidence(problem.rows[0], 2_500),
    reports: boundedIssueConversationEvidence(reports.rows, 4_000),
    investigation: boundedIssueConversationEvidence(investigation.rows[0] ?? null, 3_000),
    requirements: boundedIssueConversationEvidence(specification ? {
      userStory: specification.userStory, currentBehavior: specification.currentBehavior,
      expectedBehavior: specification.expectedBehavior, acceptanceCriteria: specification.acceptanceCriteria,
      testScenarios: specification.testScenarios, nonGoals: specification.nonGoals,
    } : null, 6_000),
    missingRequirements: boundedIssueConversationEvidence(workflow.readiness.issues, 1_500),
    requirementCheck: boundedIssueConversationEvidence(workflow.promptEvaluation ? {
      status: workflow.promptEvaluation.status,
      summary: workflow.promptEvaluation.review?.summary ?? null,
      verdict: workflow.promptEvaluation.review?.verdict ?? null,
      matchesCurrentPrompt: workflow.promptEvaluation.promptHash === workflow.prompt?.contentHash,
    } : null, 1_000),
    protectedTestPreparation: workflow.verification ? {
      status: workflow.verification.status,
      matchesCurrentPrompt: workflow.verification.promptHash === workflow.prompt?.contentHash,
    } : null,
    latestImplementation: boundedIssueConversationEvidence(run ? {
      status: run.status, summary: run.implementationSummary ?? null, completedAt: run.completedAt,
      matchesCurrentPrompt: Boolean(workflow.prompt && workflow.approval
        && run.approvalId === workflow.approval.id && workflow.approval.promptHash === workflow.prompt.contentHash),
      tests: run.testResults.map((test) => ({ command: test.command, status: test.status })),
      criteria: run.criterionResults, remainingRisks: run.remainingRisks ?? [],
      manualVerification: run.manualVerification ?? [],
    } : null, 6_000),
    codingApproval: workflow.approval?.status ?? null,
    finalApproval: workflow.finalApproval?.status ?? null,
    contextNote: "Evidence is a bounded snapshot. Missing records are unknown; investigation is a hypothesis. Requirement checks do not prove a live fix. Discussion performs no actions.",
  };
  const prompt = workflow.prompt;
  // A truncated/redacted prompt must never become a complete revision proposal.
  const promptContent = prompt?.content ?? "";
  const safePrompt = sanitizeIssueConversationText(promptContent, 64_000);
  const canPropose = Boolean(prompt && promptContent.length <= 64_000 && safePrompt === promptContent);
  return { evidence, prompt: canPropose ? prompt : null };
}

async function reserveRequest(context: RequestContext, problemId: string, message: string) {
  const requestHash = sha256(JSON.stringify({ actorId: context.actorId, message }));
  return transaction(async (client) => {
    // Serialize sends for this issue, including requests with different keys.
    const issue = await client.query(
      "SELECT 1 FROM product_problems WHERE org_id=$1 AND id=$2 FOR UPDATE", [context.orgId, problemId],
    );
    if (!issue.rowCount) throw new HttpError(404, "Issue was not found");
    const existing = await client.query<RequestRow>(
      `SELECT id,actor_id,request_hash,status,created_at FROM issue_conversation_requests
       WHERE org_id=$1 AND problem_id=$2 AND idempotency_key=$3`,
      [context.orgId, problemId, context.idempotencyKey],
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (row.request_hash !== requestHash || row.actor_id !== context.actorId)
        throw new HttpError(409, "This send key was already used for a different message");
      // Never reclaim even an expired/failed request: the provider may have charged it.
      return { id: row.id, status: effectiveStatus(row), replayed: true };
    }
    const settings = await client.query<{
      autonomy_level: string; monthly_model_budget: number; used_model_cost: number; hard_stop: boolean;
    }>(
      "SELECT autonomy_level,monthly_model_budget,used_model_cost,hard_stop FROM workspace_settings WHERE org_id=$1 FOR SHARE",
      [context.orgId],
    );
    const policy = settings.rows[0];
    if (!policy || policy.autonomy_level === "Observe" || !autonomyLevels.includes(policy.autonomy_level as typeof autonomyLevels[number]))
      throw new HttpError(409, "Workspace policy must allow recommendations before starting an AI discussion");
    if (!automaticCodingBudgetAllowsExecution(policy))
      throw new HttpError(409, "AI discussion requires an available workspace model budget and its hard stop enabled");
    await client.query(
      `UPDATE issue_conversation_requests SET status='failed',completed_at=now()
       WHERE org_id=$1 AND problem_id=$2 AND status='processing' AND created_at < now()-interval '3 minutes'`,
      [context.orgId, problemId],
    );
    const pending = await client.query(
      "SELECT 1 FROM issue_conversation_requests WHERE org_id=$1 AND problem_id=$2 AND status='processing'", [context.orgId, problemId],
    );
    if (pending.rowCount) throw new HttpError(409, "Wait for the current discussion reply before sending another message");
    const id = randomUUID();
    await client.query(
      `INSERT INTO issue_conversation_requests(id,org_id,problem_id,actor_id,idempotency_key,request_hash,status)
       VALUES($1,$2,$3,$4,$5,$6,'processing')`,
      [id, context.orgId, problemId, context.actorId, context.idempotencyKey, requestHash],
    );
    await client.query(
      `INSERT INTO issue_conversation_messages(id,org_id,problem_id,request_id,role,content)
       VALUES($1,$2,$3,$4,'user',$5)`,
      [randomUUID(), context.orgId, problemId, id, sanitizeIssueConversationText(message, 2_000)],
    );
    return { id, status: "processing" as const, replayed: false };
  });
}

export type IssueConversationPostResult = IssueConversationView & {
  status: "processing" | "completed" | "failed";
  replayed: boolean;
};

export async function postIssueConversation(
  context: RequestContext,
  problemId: string,
  body: unknown,
): Promise<IssueConversationPostResult> {
  if (!["Admin", "Contributor"].includes(context.role)) throw new HttpError(403, "Contributor permission is required");
  const parsed = issueConversationMessageSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "Enter a message of 2,000 characters or fewer; history is loaded automatically");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(context.idempotencyKey)) throw new HttpError(400, "A valid idempotency key is required");
  if (workspacePersistenceMode(context.orgId) !== "postgres") throw new HttpError(503, SETUP_NOTICE);
  if (process.env.NODE_ENV === "test" || process.env.APP_MODE === "demo" || await readPresentationDemo(context.orgId))
    throw new HttpError(403, "Live issue discussion is disabled in demo and test workspaces");
  const message = parsed.data.message;
  let request;
  try {
    request = await reserveRequest(context, problemId, message);
  } catch (error) {
    if (missingStorage(error)) throw new HttpError(503, SETUP_NOTICE);
    throw error;
  }
  if (request.replayed) return { ...await readIssueConversation(context.orgId, problemId), status: request.status, replayed: true };
  try {
    const [configuration, saved, grounded] = await Promise.all([
      getAiRuntimeConfiguration(context.orgId),
      readIssueConversation(context.orgId, problemId),
      readIssueConversationContext(context.orgId, problemId),
    ]);
    if (!configuration.apiKey) throw new HttpError(503, "Configure an AI provider in Settings to use issue discussion");
    const result = await discussImplementationPrompt({
      configuration: { ...configuration, timeoutMs: Math.min(configuration.timeoutMs, 60_000), maxOutputTokens: Math.min(configuration.maxOutputTokens, 8_000) },
      implementationPrompt: grounded.prompt?.content ?? "",
      message: sanitizeIssueConversationText(message, 2_000),
      history: saved.messages.filter((entry) => entry.status === "completed").slice(-10)
        .map(({ role, content }) => ({ role, content: sanitizeIssueConversationText(content, 2_000) })),
      issueEvidence: grounded.evidence,
    });
    const validated = promptConversationResultSchema.parse(result);
    let proposal: IssueConversationProposal | null = null;
    const revised = validated.improvement?.revisedPrompt.trim();
    if (grounded.prompt && revised && revised !== grounded.prompt.content.trim()
      && sanitizeIssueConversationText(revised, 64_000) === revised) {
      // Signing failure must not discard a useful answer or make a proposal actionable.
      try {
        proposal = {
          summary: sanitizeIssueConversationText(validated.improvement!.summary, 800), revisedPrompt: revised,
          currentPromptHash: grounded.prompt.contentHash, message: sanitizeIssueConversationText(message, 2_000),
          revisionReceipt: createPromptConversationRevisionReceipt({
            orgId: context.orgId, problemId, promptHash: grounded.prompt.contentHash,
            revisionHash: sha256(revised), messageHash: sha256(sanitizeIssueConversationText(message, 2_000)),
          }),
        };
      } catch { proposal = null; }
    }
    await transaction(async (client) => {
      const finished = await client.query(
        `UPDATE issue_conversation_requests SET status='completed',provider=$4,model=$5,completed_at=now()
         WHERE org_id=$1 AND problem_id=$2 AND id=$3 AND status='processing'
           AND created_at >= now()-interval '3 minutes' RETURNING id`,
        [context.orgId, problemId, request.id, result.provider, result.model],
      );
      if (!finished.rowCount) throw new HttpError(409, "This discussion reply has expired. Send a new message to continue.");
      await client.query(
        `INSERT INTO issue_conversation_messages(id,org_id,problem_id,request_id,role,content,proposal)
         VALUES($1,$2,$3,$4,'assistant',$5,$6::jsonb)`,
        [randomUUID(), context.orgId, problemId, request.id, sanitizeIssueConversationText(validated.answer), proposal ? JSON.stringify(proposal) : null],
      );
    });
    return { ...await readIssueConversation(context.orgId, problemId), status: "completed", replayed: false };
  } catch (error) {
    // Keep an ambiguous provider failure terminal. A retry of this key must never pay again.
    await databasePool().query(
      `UPDATE issue_conversation_requests SET status='failed',completed_at=now()
       WHERE org_id=$1 AND problem_id=$2 AND id=$3 AND status='processing'`,
      [context.orgId, problemId, request.id],
    ).catch(() => undefined);
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, "The discussion reply could not be completed. Your message is saved; send a new message to continue.");
  }
}
