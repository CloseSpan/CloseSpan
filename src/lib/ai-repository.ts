import { randomUUID } from "node:crypto";
import { databasePool, persistenceMode, transaction } from "./db";
import type { RequestContext } from "./request-security";
import type { AiProvider } from "./ai-config";
import type { AiAnalysisResult, AiFeedbackInput, AiProblemCandidate } from "./ai-provider";

export interface FeedbackPromptVersion {
  id: string;
  name: string;
  version: number;
  systemPrompt: string;
}

export interface FeedbackAnalysisContext {
  prompt: FeedbackPromptVersion;
  feedback: AiFeedbackInput[];
  candidates: AiProblemCandidate[];
}

export interface StoredAiRun {
  runId: string;
  provider: AiProvider;
  providerLabel: string;
  model: string;
  replayed: boolean;
  analyses: AiAnalysisResult["analyses"];
}

export type ModelRunReservation =
  | { kind: "created"; runId: string }
  | { kind: "replay"; result: StoredAiRun }
  | { kind: "running" }
  | { kind: "failed"; message: string };

export async function getFeedbackAnalysisContext(orgId: string, feedbackIds: string[]): Promise<FeedbackAnalysisContext> {
  if (persistenceMode() !== "postgres") throw new Error("PostgreSQL persistence is required for durable AI analysis");
  const pool = databasePool();
  const [promptResult, feedbackResult, problemResult] = await Promise.all([
    pool.query<{ id:string; name:string; version:number; system_prompt:string }>(
      "SELECT id,name,version,system_prompt FROM prompt_versions WHERE org_id=$1 AND name='feedback-intelligence' AND active=true",
      [orgId],
    ),
    pool.query<{ id:string; source:string; account_tier:string; environment:string; quote:string }>(
      "SELECT id,source,account_tier,environment,quote FROM feedback_items WHERE org_id=$1 AND id=ANY($2::text[]) ORDER BY id",
      [orgId, feedbackIds],
    ),
    pool.query<{ id:string; title:string; statement:string; product_area:string; severity:string }>(
      "SELECT id,title,statement,product_area,severity FROM product_problems WHERE org_id=$1 AND stage NOT IN ('Closed') ORDER BY id",
      [orgId],
    ),
  ]);
  if (promptResult.rowCount !== 1) throw new Error("One active feedback-intelligence prompt version is required");
  if (feedbackResult.rowCount !== feedbackIds.length) throw new Error("One or more feedback records do not exist in this organization");
  const prompt = promptResult.rows[0];
  return {
    prompt: { id:prompt.id, name:prompt.name, version:prompt.version, systemPrompt:prompt.system_prompt },
    feedback: feedbackResult.rows.map((row) => ({ id:row.id, source:row.source, accountTier:row.account_tier, environment:row.environment, quote:row.quote })),
    candidates: problemResult.rows.map((row) => ({ id:row.id, title:row.title, statement:row.statement, productArea:row.product_area, severity:row.severity })),
  };
}

export async function reserveModelRun(input: {
  orgId: string;
  promptVersionId: string;
  provider: AiProvider;
  providerLabel: string;
  model: string;
  idempotencyKey: string;
  feedbackIds: string[];
}): Promise<ModelRunReservation> {
  const pool = databasePool();
  const existing = await pool.query<{ id:string; status:string; provider:AiProvider; model:string; output:unknown; error_message:string|null }>(
    "SELECT id,status,provider,model,output,error_message FROM model_runs WHERE org_id=$1 AND idempotency_key=$2",
    [input.orgId,input.idempotencyKey],
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    if (row.status === "Running") return { kind:"running" };
    if (row.status === "Failed") return { kind:"failed", message:row.error_message ?? "The previous AI request failed" };
    return { kind:"replay", result:{ runId:row.id, provider:row.provider, providerLabel:input.providerLabel, model:row.model, replayed:true, analyses:row.output as AiAnalysisResult["analyses"] } };
  }
  const runId = randomUUID();
  await pool.query(
    `INSERT INTO model_runs(id,org_id,prompt_version_id,provider,model,status,idempotency_key,input_record_ids)
     VALUES($1,$2,$3,$4,$5,'Running',$6,$7::jsonb)`,
    [runId,input.orgId,input.promptVersionId,input.provider,input.model,input.idempotencyKey,JSON.stringify(input.feedbackIds)],
  );
  return { kind:"created", runId };
}

export async function completeModelRun(input: {
  orgId: string;
  runId: string;
  result: AiAnalysisResult;
  context: RequestContext;
}): Promise<StoredAiRun> {
  await transaction(async (client) => {
    for (const analysis of input.result.analyses) {
      await client.query(
        `INSERT INTO ai_feedback_analyses(
          id,org_id,model_run_id,feedback_id,classification,severity,redacted_summary,proposed_problem_id,
          classification_confidence,cluster_confidence,confidence_factors,rationale,evidence
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb)`,
        [
          randomUUID(),input.orgId,input.runId,analysis.feedbackId,analysis.classification,analysis.severity,
          analysis.redactedSummary,analysis.proposedProblemId,analysis.classificationConfidence,analysis.clusterConfidence,
          JSON.stringify({ evidenceQuality:analysis.evidenceQuality, classificationClarity:analysis.classificationClarity, clusterMatch:analysis.clusterMatch, ambiguityPenalty:analysis.ambiguityPenalty }),
          analysis.rationale,JSON.stringify(analysis.evidence),
        ],
      );
    }
    await client.query(
      `UPDATE model_runs SET status='Succeeded',output=$3::jsonb,external_response_id=$4,input_tokens=$5,output_tokens=$6,completed_at=now()
       WHERE org_id=$1 AND id=$2 AND status='Running'`,
      [input.orgId,input.runId,JSON.stringify(input.result.analyses),input.result.responseId,input.result.inputTokens,input.result.outputTokens],
    );
    await client.query(
      `INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id)
       VALUES($1,$2,$3,$4,$5,'ModelRun',$6,$7) ON CONFLICT (org_id,trace_id,action) DO NOTHING`,
      [randomUUID(),input.orgId,input.context.actorId,input.context.actorName,`${input.result.providerLabel} proposed analysis for ${input.result.analyses.length} feedback item${input.result.analyses.length === 1 ? "" : "s"}`,input.runId,input.context.traceId],
    );
  });
  return { runId:input.runId, provider:input.result.provider, providerLabel:input.result.providerLabel, model:input.result.model, replayed:false, analyses:input.result.analyses };
}

export async function failModelRun(orgId: string, runId: string, error: unknown): Promise<void> {
  const safeMessage = error instanceof Error ? error.message.slice(0,500) : "The AI request failed";
  const code = error instanceof Error ? error.name.slice(0,100) : "UnknownError";
  await databasePool().query(
    `UPDATE model_runs SET status='Failed',error_code=$3,error_message=$4,completed_at=now()
     WHERE org_id=$1 AND id=$2 AND status='Running'`,
    [orgId,runId,code,safeMessage],
  );
}
