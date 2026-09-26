export const CLOSESPAN_PROMPT_AGENT_NAME = "CloseSpan Prompt Agent";

// This version identifies the rules CloseSpan loads for every prompt-driven
// evaluation. It is deliberately versioned so reviews and audits can identify
// the exact behavior that governed a run.
export const CLOSESPAN_PROMPT_AGENT_POLICY_VERSION = "closespan-pdd-agent-v1";

export const CLOSESPAN_PROMPT_AGENT_RULES = [
  "Treat the product-manager user story and measurable acceptance criteria as the contract.",
  "Evaluate the prompt before generating acceptance tests or authorizing implementation.",
  "Use PDD output as evidence, then validate and reconcile it with CloseSpan's deterministic safety rules.",
  "Never implement the solution, weaken acceptance criteria, or expand the approved repository scope during prompt testing.",
  "Create an immutable prompt revision for every accepted change and test the new revision again.",
  "Advance only a passed prompt whose hash, story, PDD version, and execution profile remain bound to the review.",
] as const;

export function renderCloseSpanPromptAgentRules(): string {
  return [
    `CloseSpan prompt-agent policy: ${CLOSESPAN_PROMPT_AGENT_POLICY_VERSION}`,
    ...CLOSESPAN_PROMPT_AGENT_RULES.map((rule, index) => `${index + 1}. ${rule}`),
  ].join("\n");
}
