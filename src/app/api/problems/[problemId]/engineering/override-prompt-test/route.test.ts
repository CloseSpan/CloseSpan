import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const workflow = vi.hoisted(() => ({ get: vi.fn() }));
const evaluation = vi.hoisted(() => ({
  read: vi.fn(),
  override: vi.fn(),
}));
const receipts = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/lib/engineering-workflow-repository", () => ({
  getEngineeringWorkflow: workflow.get,
}));
vi.mock("@/lib/pdd-prompt-evaluation-repository", () => ({
  readPddPromptEvaluation: evaluation.read,
  overridePddPromptEvaluation: evaluation.override,
}));
vi.mock("@/lib/prompt-alignment-receipt", () => ({
  createPromptAlignmentReceipt: receipts.create,
}));

import { POST } from "./route";

const problemId = "prob_1";
const evaluationId = "11111111-1111-4111-8111-111111111111";
const promptRevisionId = "22222222-2222-4222-8222-222222222222";
const promptHash = "a".repeat(64);
const userStory = "As a user, I want undo, so that I can restore my caption.";

function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest(`http://localhost/api/problems/${problemId}/engineering/override-prompt-test`, {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "content-type": "application/json",
      "idempotency-key": `override_${crypto.randomUUID().replaceAll("-", "")}`,
      "x-test-auth": "user",
      "x-test-user-org-id": "org-1",
      "x-test-user-id": "user-1",
      "x-test-user-name": "Avery Chen",
    },
    body: JSON.stringify({
      evaluationId,
      userStory,
      currentPromptHash: promptHash,
      ...overrides,
    }),
  });
}

describe("Prompt Testing override API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workflow.get.mockResolvedValue({
      prompt: { id: promptRevisionId, contentHash: promptHash },
      promptEvaluation: { id: evaluationId },
    });
    evaluation.read.mockResolvedValue({
      id: evaluationId,
      promptHash,
      userStory,
      status: "Succeeded",
      review: { verdict: "Needs revision" },
    });
    evaluation.override.mockResolvedValue({
      verdict: "Passed",
      override: { actorId: "user-1", actorName: "Avery Chen" },
    });
    receipts.create.mockReturnValue("signed-alignment-receipt");
  });

  it("records the override and returns an alignment receipt for the current prompt", async () => {
    const response = await POST(request({ reason: "The current prompt is sufficient." }), {
      params: Promise.resolve({ problemId }),
    });

    expect(response.status).toBe(200);
    expect(evaluation.override).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      problemId,
      evaluationId,
      promptHash,
      actorId: "user-1",
      actorName: "Avery Chen",
      reason: "The current prompt is sufficient.",
    }));
    expect(receipts.create).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      problemId,
      promptHash,
    }));
    await expect(response.json()).resolves.toMatchObject({
      alignmentReceipt: "signed-alignment-receipt",
      review: { verdict: "Passed" },
    });
  });

  it("refuses to override a stale prompt evaluation", async () => {
    evaluation.read.mockResolvedValue({
      id: evaluationId,
      promptHash: "b".repeat(64),
      userStory,
      status: "Succeeded",
      review: { verdict: "Needs revision" },
    });

    const response = await POST(request(), {
      params: Promise.resolve({ problemId }),
    });

    expect(response.status).toBe(409);
    expect(evaluation.override).not.toHaveBeenCalled();
  });

  it("replays an already recorded override without creating a second audit event", async () => {
    evaluation.read.mockResolvedValue({
      id: evaluationId,
      promptHash,
      userStory,
      status: "Succeeded",
      review: {
        verdict: "Passed",
        override: {
          actorId: "user-1",
          actorName: "Avery Chen",
          reason: "The current prompt is sufficient.",
          occurredAt: "2026-08-14T12:00:00.000Z",
        },
      },
    });

    const response = await POST(request(), {
      params: Promise.resolve({ problemId }),
    });

    expect(response.status).toBe(200);
    expect(evaluation.override).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      alignmentReceipt: "signed-alignment-receipt",
      review: { verdict: "Passed" },
    });
  });
});
