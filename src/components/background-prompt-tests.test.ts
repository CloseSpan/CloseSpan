import { describe, expect, it, vi } from "vitest";
import type { EngineeringWorkflowView } from "@/lib/engineering-workflow-repository";
import type { PromptTestResult } from "./background-prompt-tests";
import {
  prepareAgentApproval,
  promptPreparationLabel,
} from "./background-prompt-tests";

const emptyWorkflow = (): EngineeringWorkflowView => ({
  problemId: "prob_1",
  specification: null,
  readiness: { ready: true, issues: [] },
  prompt: null,
  verification: null,
  approval: null,
  finalApproval: null,
  run: null,
  releaseEvidence: null,
});

function evaluation(verdict: "Passed" | "Needs revision"): PromptTestResult {
  return {
    workflow: emptyWorkflow(),
    evaluationId: `evaluation_${verdict === "Passed" ? "passed" : "revision"}`,
    timing: {
      estimatedDurationMs: 1_000,
      averageDurationMs: 1_000,
      sampleCount: 1,
      durationMs: 500,
    },
    promptEvaluation: {
      verdict,
      summary: verdict === "Passed" ? "Ready" : "One change required",
      changes: verdict === "Passed" ? [] : ["Clarify the acceptance result"],
      suggestedRevision: verdict === "Passed" ? null : "Revised immutable prompt",
      pddVersion: "0.0.309",
      executionMode: "cloud",
      model: "test-model",
      costUsd: 0,
      promptHash: (verdict === "Passed" ? "b" : "a").repeat(64),
      alignmentReceipt: verdict === "Passed" ? "alignment-receipt" : null,
      revisionReceipt: verdict === "Passed" ? null : "revision-receipt",
    },
  };
}

describe("automatic agent approval preparation", () => {
  it("leaves a manual Prompt Testing revision ready for explicit user application", async () => {
    const request = vi.fn(async () => evaluation("Needs revision")) as unknown as
      <T>(path: string, orgId: string, body?: unknown) => Promise<T>;

    const result = await prepareAgentApproval({
      orgId: "org_1",
      problemId: "prob_1",
      userStory: "As a user, I want the input to work, so that I can finish.",
      triggerSource: "manual",
      request,
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(result.promptEvaluation.verdict).toBe("Needs revision");
    expect(result.promptEvaluation.suggestedRevision).toBe("Revised immutable prompt");
  });

  it("runs Prompt Testing once, applies one immutable revision, and prepares approval without retesting", async () => {
    const phases: string[] = [];
    const appliedWorkflow = {
      ...emptyWorkflow(),
      prompt: {
        id: "prompt_2",
        revision: 2,
        status: "Ready" as const,
        artifactPath: "tickets/prompt.md",
        content: "Revised immutable prompt",
        contentHash: "b".repeat(64),
        repository: "closespan/app",
        baseBranch: "main",
        baseSha: "c".repeat(40),
        createdAt: "2026-08-11T12:00:00.000Z",
      },
    };
    const responses: unknown[] = [
      evaluation("Needs revision"),
      { workflow: appliedWorkflow, alignmentReceipt: "applied-alignment-receipt" },
      {
        workflow: {
          ...appliedWorkflow,
          approval: {
            id: "approval_2",
            status: "Pending",
            expiresAt: "2026-08-11T12:00:00.000Z",
            promptHash: "b".repeat(64),
            repository: "closespan/app",
            baseBranch: "main",
            baseSha: "c".repeat(40),
            allowedCapabilities: ["repository:read"],
          },
        },
        storyTest: {
          id: "verification_2",
          status: "Ready for approval",
          message: "Executable contract ready",
          promptHash: "b".repeat(64),
        },
      },
    ];
    const requestedPaths: string[] = [];
    const requestMock = vi.fn(async (path: string) => {
      requestedPaths.push(path);
      return responses.shift();
    });
    const request = requestMock as unknown as
      <T>(path: string, orgId: string, body?: unknown) => Promise<T>;

    const result = await prepareAgentApproval({
      orgId: "org_1",
      problemId: "prob_1",
      userStory: "As a user, I want the input to work, so that I can finish.",
      triggerSource: "automatic",
      onPhase: (phase) => phases.push(phase),
      request,
    });

    expect(requestMock).toHaveBeenCalledTimes(3);
    expect(requestedPaths).toEqual([
      "/api/problems/prob_1/engineering/test-story",
      "/api/problems/prob_1/engineering/apply-pdd-revision",
      "/api/problems/prob_1/engineering/generate-acceptance",
    ]);
    expect(phases).toEqual(["applying-revision", "generating-contract"]);
    expect(result.workflow.prompt?.revision).toBe(2);
    expect(result.workflow.approval?.status).toBe("Pending");
    expect(result.promptEvaluation.verdict).toBe("Passed");
  });

  it("creates the first human gate when the single Prompt Testing evaluation passes", async () => {
    const pendingWorkflow = {
      ...emptyWorkflow(),
      approval: {
        id: "approval_2",
        status: "Pending" as const,
        expiresAt: "2026-08-11T12:00:00.000Z",
        promptHash: "b".repeat(64),
        repository: "closespan/app",
        baseBranch: "main",
        baseSha: "c".repeat(40),
        allowedCapabilities: ["repository:read"],
      },
    };
    const responses: unknown[] = [
      evaluation("Passed"),
      {
        workflow: pendingWorkflow,
        storyTest: {
          id: "verification_2",
          status: "Ready for approval",
          message: "Executable contract ready",
          promptHash: "b".repeat(64),
        },
      },
    ];
    const request = vi.fn(async () => responses.shift()) as unknown as
      <T>(path: string, orgId: string, body?: unknown) => Promise<T>;

    const result = await prepareAgentApproval({
      orgId: "org_1",
      problemId: "prob_1",
      userStory: "As a user, I want the input to work, so that I can finish.",
      triggerSource: "automatic",
      request,
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/api/problems/prob_1/engineering/generate-acceptance",
      "org_1",
      {
        evaluationId: "evaluation_passed",
        userStory: "As a user, I want the input to work, so that I can finish.",
        alignmentReceipt: "alignment-receipt",
      },
    );
    expect(result.workflow.approval?.status).toBe("Pending");
  });

  it("uses action-oriented labels for every automated phase", () => {
    expect(promptPreparationLabel("evaluating")).toBe("Evaluating the suggested prompt");
    expect(promptPreparationLabel("waiting-for-approval")).toBe("Creating the agent execution approval");
  });
});
