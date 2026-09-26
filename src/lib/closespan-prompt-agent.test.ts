import { beforeEach, describe, expect, it, vi } from "vitest";

const evaluation = vi.hoisted(() => ({
  run: vi.fn(),
}));
const workflow = vi.hoisted(() => ({
  applyRevision: vi.fn(),
}));

vi.mock("./workspace-prompt-evaluation", () => ({
  evaluateWorkspacePrompt: evaluation.run,
}));
vi.mock("./engineering-workflow-repository", () => ({
  applyPddPromptRevision: workflow.applyRevision,
}));

import {
  CLOSESPAN_PROMPT_AGENT_NAME,
  CLOSESPAN_PROMPT_AGENT_POLICY_VERSION,
} from "./closespan-prompt-agent-policy";
import { testPromptWithCloseSpanAgent } from "./closespan-prompt-agent";
import { applyPromptRevisionWithCloseSpanAgent } from "./closespan-prompt-agent";
import { PDD_CLI_VERSION } from "./pdd-verification";

describe("CloseSpan Prompt Agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is the only application boundary for a PDD-authored revision", async () => {
    const applied = { prompt: { id: "prompt-2" } };
    workflow.applyRevision.mockResolvedValue(applied);
    const actor = {
      actorId: "user-1",
      actorName: "Product manager",
      traceId: "trace-1",
      idempotencyKey: "apply-1",
    };

    await expect(applyPromptRevisionWithCloseSpanAgent({
      orgId: "org-1",
      problemId: "problem-1",
      currentPromptHash: "c".repeat(64),
      revisedPrompt: "A safely reconciled prompt revision.",
      actor,
    })).resolves.toBe(applied);

    expect(workflow.applyRevision).toHaveBeenCalledWith(
      "org-1",
      "problem-1",
      {
        currentPromptHash: "c".repeat(64),
        revisedPrompt: "A safely reconciled prompt revision.",
        source: CLOSESPAN_PROMPT_AGENT_NAME,
      },
      actor,
    );
  });

  it("owns the PDD evaluation and records its versioned policy", async () => {
    evaluation.run.mockResolvedValue({
      verdict: "Passed",
      summary: "Aligned",
      changes: [],
      acceptanceContract: "contract",
      pddVersion: PDD_CLI_VERSION,
      executionMode: "local",
      model: "test-model",
      costUsd: 0,
      promptHash: "a".repeat(64),
    });

    const result = await testPromptWithCloseSpanAgent({
      orgId: "org-1",
      promptHash: "a".repeat(64),
      userStory: "As a user, I want safe prompt testing, so releases are reliable.",
      implementationPrompt: "Implement the approved behavior.",
    });

    expect(evaluation.run).toHaveBeenCalledWith(expect.objectContaining({
      pddVersion: PDD_CLI_VERSION,
    }));
    expect(result.agent).toEqual({
      name: CLOSESPAN_PROMPT_AGENT_NAME,
      policyVersion: CLOSESPAN_PROMPT_AGENT_POLICY_VERSION,
    });
  });

  it("rejects an unsafe instruction-only PDD revision", async () => {
    evaluation.run.mockResolvedValue({
      verdict: "Needs revision",
      summary: "Rewrite required",
      changes: ["Replace the prompt contract with a different section."],
      acceptanceContract: "contract",
      pddVersion: PDD_CLI_VERSION,
      executionMode: "local",
      model: "test-model",
      costUsd: 0,
      promptHash: "b".repeat(64),
    });

    const result = await testPromptWithCloseSpanAgent({
      orgId: "org-1",
      promptHash: "b".repeat(64),
      userStory: "As a user, I want safe prompt testing, so releases are reliable.",
      implementationPrompt: "Implement the approved behavior.",
    });

    expect(result.verdict).toBe("Needs revision");
    expect(result.suggestedRevision).toBeNull();
  });
});
