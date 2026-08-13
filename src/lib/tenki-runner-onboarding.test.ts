import { beforeEach, describe, expect, it, vi } from "vitest";

const workflow = vi.hoisted(() => ({ install: vi.fn() }));
const setups = vi.hoisted(() => ({
  get: vi.fn(),
  preparing: vi.fn(),
  pending: vi.fn(),
  installed: vi.fn(),
  failed: vi.fn(),
}));

vi.mock("./tenki-github-actions-workflow", () => ({
  installTenkiRunnerWorkflow: workflow.install,
  TENKI_RUNNER_WORKFLOW_PATH: ".github/workflows/closespan-agent-runner.yml",
}));
vi.mock("./tenki-runner-workflow-setup-repository", () => ({
  getTenkiRunnerWorkflowSetup: setups.get,
  markTenkiRunnerWorkflowSetupPreparing: setups.preparing,
  savePendingTenkiRunnerWorkflowSetup: setups.pending,
  markTenkiRunnerWorkflowSetupInstalled: setups.installed,
  markTenkiRunnerWorkflowSetupFailed: setups.failed,
}));
vi.mock("./execution-profile-repository", () => ({
  listExecutionProfileSettings: vi.fn(),
  confirmDetectedExecutionProfile: vi.fn(),
}));
vi.mock("./tenki-environment-catalog-repository", () => ({
  assertManagedTenkiBootSourceAllowed: vi.fn(),
}));

import {
  prepareDetectedTenkiRunner,
  repositoryDetectionNeedsTenki,
} from "./tenki-runner-onboarding";
import type { GithubRepositoryProfileDetection } from "./repository-profile-detection";

function detection(platform: "generic" | "ios" | "android"): GithubRepositoryProfileDetection {
  return {
    repository: "acme/app",
    defaultBranch: "main",
    sourceSha: "c".repeat(40),
    profiles: [{ platform } as GithubRepositoryProfileDetection["profiles"][number]],
    evidence: {
      treeEntriesInspected: 1,
      treeRequests: 1,
      manifestFilesRead: 1,
      manifestBytesRead: 10,
      limitsReached: false,
    },
  };
}

describe("Tenki repository onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setups.get.mockResolvedValue(null);
    setups.preparing.mockResolvedValue(undefined);
    setups.pending.mockResolvedValue(undefined);
    setups.installed.mockResolvedValue(undefined);
    setups.failed.mockResolvedValue(undefined);
  });

  it("only requires a setup pull request for detected runner platforms", () => {
    expect(repositoryDetectionNeedsTenki(detection("generic"))).toBe(false);
    expect(repositoryDetectionNeedsTenki(detection("ios"))).toBe(true);
    expect(repositoryDetectionNeedsTenki(detection("android"))).toBe(true);
  });

  it("prepares and persists the approval-ready setup pull request", async () => {
    workflow.install.mockResolvedValue({
      status: "pull_request",
      workflowPath: ".github/workflows/closespan-agent-runner.yml",
      pullRequestNumber: 12,
      pullRequestUrl: "https://github.example/pull/12",
    });
    setups.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: "Pending", repository: "acme/app" });

    await prepareDetectedTenkiRunner({
      orgId: "org-1",
      installationId: "42",
      repository: "acme/app",
      defaultBranch: "main",
      detection: detection("ios"),
    });

    expect(setups.preparing).toHaveBeenCalledWith(expect.objectContaining({
      repository: "acme/app",
    }));
    expect(setups.pending).toHaveBeenCalledWith(expect.objectContaining({
      pullRequestNumber: 12,
      pullRequestUrl: "https://github.example/pull/12",
    }));
  });
});
