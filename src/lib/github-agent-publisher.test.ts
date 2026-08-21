import type { Octokit } from "@octokit/rest";
import { describe, expect, it, vi } from "vitest";
import type { AgentImplementationReport } from "./agent-run-verification";
import type { AgentRunExecutionContext } from "./engineering-workflow-repository";
import { publishAgentRun, publishTenkiReviewRemediation } from "./github-agent-publisher";

const context = {
  repository: "owner/repo",
  installationId: "installation-1",
  baseBranch: "main",
  baseSha: "base-sha",
  branchName: "closespan/change",
  problemId: "problem-1",
  promptArtifactPath: ".prompt/problem-1.prompt",
  promptContent: "approved prompt",
  approvalId: "approval-1",
  promptHash: "prompt-hash",
  promptSnapshot: { evidence: { title: "Add a feature" } },
  runId: "run-1",
} as AgentRunExecutionContext;

const report = {
  schemaVersion: 1,
  runId: "00000000-0000-4000-8000-000000000001",
  promptHash: "a".repeat(64),
  promptArtifactHash: "a".repeat(64),
  baseSha: "b".repeat(40),
  status: "Tests passed",
  summary: "Implemented the approved change.",
  criteria: [],
  tests: [],
  testFiles: [],
  remainingRisks: [],
  assumptions: [],
  manualVerification: [],
  logs: [],
  changedFiles: [{
    path: "src/feature.ts",
    contentBase64: Buffer.from("export const feature = true;\n").toString("base64"),
    reason: "Implements the approved behavior.",
  }],
} satisfies AgentImplementationReport;

function githubClient(input?: { comments?: Array<{ body: string | null }> }) {
  const createComment = vi.fn().mockResolvedValue({ data: { id: 1 } });
  const getRef = vi.fn()
    .mockResolvedValueOnce({ data: { object: { sha: "base-sha" } } })
    .mockRejectedValueOnce(Object.assign(new Error("Not Found"), { status: 404 }));
  const client = {
    paginate: vi.fn().mockResolvedValue(input?.comments ?? []),
    rest: {
      git: {
        getRef,
        getCommit: vi.fn().mockResolvedValue({ data: { tree: { sha: "base-tree" }, parents: [] } }),
        createBlob: vi.fn().mockResolvedValueOnce({ data: { sha: "prompt-blob" } }).mockResolvedValue({ data: { sha: "implementation-blob" } }),
        createTree: vi.fn().mockResolvedValueOnce({ data: { sha: "prompt-tree" } }).mockResolvedValue({ data: { sha: "implementation-tree" } }),
        createCommit: vi.fn().mockResolvedValueOnce({ data: { sha: "prompt-commit" } }).mockResolvedValue({ data: { sha: "implementation-commit" } }),
        createRef: vi.fn().mockResolvedValue({ data: {} }),
      },
      pulls: {
        list: vi.fn().mockResolvedValue({ data: [] }),
        create: vi.fn().mockResolvedValue({ data: { number: 8, html_url: "https://github.com/owner/repo/pull/8" } }),
      },
      issues: {
        listComments: vi.fn(),
        createComment,
      },
    },
  };
  return { client: client as unknown as Octokit, createComment };
}

