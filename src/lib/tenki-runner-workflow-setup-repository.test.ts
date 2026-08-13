import { beforeEach, describe, expect, it } from "vitest";
import {
  listPendingTenkiRunnerWorkflowSetups,
  listTenkiRunnerWorkflowSetups,
  markTenkiRunnerWorkflowSetupFailed,
  markTenkiRunnerWorkflowSetupPreparing,
  markTenkiRunnerWorkflowSetupInstalled,
  resetMemoryTenkiRunnerWorkflowSetups,
  savePendingTenkiRunnerWorkflowSetup,
} from "./tenki-runner-workflow-setup-repository";

describe("Tenki runner workflow setup state", () => {
  beforeEach(() => resetMemoryTenkiRunnerWorkflowSetups());

  it("keeps the approval-ready pull request visible across settings reloads", async () => {
    await savePendingTenkiRunnerWorkflowSetup({
      orgId: "org_demo",
      repository: "acme/app",
      workflowPath: ".github/workflows/closespan-agent-runner.yml",
      pullRequestNumber: 12,
      pullRequestUrl: "https://github.example/pull/12",
    });

    await expect(listPendingTenkiRunnerWorkflowSetups("org_demo"))
      .resolves.toMatchObject([{
        repository: "acme/app",
        pullRequestNumber: 12,
        pullRequestUrl: "https://github.example/pull/12",
      }]);
  });

  it("removes a merged setup from the pending approval list", async () => {
    await savePendingTenkiRunnerWorkflowSetup({
      orgId: "org_demo",
      repository: "acme/app",
      workflowPath: ".github/workflows/closespan-agent-runner.yml",
      pullRequestNumber: 12,
      pullRequestUrl: "https://github.example/pull/12",
    });
    await markTenkiRunnerWorkflowSetupInstalled({
      orgId: "org_demo",
      repository: "acme/app",
      workflowPath: ".github/workflows/closespan-agent-runner.yml",
      pullRequestNumber: 12,
      pullRequestUrl: "https://github.example/pull/12",
      mergedSha: "c".repeat(40),
    });

    await expect(listPendingTenkiRunnerWorkflowSetups("org_demo"))
      .resolves.toEqual([]);
  });

  it("persists background preparation and an actionable failure", async () => {
    await markTenkiRunnerWorkflowSetupPreparing({
      orgId: "org_demo",
      repository: "acme/app",
      workflowPath: ".github/workflows/closespan-agent-runner.yml",
    });
    await expect(listTenkiRunnerWorkflowSetups("org_demo"))
      .resolves.toMatchObject([{ status: "Preparing", failureMessage: null }]);

    await markTenkiRunnerWorkflowSetupFailed({
      orgId: "org_demo",
      repository: "acme/app",
      workflowPath: ".github/workflows/closespan-agent-runner.yml",
      failureMessage: "GitHub workflow permission is missing",
    });
    await expect(listTenkiRunnerWorkflowSetups("org_demo"))
      .resolves.toMatchObject([{
        status: "Failed",
        failureMessage: "GitHub workflow permission is missing",
      }]);
  });
});
