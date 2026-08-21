import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isTrustedTenkiReviewer,
  processTenkiPullRequestReview,
  reviewInstructions,
  type TenkiPullRequestReview,
} from "./tenki-pr-review-automation";

const review: TenkiPullRequestReview = {
  repository: "owner/repo",
  pullRequestNumber: 17,
  pullRequestUrl: "https://github.com/owner/repo/pull/17",
  pullRequestBaseBranch: "main",
  headRef: "closespan/problem-1",
  headSha: "a".repeat(40),
  reviewId: 901,
  reviewerLogin: "tenki-reviewer",
  state: "changes_requested",
  body: "Please handle the empty state.",
  comments: [{
    id: 77,
    body: "This branch needs an explicit empty-state guard.",
    path: "src/feature.ts",
    line: 42,
    side: "RIGHT",
  }],
};

const trackedRun = {
  id: "run-root",
  problem_id: "problem-1",
  prompt_revision_id: "prompt-1",
  approval_id: "approval-1",
  repository: "owner/repo",
  branch_name: "closespan/problem-1",
  prompt_hash: "prompt-hash",
  pdd_verification_id: "verification-1",
  execution_profile_id: "profile-1",
  execution_profile_hash: "profile-hash",
  execution_profile_snapshot: { repository: "owner/repo" },
  prompt_commit_sha: "b".repeat(40),
  implementation_commit_sha: "a".repeat(40),
  parent_run_id: null,
  allowed_capabilities: ["repository.read", "repository.write"],
};

function queryResult<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

function database() {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    void params;
    if (sql.includes("SELECT state FROM tenki_pr_review_cycles")) return queryResult([]);
    if (sql.includes("FROM agent_runs run")) return queryResult([trackedRun]);
    if (sql.includes("count(*) FILTER")) return queryResult([{ cycles: "0", active: false }]);
    return queryResult([]);
  });
  return { client: { query } as unknown as PoolClient, query };
}

describe("Tenki pull request review automation", () => {
  afterEach(() => {
    delete process.env.TENKI_REVIEWER_LOGIN;
    delete process.env.TENKI_REVIEW_MAX_CYCLES;
  });

  it("trusts only the configured Tenki reviewer identity", () => {
    process.env.TENKI_REVIEWER_LOGIN = "tenki-review-bot";
    expect(isTrustedTenkiReviewer("TENKI-REVIEW-BOT")).toBe(true);
    expect(isTrustedTenkiReviewer("unrelated-reviewer")).toBe(false);
  });

  it("turns the review summary and inline findings into bounded remediation instructions", () => {
    expect(reviewInstructions(review)).toContain("Tenki review 901 requested changes");
    expect(reviewInstructions(review)).toContain("src/feature.ts:42");
    expect(reviewInstructions(review)).toContain("GitHub comment 77");
  });

  it("supersedes the old exact-head approval and queues one correction on the same PR branch", async () => {
    const db = database();

    const result = await processTenkiPullRequestReview(db.client, "org-1", review);

    expect(result).toEqual({
      outcome: "tenki_pr_review_correction_queued",
      queuedRun: { orgId: "org-1", runId: expect.any(String) },
    });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status='Superseded'"),
      ["org-1", "owner/repo", 17, "a".repeat(40)],
    );
    const remediationInsert = db.query.mock.calls.find(([sql]) => (
      typeof sql === "string" && sql.includes("INSERT INTO agent_runs")
    ));
    expect(remediationInsert?.[1]).toEqual(expect.arrayContaining([
      "owner/repo",
      "closespan/problem-1",
      "a".repeat(40),
      17,
      "https://github.com/owner/repo/pull/17",
      "main",
    ]));
  });

  it("records exact-head Tenki approval without starting another coding run", async () => {
    const db = database();

    const result = await processTenkiPullRequestReview(db.client, "org-1", {
      ...review,
      reviewId: 902,
      state: "approved",
      body: "Approved after corrections.",
      comments: [],
    });

    expect(result).toEqual({ outcome: "tenki_pr_review_approved" });
    expect(db.query.mock.calls.some(([sql]) => (
      typeof sql === "string" && sql.includes("INSERT INTO agent_runs")
    ))).toBe(false);
    expect(db.query.mock.calls.some(([sql]) => (
      typeof sql === "string" && sql.includes("'Approved'")
    ))).toBe(true);
  });
});
