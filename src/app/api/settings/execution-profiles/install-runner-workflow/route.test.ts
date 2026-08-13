import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const repositories = vi.hoisted(() => ({ list: vi.fn() }));
const github = vi.hoisted(() => ({ verify: vi.fn(), assertPermissions: vi.fn() }));
const installer = vi.hoisted(() => ({ install: vi.fn() }));
const runnerSetups = vi.hoisted(() => ({
  save: vi.fn(),
  preparing: vi.fn(),
  failed: vi.fn(),
  installed: vi.fn(),
}));
const detector = vi.hoisted(() => ({ detect: vi.fn() }));
const activation = vi.hoisted(() => ({ activate: vi.fn(), probes: vi.fn() }));

vi.mock("@/lib/github-repository-allowlist", () => ({
  listGithubRepositoryAuthorizations: repositories.list,
}));
vi.mock("@/lib/github-app-auth", () => ({
  verifyGithubInstallation: github.verify,
  assertTenkiGithubActionsPermissions: github.assertPermissions,
}));
vi.mock("@/lib/tenki-github-actions-workflow", () => ({
  installTenkiRunnerWorkflow: installer.install,
}));
vi.mock("@/lib/tenki-runner-workflow-setup-repository", () => ({
  savePendingTenkiRunnerWorkflowSetup: runnerSetups.save,
  markTenkiRunnerWorkflowSetupPreparing: runnerSetups.preparing,
  markTenkiRunnerWorkflowSetupFailed: runnerSetups.failed,
  markTenkiRunnerWorkflowSetupInstalled: runnerSetups.installed,
}));
vi.mock("@/lib/repository-profile-detection", () => ({
  detectAndSaveGithubRepositoryProfiles: detector.detect,
}));
vi.mock("@/lib/tenki-runner-onboarding", () => ({
  activateReadyDetectedExecutionProfiles: activation.activate,
  prepareTenkiRunnerSizingProbes: activation.probes,
}));

import { POST } from "./route";

function request(repository: string, role = "Admin") {
  return new NextRequest("http://localhost/api/settings/execution-profiles/install-runner-workflow", {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "content-type": "application/json",
      "idempotency-key": `runner_${crypto.randomUUID().replaceAll("-", "")}`,
      "x-test-auth": "user",
      "x-test-user-org-id": "org-1",
      "x-test-user-role": role,
    },
    body: JSON.stringify({ repository }),
  });
}

describe("Tenki runner workflow installation API", () => {
  beforeEach(() => {
    repositories.list.mockReset().mockResolvedValue([{
      id: "repo-1",
      installationId: "42",
      repository: "acme/app",
      defaultBranch: "main",
      active: true,
    }]);
    github.verify.mockReset().mockResolvedValue({ permissions: {
      actions: "write",
      workflows: "write",
    } });
    github.assertPermissions.mockReset();
    installer.install.mockReset().mockResolvedValue({
      status: "pull_request",
      workflowPath: ".github/workflows/closespan-agent-runner.yml",
      pullRequestNumber: 12,
      pullRequestUrl: "https://github.example/pull/12",
    });
    runnerSetups.save.mockReset().mockResolvedValue(undefined);
    runnerSetups.preparing.mockReset().mockResolvedValue(undefined);
    runnerSetups.failed.mockReset().mockResolvedValue(undefined);
    runnerSetups.installed.mockReset().mockResolvedValue(undefined);
    detector.detect.mockReset().mockResolvedValue({ sourceSha: "c".repeat(40) });
    activation.activate.mockReset().mockResolvedValue(1);
    activation.probes.mockReset().mockResolvedValue([]);
  });

  it("installs only into an explicitly authorized repository", async () => {
    const response = await POST(request("acme/app"));
    expect(response.status).toBe(200);
    expect(github.verify).toHaveBeenCalledWith("42");
    expect(github.assertPermissions).toHaveBeenCalledWith({
      actions: "write",
      workflows: "write",
    });
    expect(installer.install).toHaveBeenCalledWith({
      installationId: "42",
      repository: "acme/app",
      defaultBranch: "main",
    });
    expect(runnerSetups.preparing).toHaveBeenCalledWith({
      orgId: "org-1",
      repository: "acme/app",
      workflowPath: ".github/workflows/closespan-agent-runner.yml",
    });
    expect(runnerSetups.save).toHaveBeenCalledWith({
      orgId: "org-1",
      repository: "acme/app",
      workflowPath: ".github/workflows/closespan-agent-runner.yml",
      pullRequestNumber: 12,
      pullRequestUrl: "https://github.example/pull/12",
    });
  });

  it("rejects repositories outside the GitHub App allowlist", async () => {
    const response = await POST(request("attacker/repository"));
    expect(response.status).toBe(404);
    expect(installer.install).not.toHaveBeenCalled();
  });

  it("requires workspace administrator access", async () => {
    const response = await POST(request("acme/app", "Contributor"));
    expect(response.status).toBe(403);
    expect(installer.install).not.toHaveBeenCalled();
  });
});
