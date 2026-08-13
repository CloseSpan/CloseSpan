import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const repositories = vi.hoisted(() => ({ list: vi.fn() }));
const github = vi.hoisted(() => ({ verify: vi.fn(), assertPermissions: vi.fn() }));
const workflow = vi.hoisted(() => ({ merge: vi.fn() }));
const audit = vi.hoisted(() => ({ record: vi.fn() }));
const runnerSetups = vi.hoisted(() => ({ markInstalled: vi.fn() }));
const detection = vi.hoisted(() => ({ detect: vi.fn(), activate: vi.fn(), probes: vi.fn() }));
const matches = vi.hoisted(() => ({ refresh: vi.fn() }));
const repositoryContext = vi.hoisted(() => ({ queue: vi.fn(), build: vi.fn() }));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (work: () => unknown) => work() };
});

vi.mock("@/lib/github-repository-allowlist", () => ({
  listGithubRepositoryAuthorizations: repositories.list,
}));
vi.mock("@/lib/github-app-auth", () => ({
  verifyGithubInstallation: github.verify,
  assertTenkiGithubActionsPermissions: github.assertPermissions,
}));
vi.mock("@/lib/tenki-github-actions-workflow", () => ({
  approveAndMergeTenkiRunnerWorkflow: workflow.merge,
}));
vi.mock("@/lib/tenki-runner-setup-approval-repository", () => ({
  recordTenkiRunnerSetupApprovalEvent: audit.record,
}));
vi.mock("@/lib/tenki-runner-workflow-setup-repository", () => ({
  markTenkiRunnerWorkflowSetupInstalled: runnerSetups.markInstalled,
}));
vi.mock("@/lib/repository-profile-detection", () => ({
  detectAndSaveGithubRepositoryProfiles: detection.detect,
}));
vi.mock("@/lib/tenki-runner-onboarding", () => ({
  activateReadyDetectedExecutionProfiles: detection.activate,
  prepareTenkiRunnerSizingProbes: detection.probes,
}));
vi.mock("@/lib/problem-repository-match-repository", () => ({
  refreshPendingProblemRepositoryMatches: matches.refresh,
}));
vi.mock("@/lib/repository-context-repository", () => ({
  queueRepositoryContexts: repositoryContext.queue,
  buildQueuedRepositoryContexts: repositoryContext.build,
}));

import { POST } from "./route";

function request(repository: string, pullRequestNumber: number, role = "Admin") {
  return new NextRequest("http://localhost/api/settings/execution-profiles/approve-runner-workflow", {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "content-type": "application/json",
      "idempotency-key": `runner_merge_${crypto.randomUUID().replaceAll("-", "")}`,
      "x-test-auth": "user",
      "x-test-user-org-id": "org-1",
      "x-test-user-role": role,
    },
    body: JSON.stringify({ repository, pullRequestNumber }),
  });
}

describe("Tenki runner workflow approval API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repositories.list.mockResolvedValue([{
      id: "repo-1",
      installationId: "42",
      repository: "acme/app",
      defaultBranch: "main",
      active: true,
    }]);
    github.verify.mockResolvedValue({ permissions: {
      contents: "write",
      pull_requests: "write",
      actions: "write",
      workflows: "write",
    } });
    workflow.merge.mockResolvedValue({
      status: "merged",
      workflowPath: ".github/workflows/closespan-agent-runner.yml",
      pullRequestNumber: 12,
      pullRequestUrl: "https://github.example/pull/12",
      mergedSha: "c".repeat(40),
      githubActionsChecksPassed: 1,
    });
    audit.record.mockResolvedValue(undefined);
    runnerSetups.markInstalled.mockResolvedValue(undefined);
    detection.detect.mockResolvedValue({ sourceSha: "c".repeat(40), profiles: [] });
    detection.activate.mockResolvedValue(1);
    detection.probes.mockResolvedValue([]);
    matches.refresh.mockResolvedValue([]);
    repositoryContext.queue.mockResolvedValue(undefined);
    repositoryContext.build.mockResolvedValue(undefined);
  });

  it("records explicit admin approval before merging the allowlisted setup PR", async () => {
    const response = await POST(request("acme/app", 12));

    expect(response.status).toBe(200);
    expect(audit.record.mock.invocationCallOrder[0]).toBeLessThan(
      workflow.merge.mock.invocationCallOrder[0],
    );
    expect(audit.record).toHaveBeenNthCalledWith(1, expect.objectContaining({
      orgId: "org-1",
      repository: "acme/app",
      pullRequestNumber: 12,
      event: "approved",
    }));
    expect(workflow.merge).toHaveBeenCalledWith({
      installationId: "42",
      repository: "acme/app",
      defaultBranch: "main",
      pullRequestNumber: 12,
    });
    expect(audit.record).toHaveBeenNthCalledWith(2, expect.objectContaining({
      event: "merged",
      mergedSha: "c".repeat(40),
    }));
    expect(runnerSetups.markInstalled).toHaveBeenCalledWith({
      orgId: "org-1",
      repository: "acme/app",
      workflowPath: ".github/workflows/closespan-agent-runner.yml",
      pullRequestNumber: 12,
      pullRequestUrl: "https://github.example/pull/12",
      mergedSha: "c".repeat(40),
    });
    expect(detection.detect).toHaveBeenCalledWith(expect.objectContaining({
      repository: "acme/app",
    }));
    expect(detection.activate).toHaveBeenCalledWith(expect.objectContaining({
      repository: "acme/app",
    }));
    expect(repositoryContext.queue).toHaveBeenCalledWith(expect.objectContaining({
      repositories: [{ repository: "acme/app", defaultBranch: "main" }],
    }));
  });

  it("fails closed outside the repository allowlist or admin role", async () => {
    expect((await POST(request("other/app", 12))).status).toBe(404);
    expect((await POST(request("acme/app", 12, "Contributor"))).status).toBe(403);
    expect(workflow.merge).not.toHaveBeenCalled();
  });

  it("records a failed approved merge without hiding the GitHub error", async () => {
    workflow.merge.mockRejectedValue(new Error("Wait for GitHub Actions to finish: CI"));
    const response = await POST(request("acme/app", 12));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Wait for GitHub Actions to finish: CI",
    });
    expect(audit.record).toHaveBeenLastCalledWith(expect.objectContaining({
      event: "failed",
      failureMessage: "Wait for GitHub Actions to finish: CI",
    }));
  });
});
