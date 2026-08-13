import { getAiRuntimeConfiguration } from "./ai-config";
import {
  evaluatePromptWithPdd,
  type PddPromptEvaluationResult,
} from "./pdd-runner-client";
import { readPromptEvaluationMode } from "./workspace-settings-repository";

export async function evaluateWorkspacePrompt(input: {
  orgId: string;
  promptHash: string;
  userStory: string;
  implementationPrompt: string;
  acceptanceContract?: string;
  pddVersion: string;
  budgetUsd?: number;
}): Promise<PddPromptEvaluationResult> {
  const evaluationMode = await readPromptEvaluationMode(input.orgId);
  const configuration = evaluationMode === "pdd_cloud"
    ? null
    : await getAiRuntimeConfiguration(input.orgId);

  if (evaluationMode === "pdd_local" && !configuration?.apiKey) {
    throw new Error(
      "Configure an AI provider for this workspace before using local Prompt Driven evaluation",
    );
  }

  return evaluatePromptWithPdd({
    promptHash: input.promptHash,
    userStory: input.userStory,
    implementationPrompt: input.implementationPrompt,
    acceptanceContract: input.acceptanceContract,
    pddVersion: input.pddVersion,
    evaluationMode,
    budgetUsd: input.budgetUsd,
    localRuntime: configuration?.apiKey
      ? configuration.keySource === "environment"
        ? {
            provider: configuration.provider,
            model: configuration.model,
            credentialSource: "runner" as const,
          }
        : {
            provider: configuration.provider,
            model: configuration.model,
            apiKey: configuration.apiKey,
          }
      : undefined,
  });
}
