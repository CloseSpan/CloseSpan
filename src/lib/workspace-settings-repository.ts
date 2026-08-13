import { randomUUID } from "node:crypto";
import { z } from "zod";
import { databasePool, transaction } from "./db";
import {
  defaultPromptDraftPolicy,
  sanitizePromptDraftPolicy,
  type PromptDraftPolicy,
} from "./prompt-draft-policy";
import { workspacePersistenceMode } from "./workspace-persistence";
import {
  autonomyLevels,
  normalizeAutonomyLevel,
  type AutonomyLevel,
} from "./autonomy-policy";
import {
  DEFAULT_PROMPT_EVALUATION_MODE,
  normalizePromptEvaluationMode,
  promptEvaluationModeSchema,
  type PromptEvaluationMode,
} from "./prompt-evaluation-policy";
import { getAiPublicConfiguration } from "./ai-config";

const policySchema = z.object({
  autonomyLevel: z.enum(autonomyLevels),
  piiRedaction: z.boolean(),
  retentionDays: z.number().int().min(1).max(3650),
  priorityWeights: z.record(z.string(), z.number().int().min(0).max(100)),
  promptDraftPolicy: z.unknown(),
  promptEvaluationMode: promptEvaluationModeSchema.default(
    DEFAULT_PROMPT_EVALUATION_MODE,
  ),
}).superRefine((value, context) => {
  const total = Object.values(value.priorityWeights).reduce((sum, weight) => sum + weight, 0);
  if (total !== 100) context.addIssue({ code: "custom", path: ["priorityWeights"], message: "Priority weights must total 100%." });
});

export interface WorkspacePolicyInput {
  autonomyLevel: AutonomyLevel;
  piiRedaction: boolean;
  retentionDays: number;
  priorityWeights: Record<string, number>;
  promptDraftPolicy: PromptDraftPolicy;
  promptEvaluationMode: PromptEvaluationMode;
}

export interface WorkspaceSettingsActor {
  actorId: string;
  actorName: string;
  traceId: string;
}

const memoryPolicies = new Map<string, WorkspacePolicyInput>();

export function sanitizeWorkspacePolicy(input: unknown): WorkspacePolicyInput {
  const parsed = policySchema.parse(input);
  const promptDraftPolicy = sanitizePromptDraftPolicy(parsed.promptDraftPolicy);
  return {
    ...parsed,
    promptDraftPolicy: parsed.autonomyLevel === "Full autonomy"
      ? { ...promptDraftPolicy, mode: "automatic" }
      : promptDraftPolicy,
  };
}

export async function readAutonomyLevel(orgId: string): Promise<AutonomyLevel> {
  if (workspacePersistenceMode(orgId) === "memory") {
    return normalizeAutonomyLevel(
      getMemoryWorkspacePolicy(orgId)?.autonomyLevel ?? "Execute with approval",
    );
  }
  const result = await databasePool().query<{ autonomy_level: string }>(
    "SELECT autonomy_level FROM workspace_settings WHERE org_id=$1",
    [orgId],
  );
  return normalizeAutonomyLevel(result.rows[0]?.autonomy_level);
}

export async function readPromptEvaluationMode(
  orgId: string,
): Promise<PromptEvaluationMode> {
  if (workspacePersistenceMode(orgId) === "memory") {
    return normalizePromptEvaluationMode(
      getMemoryWorkspacePolicy(orgId)?.promptEvaluationMode,
    );
  }
  const result = await databasePool().query<{ prompt_evaluation_mode: string }>(
    "SELECT prompt_evaluation_mode FROM workspace_settings WHERE org_id=$1",
    [orgId],
  );
  return normalizePromptEvaluationMode(result.rows[0]?.prompt_evaluation_mode);
}

export function getMemoryWorkspacePolicy(orgId: string): WorkspacePolicyInput | null {
  const policy = memoryPolicies.get(orgId);
  return policy ? structuredClone(policy) : null;
}

