import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const repository = vi.hoisted(() => ({ review: vi.fn() }));

vi.mock("@/lib/feedback-review-repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/feedback-review-repository")>();
  return { ...original, reviewLatestFeedbackAnalysis: repository.review };
});

import { FeedbackReviewConflictError } from "@/lib/feedback-review-repository";
import { POST } from "./route";

function request(
  body: unknown,
  options: {
    role?: string;
    orgId?: string;
    authenticated?: boolean;
    key?: string;
  } = {},
) {
  return new NextRequest("http://localhost/api/ai/review", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": options.key ?? `review_${crypto.randomUUID()}`,
      "x-test-user-role": options.role ?? "Contributor",
      ...(options.orgId ? { "x-org-id": options.orgId } : {}),
      ...(options.authenticated === false ? { "x-test-auth": "none" } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("AI feedback review route", () => {
  beforeEach(() => {
    process.env.APP_MODE = "demo";
    repository.review.mockReset().mockResolvedValue({
      analysisId: "analysis_1",
      feedbackId: "feedback_1",
      decision: "approve",
      reviewStatus: "Approved",
      problem: { id: "problem_1", title: "Example", stage: "Needs review" },
      createdProblem: true,
      replayed: false,
    });
  });

  it("approves the latest analysis in the authenticated workspace", async () => {
    const response = await POST(request({
      feedbackId: "feedback_1",
      decision: "approve",
      problemId: "problem_existing",
    }, { key: "review_approve_001" }));
    expect(response.status).toBe(200);
    expect(repository.review).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org_northstar",
      feedbackId: "feedback_1",
      decision: "approve",
      problemId: "problem_existing",
      context: expect.objectContaining({ idempotencyKey: "review_approve_001" }),
    }));
  });

  it("allows contributors to reject without a target problem", async () => {
    const response = await POST(request({
      feedbackId: "feedback_1",
      decision: "reject",
    }));
    expect(response.status).toBe(200);
    expect(repository.review).toHaveBeenCalledWith(expect.objectContaining({
      decision: "reject",
      problemId: undefined,
    }));
  });

  it("rejects malformed decisions and target problems on rejection", async () => {
    expect((await POST(request({ feedbackId: "feedback_1", decision: "maybe" }))).status).toBe(400);
    expect((await POST(request({
      feedbackId: "feedback_1",
      decision: "reject",
      problemId: "problem_1",
    }))).status).toBe(400);
    expect(repository.review).not.toHaveBeenCalled();
  });

  it("enforces authentication, membership roles, and tenant scope", async () => {
    expect((await POST(request({
      feedbackId: "feedback_1",
      decision: "approve",
    }, { authenticated: false }))).status).toBe(401);
    expect((await POST(request({
      feedbackId: "feedback_1",
      decision: "approve",
    }, { role: "Viewer" }))).status).toBe(403);
    expect((await POST(request({
      feedbackId: "feedback_1",
      decision: "approve",
    }, { orgId: "org_other" }))).status).toBe(403);
    expect(repository.review).not.toHaveBeenCalled();
  });

  it("returns a safe conflict when the latest analysis was already reviewed", async () => {
    repository.review.mockRejectedValue(
      new FeedbackReviewConflictError("This analysis has already been reviewed"),
    );
    const response = await POST(request({
      feedbackId: "feedback_1",
      decision: "approve",
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "This analysis has already been reviewed",
    });
  });

  it("does not expose database failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    repository.review.mockRejectedValue(
      new Error("duplicate key violates private_internal_constraint"),
    );
    const response = await POST(request({
      feedbackId: "feedback_1",
      decision: "approve",
    }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "This feedback review could not be saved. Try again shortly.",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[feedback-analysis:review]",
      { errorType: "Error" },
    );
    consoleError.mockRestore();
  });
});
