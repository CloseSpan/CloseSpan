import { beforeEach, describe, expect, it } from "vitest";
import { sha256 } from "./pdd-verification";
import {
  beginPddPromptEvaluation,
  completePddPromptEvaluation,
  clearPddAcceptancePreparationFailure,
  markPddPromptEvaluationApplied,
  recordPddAcceptancePreparationFailure,
  readPddAcceptanceContract,
  readPddPromptEvaluation,
  resetMemoryPddPromptEvaluations,
} from "./pdd-prompt-evaluation-repository";

const baseInput = {
  orgId: "org_demo",
  problemId: "prob_demo_export",
  specificationId: "spec_1",
  specificationRevision: 1,
  promptRevisionId: "prompt_1",
  promptHash: "a".repeat(64),
  userStory: "As a user, I want exports to work, so that reporting completes.",
  storyHash: sha256("As a user, I want exports to work, so that reporting completes."),
} as const;

describe("PDD prompt evaluation runs", () => {
  beforeEach(() => resetMemoryPddPromptEvaluations());

  it("allows only one automatic attempt for a ticket specification revision", async () => {
    const first = await beginPddPromptEvaluation({
      ...baseInput,
      triggerSource: "automatic",
    });
    const second = await beginPddPromptEvaluation({
      ...baseInput,
      promptRevisionId: "prompt_2",
      promptHash: "b".repeat(64),
      triggerSource: "automatic",
    });

    expect(first.shouldRun).toBe(true);
    expect(second.shouldRun).toBe(false);
    expect(second.evaluation.id).toBe(first.evaluation.id);
  });

  it("keeps manual evaluations explicit and repeatable", async () => {
    const first = await beginPddPromptEvaluation({
      ...baseInput,
      triggerSource: "manual",
    });
    const second = await beginPddPromptEvaluation({
      ...baseInput,
      triggerSource: "manual",
    });

    expect(first.shouldRun).toBe(true);
    expect(second.shouldRun).toBe(true);
    expect(second.evaluation.id).not.toBe(first.evaluation.id);
  });

  it("surfaces the saved review on the immutable revision that PDD applied", async () => {
    const run = await beginPddPromptEvaluation({
      ...baseInput,
      triggerSource: "automatic",
    });
    await completePddPromptEvaluation(baseInput.orgId, run.evaluation.id, {
      verdict: "Needs revision",
      summary: "One change is required.",
      changes: ["Clarify the expected result."],
      acceptanceContract: "## Context\nStable PDD contract.",
      suggestedRevision: "Clarified immutable prompt",
      pddVersion: "0.0.309",
      executionMode: "cloud",
      model: "test-model",
      costUsd: 0,
      promptHash: baseInput.promptHash,
      alignmentReceipt: null,
      revisionReceipt: "short-lived-receipt",
    });
    await markPddPromptEvaluationApplied(
      baseInput.orgId,
      run.evaluation.id,
      "prompt_2",
    );

    const saved = await readPddPromptEvaluation(
      baseInput.orgId,
      baseInput.problemId,
      "prompt_2",
    );
    expect(saved?.status).toBe("Succeeded");
    expect(saved?.applied).toBe(true);
    expect(saved?.automaticAttempted).toBe(true);
    expect(saved?.review?.summary).toBe("One change is required.");
    expect(saved?.review?.revisionReceipt).toBeNull();
    await expect(readPddAcceptanceContract(
      baseInput.orgId,
      baseInput.problemId,
      "prompt_2",
    )).resolves.toBe("## Context\nStable PDD contract.");
  });

  it("persists and clears an acceptance-preparation blocker independently of alignment", async () => {
    const run = await beginPddPromptEvaluation({
      ...baseInput,
      triggerSource: "manual",
    });
    await completePddPromptEvaluation(baseInput.orgId, run.evaluation.id, {
      verdict: "Passed",
      summary: "The prompt and user story are aligned.",
      changes: [],
      acceptanceContract: "## Contract\nAligned.",
      suggestedRevision: null,
      pddVersion: "0.0.309",
      executionMode: "local",
      model: null,
      costUsd: 0,
      promptHash: baseInput.promptHash,
      alignmentReceipt: "short-lived-receipt",
      revisionReceipt: null,
    });
    const target = {
      orgId: baseInput.orgId,
      problemId: baseInput.problemId,
      evaluationId: run.evaluation.id,
      promptRevisionId: baseInput.promptRevisionId,
    };
    await recordPddAcceptancePreparationFailure({
      ...target,
      message: "Confirm the repository and an active execution profile.",
    });

    const blocked = await readPddPromptEvaluation(
      baseInput.orgId,
      baseInput.problemId,
      baseInput.promptRevisionId,
    );
    expect(blocked?.review?.verdict).toBe("Passed");
    expect(blocked?.acceptancePreparationFailureMessage).toBe(
      "Confirm the repository and an active execution profile.",
    );

    await clearPddAcceptancePreparationFailure(target);
    await expect(readPddPromptEvaluation(
      baseInput.orgId,
      baseInput.problemId,
      baseInput.promptRevisionId,
    )).resolves.toMatchObject({
      acceptancePreparationFailureMessage: null,
    });
  });
});
