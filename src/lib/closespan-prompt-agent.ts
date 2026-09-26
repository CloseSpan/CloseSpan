import {
  CLOSESPAN_PROMPT_AGENT_NAME,
  CLOSESPAN_PROMPT_AGENT_POLICY_VERSION,
} from "./closespan-prompt-agent-policy";
import { PDD_CLI_VERSION } from "./pdd-verification";
import { reconcilePddPromptRevision } from "./pdd-prompt-review";
import { evaluateWorkspacePrompt } from "./workspace-prompt-evaluation";
import {
  applyPddPromptRevision,
  type ActorContext,
} from "./engineering-workflow-repository";

export interface CloseSpanPromptAgentInput {
  orgId: string;
  promptHash: string;
  userStory: string;
  implementationPrompt: string;
  acceptanceContract?: string;
  budgetUsd?: number;
}

/**
 * Single entry point for prompt-driven evaluation. PDD supplies the model
 * judgment; the CloseSpan agent owns policy, reconciliation, and provenance.
 */
export async function testPromptWithCloseSpanAgent(
  input: CloseSpanPromptAgentInput,
) {
  const evaluation = await evaluateWorkspacePrompt({
    ...input,
    pddVersion: PDD_CLI_VERSION,
  });
  const reconciled = reconcilePddPromptRevision({
    implementationPrompt: input.implementationPrompt,
    verdict: evaluation.verdict,
    changes: evaluation.changes,
  });

  return {
    ...evaluation,
    verdict: reconciled.verdict,
    changes: reconciled.changes,
    suggestedRevision: reconciled.suggestedRevision,
    agent: {
      name: CLOSESPAN_PROMPT_AGENT_NAME,
      policyVersion: CLOSESPAN_PROMPT_AGENT_POLICY_VERSION,
    },
  };
}

export async function applyPromptRevisionWithCloseSpanAgent(input: {
  orgId: string;
  problemId: string;
  currentPromptHash: string;
  revisedPrompt: string;
  actor: ActorContext;
}) {
  return applyPddPromptRevision(
    input.orgId,
    input.problemId,
    {
      currentPromptHash: input.currentPromptHash,
      revisedPrompt: input.revisedPrompt,
      source: CLOSESPAN_PROMPT_AGENT_NAME,
    },
    input.actor,
  );
}
