import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const workflow = vi.hoisted(() => ({
  failVerification: vi.fn(),
  generateAcceptance: vi.fn(),
  get: vi.fn(),
  getExecutionContext: vi.fn(),
  markGenerating: vi.fn(),
}));
const evaluation = vi.hoisted(() => ({
  clearFailure: vi.fn(),
  recordFailure: vi.fn(),
}));
const runner = vi.hoisted(() => ({
  assertConfigured: vi.fn(),
  configured: vi.fn(),
  dispatch: vi.fn(),
}));

vi.mock("@/lib/engineering-workflow-repository", () => ({
  failPddVerification: workflow.failVerification,
  generatePddAcceptanceContract: workflow.generateAcceptance,
  getEngineeringWorkflow: workflow.get,
  getPddVerificationExecutionContext: workflow.getExecutionContext,
  markPddVerificationGenerating: workflow.markGenerating,
}));
vi.mock("@/lib/pdd-prompt-evaluation-repository", () => ({
  clearPddAcceptancePreparationFailure: evaluation.clearFailure,
  recordPddAcceptancePreparationFailure: evaluation.recordFailure,
}));
vi.mock("@/lib/pdd-runner-client", () => ({
  assertPddRunnerConfigured: runner.assertConfigured,
  dispatchPddVerification: runner.dispatch,
  pddRunnerConfigured: runner.configured,
}));
vi.mock("@/lib/prompt-alignment-receipt", () => ({
  assertPromptAlignmentReceipt: vi.fn(),
}));
vi.mock("@/lib/workspace-settings-repository", () => ({
  readAutonomyLevel: vi.fn(async () => "Execute with approval"),
}));

import { POST } from "./route";

const evaluationId = "11111111-1111-4111-8111-111111111111";
const promptRevisionId = "22222222-2222-4222-8222-222222222222";
const problemId = "prob_1";

function request() {
  return new NextRequest(`http://localhost/api/problems/${problemId}/engineering/generate-acceptance`, {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "content-type": "application/json",
      "idempotency-key": `accept_${crypto.randomUUID().replaceAll("-", "")}`,
      "x-test-auth": "user",
      "x-test-user-org-id": "org-1",
    },
    body: JSON.stringify({
      evaluationId,
      userStory: "As a user, I want the input to work, so that I can finish.",
      alignmentReceipt: "signed-receipt",
    }),
  });
}

describe("Prompt Testing acceptance generation API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workflow.get.mockResolvedValue({
      prompt: {
        id: promptRevisionId,
        contentHash: "a".repeat(64),
      },
    });
    runner.configured.mockReturnValue(false);
    evaluation.clearFailure.mockResolvedValue(undefined);
    evaluation.recordFailure.mockResolvedValue(undefined);
  });

  it("saves the execution-profile blocker on the passed prompt evaluation", async () => {
    const message = "Confirm this ticket's repository and an active execution profile before Prompt Testing.";
    workflow.generateAcceptance.mockRejectedValue(new Error(message));

    const response = await POST(request(), {
      params: Promise.resolve({ problemId }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: message });
    expect(evaluation.recordFailure).toHaveBeenCalledWith({
      orgId: "org-1",
      problemId,
      evaluationId,
      promptRevisionId,
      message,
    });
    expect(evaluation.clearFailure).not.toHaveBeenCalled();
  });

  it("clears a stale preparation blocker after acceptance generation succeeds", async () => {
    workflow.generateAcceptance.mockResolvedValue({
      workflow: { approval: { status: "Pending" } },
      storyTest: { id: "verification_1", status: "Ready for approval" },
    });

    const response = await POST(request(), {
      params: Promise.resolve({ problemId }),
    });

    expect(response.status).toBe(200);
    expect(evaluation.clearFailure).toHaveBeenCalledWith({
      orgId: "org-1",
      problemId,
      evaluationId,
      promptRevisionId,
    });
    expect(evaluation.recordFailure).not.toHaveBeenCalled();
  });
});
