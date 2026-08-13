import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  client: { query: vi.fn() },
  transaction: vi.fn(),
}));

vi.mock("./db", () => ({
  persistenceMode: () => "postgres",
  transaction: database.transaction,
}));

import {
  FeedbackReviewConflictError,
  reviewLatestFeedbackAnalysis,
} from "./feedback-review-repository";
import type { RequestContext } from "./request-security";

const context: RequestContext = {
  orgId: "org_test",
  organizationName: "Test workspace",
  actorId: "user_test",
  actorName: "Test User",
  actorEmail: "test@example.com",
  role: "Contributor",
  idempotencyKey: "review_test_001",
  traceId: "trace_test_001",
};

const analysis = {
  id: "analysis_test",
  feedback_id: "feedback_test",
  classification: "Bug",
  severity: "High",
  redacted_summary: "Export fails on Safari.",
  proposed_problem_id: null,
  classification_confidence: 0.82,
  cluster_confidence: 0,
  review_status: "Proposed",
};

const sqlIncludes = (sql: unknown, text: string) =>
  typeof sql === "string" && sql.replace(/\s+/g, " ").includes(text);

describe("feedback analysis review transaction", () => {
  beforeEach(() => {
    database.client.query.mockReset();
    database.transaction.mockReset().mockImplementation(
      async (work: (client: typeof database.client) => Promise<unknown>) =>
        work(database.client),
    );
  });

  it("creates a minimal Needs review problem and links feedback when no match exists", async () => {
    database.client.query.mockImplementation(async (sql: unknown) => {
      if (sqlIncludes(sql, "SELECT action FROM idempotency_keys"))
        return { rows: [] };
      if (sqlIncludes(sql, "FROM ai_feedback_analyses analysis"))
        return { rows: [analysis] };
      if (sqlIncludes(sql, "UPDATE ai_feedback_analyses"))
        return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });

    const result = await reviewLatestFeedbackAnalysis({
      orgId: "org_test",
      feedbackId: "feedback_test",
      decision: "approve",
      context,
    });

    expect(result.createdProblem).toBe(true);
    expect(result.problem).toMatchObject({
      title: "Export fails on Safari",
      stage: "Needs review",
    });
    expect(database.client.query.mock.calls.some(([sql]) =>
      sqlIncludes(sql, "INSERT INTO product_problems"))).toBe(true);
    expect(database.client.query.mock.calls.some(([sql, values]) =>
      sqlIncludes(sql, "INSERT INTO feedback_cluster_memberships") &&
      values[0] === "org_test" && values[2] === "feedback_test")).toBe(true);
    expect(database.client.query.mock.calls.some(([sql, values]) =>
      sqlIncludes(sql, "INSERT INTO audit_events") &&
      values[1] === "org_test" && values[2] === "user_test")).toBe(true);
  });

  it("links to a tenant-scoped existing problem without creating another", async () => {
    const proposed = { ...analysis, proposed_problem_id: "problem_existing", cluster_confidence: 0.74 };
    database.client.query.mockImplementation(async (sql: unknown) => {
      if (sqlIncludes(sql, "SELECT action FROM idempotency_keys"))
        return { rows: [] };
      if (sqlIncludes(sql, "FROM ai_feedback_analyses analysis"))
        return { rows: [proposed] };
      if (sqlIncludes(sql, "FROM product_problems") && sqlIncludes(sql, "FOR UPDATE"))
        return { rows: [{ id: "problem_existing", title: "Existing problem", stage: "Detected" }] };
      if (sqlIncludes(sql, "UPDATE ai_feedback_analyses"))
        return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });

    const result = await reviewLatestFeedbackAnalysis({
      orgId: "org_test",
      feedbackId: "feedback_test",
      decision: "approve",
      context,
    });

    expect(result).toMatchObject({
      createdProblem: false,
      problem: { id: "problem_existing" },
    });
    expect(database.client.query.mock.calls.some(([sql]) =>
      sqlIncludes(sql, "INSERT INTO product_problems"))).toBe(false);
  });

  it("reuses an identical active problem when the AI candidate snapshot was stale", async () => {
    database.client.query.mockImplementation(async (sql: unknown) => {
      if (sqlIncludes(sql, "SELECT action FROM idempotency_keys"))
        return { rows: [] };
      if (sqlIncludes(sql, "FROM ai_feedback_analyses analysis"))
        return { rows: [analysis] };
      if (sqlIncludes(sql, "stage <> 'Closed'") && sqlIncludes(sql, "lower(title)=lower"))
        return { rows: [{ id: "problem_existing", title: "Export fails on Safari", stage: "Needs review" }] };
      if (sqlIncludes(sql, "UPDATE ai_feedback_analyses"))
        return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });

    const result = await reviewLatestFeedbackAnalysis({
      orgId: "org_test",
      feedbackId: "feedback_test",
      decision: "approve",
      context,
    });

    expect(result).toMatchObject({
      createdProblem: false,
      problem: { id: "problem_existing" },
    });
    expect(database.client.query.mock.calls.some(([sql]) =>
      sqlIncludes(sql, "INSERT INTO product_problems"))).toBe(false);
  });

  it("rejects the latest proposal without creating a membership", async () => {
    database.client.query.mockImplementation(async (sql: unknown) => {
      if (sqlIncludes(sql, "SELECT action FROM idempotency_keys"))
        return { rows: [] };
      if (sqlIncludes(sql, "FROM ai_feedback_analyses analysis"))
        return { rows: [analysis] };
      if (sqlIncludes(sql, "UPDATE ai_feedback_analyses"))
        return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });

    const result = await reviewLatestFeedbackAnalysis({
      orgId: "org_test",
      feedbackId: "feedback_test",
      decision: "reject",
      context,
    });

    expect(result).toMatchObject({
      decision: "reject",
      reviewStatus: "Rejected",
      problem: null,
    });
    expect(database.client.query.mock.calls.some(([sql]) =>
      sqlIncludes(sql, "INSERT INTO feedback_cluster_memberships"))).toBe(false);
  });

  it("replays the recorded result and rejects reuse for a different request", async () => {
    const stored = JSON.stringify({
      type: "feedback-analysis-review",
      version: 1,
      analysisId: "analysis_test",
      feedbackId: "feedback_test",
      decision: "approve",
      requestedProblemId: "problem_existing",
      targetProblemId: "problem_existing",
      createdProblem: false,
    });
    database.client.query.mockImplementation(async (sql: unknown) => {
      if (sqlIncludes(sql, "SELECT action FROM idempotency_keys"))
        return { rows: [{ action: stored }] };
      if (sqlIncludes(sql, "SELECT review_status FROM ai_feedback_analyses"))
        return { rows: [{ review_status: "Approved" }] };
      if (sqlIncludes(sql, "FROM product_problems"))
        return { rows: [{ id: "problem_existing", title: "Existing", stage: "Detected" }] };
      return { rows: [] };
    });

    const replay = await reviewLatestFeedbackAnalysis({
      orgId: "org_test",
      feedbackId: "feedback_test",
      decision: "approve",
      problemId: "problem_existing",
      context,
    });
    expect(replay).toMatchObject({ replayed: true, createdProblem: false });
    expect(database.client.query.mock.calls.some(([sql]) =>
      sqlIncludes(sql, "INSERT INTO audit_events"))).toBe(false);

    await expect(reviewLatestFeedbackAnalysis({
      orgId: "org_test",
      feedbackId: "feedback_test",
      decision: "reject",
      context,
    })).rejects.toBeInstanceOf(FeedbackReviewConflictError);
  });
});
