import { z } from "zod";

export const promptEvaluationModes = [
  "pdd_cloud",
  "pdd_local",
  "pdd_cloud_with_local_fallback",
] as const;

export const promptEvaluationModeSchema = z.enum(promptEvaluationModes);
export type PromptEvaluationMode = z.infer<typeof promptEvaluationModeSchema>;

export const DEFAULT_PROMPT_EVALUATION_MODE: PromptEvaluationMode =
  "pdd_cloud_with_local_fallback";

export function normalizePromptEvaluationMode(
  value: unknown,
): PromptEvaluationMode {
  const parsed = promptEvaluationModeSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_PROMPT_EVALUATION_MODE;
}
