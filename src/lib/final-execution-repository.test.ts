import type { Octokit } from "@octokit/rest";
import type { PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  finalExecutionScopeAllowsApproval,
  mergeApprovedPullRequest,
  prepareAgentMergeFollowUps,
} from "./final-execution-repository";
import { parseReleaseVerificationPlan, releaseVerificationPlanSchema } from "./release-verification-plan";

const github = {
  get: vi.fn(),
  merge: vi.fn(),
  graphql: vi.fn(),
};

function client(): Octokit {
  return {
    rest: {
      pulls: {
        get: github.get,
        merge: github.merge,
      },
    },
    graphql: github.graphql,
  } as unknown as Octokit;
}

const input = {
  repository: "acme/api",
  baseBranch: "main",
  pullRequestNumber: 42,
  expectedHeadSha: "a".repeat(40),
};

describe("final pull request execution", () => {
  beforeEach(() => {
    github.get.mockReset();
    github.merge.mockReset();
    github.graphql.mockReset();
  });

  it("makes the reviewed draft ready and merges only its bound commit", async () => {
    github.get.mockResolvedValue({
      data: {
        state: "open",
        draft: true,
        node_id: "PR_node_42",
        html_url: "https://github.com/acme/api/pull/42",
        base: { ref: "main" },
        head: { sha: input.expectedHeadSha },
      },
    });
    github.graphql.mockResolvedValue({});
    github.merge.mockResolvedValue({
      data: { merged: true, sha: "b".repeat(40), message: "Pull Request successfully merged" },
    });

    await expect(mergeApprovedPullRequest("123", input, { createClient: client }))
      .resolves.toEqual({
        sha: "b".repeat(40),
        url: "https://github.com/acme/api/pull/42",
      });
    expect(github.graphql).toHaveBeenCalledWith(
      expect.stringContaining("markPullRequestReadyForReview"),
      { id: "PR_node_42" },
    );
    expect(github.merge).toHaveBeenCalledWith(expect.objectContaining({
      owner: "acme",
      repo: "api",
      pull_number: 42,
      sha: input.expectedHeadSha,
      merge_method: "squash",
    }));
  });

  it("refuses a PR whose head changed after review", async () => {
    github.get.mockResolvedValue({
      data: {
        state: "open",
        draft: false,
        node_id: "PR_node_42",
        html_url: "https://github.com/acme/api/pull/42",
        base: { ref: "main" },
        head: { sha: "c".repeat(40) },
      },
    });

    await expect(mergeApprovedPullRequest("123", input, { createClient: client }))
      .rejects.toThrow("changed; a new verified agent run is required");
    expect(github.graphql).not.toHaveBeenCalled();
    expect(github.merge).not.toHaveBeenCalled();
  });

  it("preserves GitHub branch protection failures as a failed execution", async () => {
    github.get.mockResolvedValue({
      data: {
        state: "open",
        draft: false,
        node_id: "PR_node_42",
        html_url: "https://github.com/acme/api/pull/42",
        base: { ref: "main" },
        head: { sha: input.expectedHeadSha },
      },
    });
    github.merge.mockResolvedValue({
      data: { merged: false, sha: null, message: "Required status check is pending" },
    });

    await expect(mergeApprovedPullRequest("123", input, { createClient: client }))
      .rejects.toThrow("Required status check is pending");
  });

  it("blocks only an explicit incompatible verification-scope assessment", () => {
    expect(finalExecutionScopeAllowsApproval(null)).toBe(true);
    expect(finalExecutionScopeAllowsApproval({ schemaVersion: 1 })).toBe(true);
    expect(finalExecutionScopeAllowsApproval({
      releaseVerificationScope: { compatible: true },
    })).toBe(true);
    expect(finalExecutionScopeAllowsApproval({
      releaseVerificationScope: { compatible: false },
    })).toBe(false);
    const frontendOnly = releaseVerificationPlanSchema.parse({
      ...parseReleaseVerificationPlan("default"),
      requirements: { backend: "not_required", frontend: "required" },
    });
    expect(finalExecutionScopeAllowsApproval({
      releaseVerificationPlan: frontendOnly,
      changedFiles: ["src/app/api/orders/route.ts"],
    })).toBe(false);
  });

  it("prepares one idempotent follow-up draft per affected customer after merge", async () => {
    const query = vi.fn(async (statement: unknown) => {
      const normalized = typeof statement === "string" ? statement.replace(/\s+/g, " ") : "";
      if (normalized.includes("SELECT DISTINCT feedback.customer_name")) {
        return {
          rows: [{ customer_name: "Acme" }, { customer_name: "Globex" }],
          rowCount: 2,
        };
      }
      return { rows: [{ id: "created" }], rowCount: 1 };
    });

    await expect(prepareAgentMergeFollowUps(
      { query } as unknown as PoolClient,
      {
        orgId: "org-1",
        problemId: "problem-1",
        repository: "acme/api",
        pullRequestNumber: 42,
        mergeSha: "b".repeat(40),
      },
    )).resolves.toBe(2);

    expect(query.mock.calls.filter(([statement]) =>
      typeof statement === "string" && statement.includes("INSERT INTO customer_notifications"),
    )).toHaveLength(2);
    expect(query.mock.calls.filter(([statement]) =>
      typeof statement === "string" && statement.includes("'CustomerNotification'"),
    )).toHaveLength(1);
    expect(query.mock.calls.some(([statement]) =>
      typeof statement === "string" && statement.includes("UPDATE workspaces SET version=version+1"),
    )).toBe(true);
  });

  it("does not duplicate or re-audit already prepared merge follow-ups", async () => {
    const query = vi.fn(async (statement: unknown) => {
      const normalized = typeof statement === "string" ? statement.replace(/\s+/g, " ") : "";
      if (normalized.includes("SELECT DISTINCT feedback.customer_name")) {
        return { rows: [{ customer_name: "Acme" }], rowCount: 1 };
      }
      if (normalized.includes("INSERT INTO customer_notifications")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(prepareAgentMergeFollowUps(
      { query } as unknown as PoolClient,
      {
        orgId: "org-1",
        problemId: "problem-1",
        repository: "acme/api",
        pullRequestNumber: 42,
        mergeSha: "b".repeat(40),
      },
    )).resolves.toBe(0);
    expect(query.mock.calls.some(([statement]) =>
      typeof statement === "string" && statement.includes("UPDATE workspaces SET version=version+1"),
    )).toBe(false);
  });
});
