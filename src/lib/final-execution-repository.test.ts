import type { Octokit } from "@octokit/rest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  finalExecutionScopeAllowsApproval,
  mergeApprovedPullRequest,
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
});
