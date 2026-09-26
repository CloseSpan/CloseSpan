export const AUTOMATIC_PROMPT_POLICY = "Automatic coding, human merge";
export const AUTOMATIC_PROMPT_ACTIVATION_ACTION = "Enabled automatic coding with human merge";
export const MAX_PROMPT_REVIEW_EVALUATIONS = 3;

export interface AutomaticPromptAcceptance {
  kind: "automatic_prompt_acceptance";
  policy: typeof AUTOMATIC_PROMPT_POLICY;
  receiptId: string;
  activationId: string;
  promptHash: string;
  userStory: string;
  reviewVersion: number;
  leaseId: string;
}

/** Trusted SQL identifiers only. The receipt never substitutes for human confirmation. */
export function automaticPromptAcceptanceSql(reviewAlias: string, promptHashSql: string): string {
  const receipt = `${reviewAlias}.evaluation->'policyAcceptance'`;
  return `COALESCE((${reviewAlias}.status IN ('Preparing tests','Awaiting approval')
    AND ${reviewAlias}.prompt_hash=${promptHashSql}
    AND ${reviewAlias}.evaluation->>'verdict'='Passed'
    AND ${reviewAlias}.evaluation->'changes'='[]'::jsonb
    AND ${receipt}->>'kind'='automatic_prompt_acceptance'
    AND ${receipt}->>'policy'='${AUTOMATIC_PROMPT_POLICY}'
    AND ${receipt}->>'promptHash'=${promptHashSql}
    AND ${receipt}->>'userStory'=${reviewAlias}.user_story
    AND EXISTS (
      SELECT 1 FROM audit_events policy_receipt
      JOIN workspace_settings policy_settings ON policy_settings.org_id=policy_receipt.org_id
      JOIN LATERAL (
        SELECT activation.id,activation.occurred_at FROM audit_events activation
        WHERE activation.org_id=policy_settings.org_id AND activation.entity_type='WorkspaceSettings'
          AND activation.entity_id=policy_settings.org_id
          AND activation.action='${AUTOMATIC_PROMPT_ACTIVATION_ACTION}'
        ORDER BY activation.occurred_at DESC,activation.id DESC LIMIT 1
      ) active_policy ON true
      WHERE policy_receipt.org_id=${reviewAlias}.org_id
        AND policy_receipt.entity_type='ProblemPromptPolicyAcceptance'
        AND policy_receipt.entity_id=${reviewAlias}.problem_id
        AND policy_receipt.actor_id='agent_prompt_review'
        AND policy_receipt.id::text=${receipt}->>'receiptId'
        AND policy_receipt.trace_id=${receipt}->>'leaseId'
        AND policy_receipt.action=(${receipt})::text
        AND policy_receipt.occurred_at >= active_policy.occurred_at
        AND active_policy.id::text=${receipt}->>'activationId'
        AND policy_settings.autonomy_level='${AUTOMATIC_PROMPT_POLICY}'
    )),false)`;
}