describe("GitHub agent publisher", () => {
  it("requests one Tenki review after opening a draft pull request", async () => {
    const github = githubClient();

    await publishAgentRun(context, report, { createClient: () => github.client });

    expect(github.createComment).toHaveBeenCalledWith(expect.objectContaining({
      owner: "owner",
      repo: "repo",
      issue_number: 8,
      body: expect.stringContaining("@tenki-reviewer"),
    }));
  });

  it("does not request a second paid review when the CloseSpan marker already exists", async () => {
    const github = githubClient({
      comments: [{ body: "<!-- closespan:tenki-code-review-request:v1 -->\n@tenki-reviewer" }],
    });

    await publishAgentRun(context, report, { createClient: () => github.client });

    expect(github.createComment).not.toHaveBeenCalled();
  });

  it("does not fail draft publication when the Tenki review request is temporarily unavailable", async () => {
    const github = githubClient();
    vi.mocked(github.client.rest.issues.createComment).mockRejectedValueOnce(new Error("Tenki trigger unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(publishAgentRun(context, report, { createClient: () => github.client })).resolves.toEqual(
      expect.objectContaining({
        pullRequestNumber: 8,
        pullRequestUrl: "https://github.com/owner/repo/pull/8",
      }),
    );
    expect(warn).toHaveBeenCalledWith(
      "Unable to request automatic Tenki code review",
      expect.objectContaining({ pullRequestNumber: 8 }),
    );
    warn.mockRestore();
  });

  it("publishes Tenki corrections to the existing branch, replies, resolves, and requests re-review", async () => {
    const createComment = vi.fn().mockResolvedValue({ data: { id: 2 } });
    const createReply = vi.fn().mockResolvedValue({ data: { id: 3 } });
    const updateRef = vi.fn().mockResolvedValue({ data: {} });
    const graphql = vi.fn(async (query: string) => {
      if (query.includes("query CloseSpanReviewThreads")) {
        return {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [{
                  id: "thread-77",
                  isResolved: false,
                  comments: { nodes: [{ databaseId: 77 }] },
                }],
              },
            },
          },
        };
      }
      return { resolveReviewThread: { thread: { id: "thread-77", isResolved: true } } };
    });
    const client = {
      paginate: vi.fn().mockResolvedValue([]),
      graphql,
      rest: {
        git: {
          getRef: vi.fn().mockResolvedValue({ data: { object: { sha: "reviewed-head" } } }),
          getCommit: vi.fn().mockResolvedValue({ data: { tree: { sha: "reviewed-tree" }, parents: [] } }),
          createBlob: vi.fn().mockResolvedValue({ data: { sha: "correction-blob" } }),
          createTree: vi.fn().mockResolvedValue({ data: { sha: "correction-tree" } }),
          createCommit: vi.fn().mockResolvedValue({ data: { sha: "corrected-head" } }),
          updateRef,
        },
        pulls: {
          get: vi.fn().mockResolvedValue({
            data: {
              state: "open",
              head: { ref: "closespan/change", sha: "reviewed-head" },
              base: { ref: "main" },
            },
          }),
          createReplyForReviewComment: createReply,
        },
        issues: {
          listComments: vi.fn(),
          createComment,
        },
      },
    } as unknown as Octokit;
    const remediationContext = {
      ...context,
      runKind: "tenki_review_remediation",
      baseBranch: "closespan/change",
      baseSha: "reviewed-head",
      pullRequestNumber: 8,
      pullRequestUrl: "https://github.com/owner/repo/pull/8",
      pullRequestBaseBranch: "main",
      reviewCycle: 1,
      reviewId: 901,
      reviewCommentIds: [77],
      sourcePromptCommitSha: "prompt-commit",
    } satisfies AgentRunExecutionContext;

    await expect(publishTenkiReviewRemediation(
      remediationContext,
      report,
      { createClient: () => client },
    )).resolves.toEqual(expect.objectContaining({
      implementationCommitSha: "corrected-head",
      pullRequestNumber: 8,
      tenkiReviewRequested: true,
    }));
    expect(updateRef).toHaveBeenCalledWith(expect.objectContaining({
      ref: "heads/closespan/change",
      sha: "corrected-head",
      force: false,
    }));
    expect(createReply).toHaveBeenCalledWith(expect.objectContaining({
      pull_number: 8,
      comment_id: 77,
    }));
    expect(graphql).toHaveBeenCalledWith(
      expect.stringContaining("resolveReviewThread"),
      { threadId: "thread-77" },
    );
    expect(createComment).toHaveBeenCalledWith(expect.objectContaining({
      issue_number: 8,
      body: expect.stringContaining("cycle=1"),
    }));
  });
});
