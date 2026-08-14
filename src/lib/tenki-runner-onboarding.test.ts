import { beforeEach, describe, expect, it, vi } from "vitest";

const workflow = vi.hoisted(() => ({ install: vi.fn() }));
const profiles = vi.hoisted(() => ({ list: vi.fn(), confirm: vi.fn() }));
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
  listExecutionProfileSettings: profiles.list,
  confirmDetectedExecutionProfile: profiles.confirm,
}));
vi.mock("./tenki-environment-catalog-repository", () => ({
  assertManagedTenkiBootSourceAllowed: vi.fn(),
}));

import {
  activateReadyDetectedExecutionProfiles,
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
    profiles.confirm.mockResolvedValue({});
  });

  it("respects an administrator deactivation during automatic refreshes", async () => {
    profiles.list.mockResolvedValue({
      assignments: [{
        repository: "acme/app",
        workspaceRoot: "ZupNative",
        automaticActivationDisabled: true,
        detectedProfile: { id: "detected-1", config: { schemaVersion: 1 } },
      }],
    });

    await expect(activateReadyDetectedExecutionProfiles({
      orgId: "org-1",
      repository: "acme/app",
      actor: { actorId: "system:repository-detector" },
    })).resolves.toBe(0);
    expect(profiles.confirm).not.toHaveBeenCalled();
  });

  it("automatically activates only high-confidence ready detections", async () => {
    profiles.list.mockResolvedValue({
      assignments: [{
        repository: "acme/app",
        workspaceRoot: "ZupNative",
        automaticActivationDisabled: false,
        detectedProfile: {
          id: "detected-high",
          detectionEvidence: { confidence: 0.96 },
          config: { schemaVersion: 1 },
        },
      }, {
        repository: "acme/app",
        workspaceRoot: "uncertain",
        automaticActivationDisabled: false,
        detectedProfile: {
          id: "detected-low",
          detectionEvidence: { confidence: 0.6 },
          config: { schemaVersion: 1 },
        },
      }],
    });

    await expect(activateReadyDetectedExecutionProfiles({
      orgId: "org-1",
      repository: "acme/app",
      actor: { actorId: "system:repository-detector" },
    })).resolves.toBe(1);
    expect(profiles.confirm).toHaveBeenCalledOnce();
    expect(profiles.confirm).toHaveBeenCalledWith(expect.objectContaining({
      detectedProfileId: "detected-high",
    }));
  });

  it("activates a ready runner profile without waiting for adaptive sizing", async () => {
    profiles.list.mockResolvedValue({
      assignments: [{
        repository: "acme/app",
        workspaceRoot: "ZupNative",
        activeProfile: null,
        automaticActivationDisabled: false,
        detectedProfile: {
          id: "detected-runner",
          repository: "acme/app",
          workspaceRoot: "ZupNative",
          detectionEvidence: { confidence: 0.96 },
          config: {
            schemaVersion: 3,
            language: "swift",
            framework: "iOS",
            packageManager: "xcode",
            runtimeVersion: "xcode 16",
            workingDirectory: "ZupNative",
            installCommands: [],
            buildCommands: ["xcodebuild build"],
            testCommands: [],
            typecheckCommands: [],
            permittedPaths: ["ZupNative/**"],
            tenkiImage: null,
            tenkiSnapshotId: null,
            cpuCores: 4,
            memoryMb: 14_336,
            allowInbound: false,
            allowOutbound: false,
            maxDurationMs: 3_600_000,
            idleTimeoutMinutes: 2,
            automaticInstall: false,
            automaticBuild: true,
            publicEnvironment: [],
            secretBindings: [],
            startCommand: null,
            applicationPort: null,
            healthCheckPath: null,
            healthCheckTimeoutMs: 90_000,
            previewEnabled: false,
            previewTtlMs: 600_000,
            runtimeTools: { http: false, browser: false, logs: false },
            executor: {
              kind: "tenki_github_actions",
              platform: "macos",
              architecture: "arm64",
              runnerLabel: "tenki-macos-15-small",
              workflowPath: ".github/workflows/closespan-agent-runner.yml",
              workflowSha256: "a".repeat(64),
              xcode: {
                version: "16",
                containerKind: "project",
                containerPath: "Zup.xcodeproj",
                scheme: "Zup",
                configuration: "Debug",
                destination: "platform=iOS Simulator,name=iPhone 16",
                sdk: "iphonesimulator",
                signingPolicy: "simulator_only",
              },
              androidEmulator: null,
            },
          },
        },
      }],
    });

    await expect(activateReadyDetectedExecutionProfiles({
      orgId: "org-1",
      repository: "acme/app",
      actor: { actorId: "system:repository-detector" },
    })).resolves.toBe(1);
    expect(profiles.confirm).toHaveBeenCalledWith(expect.objectContaining({
      detectedProfileId: "detected-runner",
    }));
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