export async function updateWorkspacePolicy(
  orgId: string,
  input: unknown,
  actor: WorkspaceSettingsActor,
): Promise<WorkspacePolicyInput> {
  const policy = sanitizeWorkspacePolicy(input);
  if (policy.promptEvaluationMode === "pdd_local") {
    const ai = await getAiPublicConfiguration(orgId);
    if (!ai.configured) {
      throw new WorkspaceSettingsError(
        "Configure a workspace AI provider before selecting local Prompt Driven evaluation.",
        409,
      );
    }
  }
  if (workspacePersistenceMode(orgId) === "memory") {
    memoryPolicies.set(orgId, structuredClone(policy));
    return policy;
  }
  await transaction(async (client) => {
    if (policy.promptDraftPolicy.reviewerId) {
      const reviewer = await client.query(
        "SELECT 1 FROM workspace_members WHERE org_id=$1 AND id=$2",
        [orgId, policy.promptDraftPolicy.reviewerId],
      );
      if (reviewer.rowCount !== 1) throw new WorkspaceSettingsError("The selected reviewer is not a member of this workspace.", 400);
    }
    const updated = await client.query(
      `UPDATE workspace_settings SET
         autonomy_level=$2,pii_redaction=$3,retention_days=$4,priority_weights=$5,
         prompt_draft_mode=$6,prompt_draft_bug_reports=$7,
         prompt_draft_feature_requests=$8,prompt_draft_min_evidence=$9,
         prompt_draft_min_confidence=$10,prompt_draft_notify_in_app=$11,
         prompt_draft_notify_email=$12,prompt_draft_reviewer_id=$13,
         prompt_evaluation_mode=$14,updated_at=now()
       WHERE org_id=$1`,
      [
        orgId,
        policy.autonomyLevel,
        policy.piiRedaction,
        policy.retentionDays,
        JSON.stringify(policy.priorityWeights),
        policy.promptDraftPolicy.mode,
        policy.promptDraftPolicy.bugReports,
        policy.promptDraftPolicy.featureRequests,
        policy.promptDraftPolicy.minimumEvidence,
        policy.promptDraftPolicy.minimumConfidence,
        policy.promptDraftPolicy.inAppNotifications,
        policy.promptDraftPolicy.emailNotifications,
        policy.promptDraftPolicy.reviewerId,
        policy.promptEvaluationMode,
      ],
    );
    if (updated.rowCount !== 1) throw new WorkspaceSettingsError("Workspace settings were not found.", 404);
    await client.query(
      `INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id)
       VALUES($1,$2,$3,$4,$5,'WorkspaceSettings',$2,$6)
       ON CONFLICT (org_id,trace_id,action) DO NOTHING`,
      [
        randomUUID(),
        orgId,
        actor.actorId,
        actor.actorName,
        `Updated workspace policy to ${policy.autonomyLevel}; prompt drafting is ${policy.promptDraftPolicy.mode}; prompt evaluation is ${policy.promptEvaluationMode}`,
        `${actor.traceId}_workspace_policy`,
      ],
    );
    await client.query("UPDATE workspaces SET version=version+1,updated_at=now() WHERE org_id=$1", [orgId]);
  });
  return policy;
}

export async function readPromptDraftPolicy(orgId: string): Promise<PromptDraftPolicy> {
  if (workspacePersistenceMode(orgId) === "memory")
    return getMemoryWorkspacePolicy(orgId)?.promptDraftPolicy ?? structuredClone(defaultPromptDraftPolicy);
  const result = await databasePool().query<{
    prompt_draft_mode: PromptDraftPolicy["mode"];
    prompt_draft_bug_reports: boolean;
    prompt_draft_feature_requests: boolean;
    prompt_draft_min_evidence: number;
    prompt_draft_min_confidence: number;
    prompt_draft_notify_in_app: boolean;
    prompt_draft_notify_email: boolean;
    prompt_draft_reviewer_id: string | null;
  }>(
    `SELECT prompt_draft_mode,prompt_draft_bug_reports,prompt_draft_feature_requests,
            prompt_draft_min_evidence,prompt_draft_min_confidence,
            prompt_draft_notify_in_app,prompt_draft_notify_email,prompt_draft_reviewer_id
       FROM workspace_settings WHERE org_id=$1`,
    [orgId],
  );
  const row = result.rows[0];
  if (!row) return structuredClone(defaultPromptDraftPolicy);
  return {
    mode: row.prompt_draft_mode,
    bugReports: row.prompt_draft_bug_reports,
    featureRequests: row.prompt_draft_feature_requests,
    minimumEvidence: row.prompt_draft_min_evidence,
    minimumConfidence: row.prompt_draft_min_confidence,
    inAppNotifications: row.prompt_draft_notify_in_app,
    emailNotifications: row.prompt_draft_notify_email,
    reviewerId: row.prompt_draft_reviewer_id,
  };
}

export class WorkspaceSettingsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
