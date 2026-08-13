
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentRunExecutionContext } from "./engineering-workflow-repository";
import { hashExecutionProfileConfig } from "./execution-profile";
import { dispatchTenkiGithubActionsRun } from "./tenki-github-actions-executor";
import {
  TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH,
  buildIssueRuntimeVerificationJob,
  dispatchIssueRuntimeVerification,
} from "./issue-runtime-verification-executor";
import type { IssueRuntimeVerificationContext } from "./issue-runtime-verification";
import { RUNTIME_VERIFIER_WORKFLOW_NOT_INSTALLED_MESSAGE } from "./runtime-verifier-errors";

const runId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";
const baseSha = "a".repeat(40);
const workflow = "name: CloseSpan runner\non: workflow_dispatch\n";
const workflowHash = createHash("sha256").update(workflow).digest("hex");
const runtimeWorkflow = "name: CloseSpan runtime verifier\non: workflow_dispatch\n";
const runtimeWorkflowHash = createHash("sha256").update(runtimeWorkflow).digest("hex");
const config = {
  schemaVersion: 3 as const,
  language: "swift",
  framework: "SwiftUI",
  packageManager: "xcode",
  runtimeVersion: "xcode 16",
  workingDirectory: ".",
  installCommands: [],
  buildCommands: ["xcodebuild build"],
  testCommands: ["xcodebuild test"],
  typecheckCommands: [],
  permittedPaths: ["**/*"],
  tenkiImage: null,
  tenkiSnapshotId: null,
  cpuCores: 4,
  memoryMb: 8_192,
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
    kind: "tenki_github_actions" as const,
    platform: "macos" as const,
    architecture: "arm64" as const,
    runnerLabel: "tenki-macos-xcode-16",
    workflowPath: ".github/workflows/closespan-agent-runner.yml",
    workflowSha256: workflowHash,
    xcode: {
      version: "16",
      containerKind: "project" as const,
      containerPath: "Zup.xcodeproj",
      scheme: "Zup",
      configuration: "Debug",
      destination: "platform=iOS Simulator,name=iPhone 16",
      sdk: "iphonesimulator" as const,
      signingPolicy: "simulator_only" as const,
    },
    androidEmulator: null,
  },
};

function context(): AgentRunExecutionContext {
  const contentHash = hashExecutionProfileConfig(config);
  return {
    orgId: "org-1",
    problemId: "problem-1",
    runId,
    approvalId: "approval-1",
    repository: "samshanmukh/zup",
    installationId: "150109806",
    baseBranch: "main",
    baseSha,
    branchName: `closespan/${runId}`,
    promptId: "prompt-1",
    promptHash: "b".repeat(64),
    promptContent: "prompt",
    promptArtifactPath: ".prompt/tickets/problem-1.prompt.md",
    promptSnapshot: {} as AgentRunExecutionContext["promptSnapshot"],
    expiresAt: "2026-08-12T12:00:00.000Z",
    allowedCapabilities: [],
    generatedTests: [],
    executionProfileId: profileId,
    executionProfileHash: contentHash,
    executionProfileSnapshot: {
      profileId,
      version: 1,
      source: "confirmed",
      repository: "samshanmukh/zup",
      workspaceRoot: ".",
      contentHash,
      config,
    },
  };
}

function runtimeContext(): IssueRuntimeVerificationContext {
  const agentContext = context();
  return {
    orgId: agentContext.orgId,
    problemId: agentContext.problemId,
    investigationId: "investigation-1",
    runId,
    repository: agentContext.repository,
    installationId: agentContext.installationId,
    workspaceRoot: "ZupNative",
    baseBranch: agentContext.baseBranch,
    baseSha: agentContext.baseSha,
    promptHash: agentContext.promptHash,
    verificationPrompt: "Exercise the Post Context path in the iOS simulator.",
    executionProfileId: agentContext.executionProfileId,
    executionProfileHash: agentContext.executionProfileHash,
    executionProfileSnapshot: agentContext.executionProfileSnapshot,
    workflowHash: runtimeWorkflowHash,
    expiresAt: agentContext.expiresAt,
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("Tenki GitHub Actions executor dispatch", () => {
  it("verifies the workflow at the approved SHA and dispatches a dedicated immutable ref", async () => {
    vi.stubEnv("TENKI_GITHUB_ACTIONS_ENABLED", "true");
    vi.stubEnv(
      "TENKI_CONTROL_RUNNER_LABEL",
      "tenki-standard-small-2c-4g",
    );
    const createRef = vi.fn().mockResolvedValue({ data: {} });
    const createWorkflowDispatch = vi.fn().mockResolvedValue({ data: {} });
    const github = {
      rest: {
        git: {
          getRef: vi.fn()
            .mockResolvedValueOnce({ data: { object: { sha: baseSha } } })
            .mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 })),
          createRef,
        },
        repos: {
          getContent: vi.fn().mockResolvedValue({
            data: { type: "file", encoding: "base64", content: Buffer.from(workflow).toString("base64") },
          }),
        },
        actions: { createWorkflowDispatch },
      },
    };

    await dispatchTenkiGithubActionsRun(context(), "https://closespan.example", {
      createClient: async () => github as never,
    });

    expect(createRef).toHaveBeenCalledWith(expect.objectContaining({
      ref: `refs/heads/closespan/runs/${runId}`,
      sha: baseSha,
    }));
    expect(createWorkflowDispatch).toHaveBeenCalledWith(expect.objectContaining({
      owner: "samshanmukh",
      repo: "zup",
      workflow_id: ".github/workflows/closespan-agent-runner.yml",
      ref: `closespan/runs/${runId}`,
      inputs: expect.objectContaining({
        closespan_run_id: runId,
        closespan_profile_hash: hashExecutionProfileConfig(config),
        closespan_control_runner_label: "tenki-standard-small-2c-4g",
        closespan_runner_label: "tenki-macos-xcode-16",
      }),
    }));
  });

  it("rejects an unsafe control runner label before workflow dispatch", async () => {
    vi.stubEnv("TENKI_GITHUB_ACTIONS_ENABLED", "true");
    vi.stubEnv("TENKI_CONTROL_RUNNER_LABEL", "${{ attacker.controlled }}");
    const createWorkflowDispatch = vi.fn();
    const github = {
      rest: {
        git: {
          getRef: vi.fn()
            .mockResolvedValueOnce({ data: { object: { sha: baseSha } } })
            .mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 })),
          createRef: vi.fn().mockResolvedValue({ data: {} }),
        },
        repos: {
          getContent: vi.fn().mockResolvedValue({
            data: { type: "file", encoding: "base64", content: Buffer.from(workflow).toString("base64") },
          }),
        },
        actions: { createWorkflowDispatch },
      },
    };

    await expect(dispatchTenkiGithubActionsRun(context(), "https://closespan.example", {
      createClient: async () => github as never,
    })).rejects.toThrow("TENKI_CONTROL_RUNNER_LABEL");
    expect(createWorkflowDispatch).not.toHaveBeenCalled();
  });

  it("fails closed when the workflow bytes drift", async () => {
    vi.stubEnv("TENKI_GITHUB_ACTIONS_ENABLED", "true");
    const github = {
      rest: {
        git: { getRef: vi.fn().mockResolvedValue({ data: { object: { sha: baseSha } } }) },
        repos: {
          getContent: vi.fn().mockResolvedValue({
            data: { type: "file", encoding: "base64", content: Buffer.from(`${workflow}# changed\n`).toString("base64") },
          }),
        },
      },
    };

    await expect(dispatchTenkiGithubActionsRun(context(), "https://closespan.example", {
      createClient: async () => github as never,
    })).rejects.toThrow("workflow no longer matches");
  });
});

describe("current-issue Tenki runtime dispatch", () => {
  it("binds the separate reviewed verifier to the exact commit and runner", async () => {
    vi.stubEnv("TENKI_GITHUB_ACTIONS_ENABLED", "true");
    const createRef = vi.fn().mockResolvedValue({ data: {} });
    const createWorkflowDispatch = vi.fn().mockResolvedValue({ data: {} });
    const github = {
      rest: {
        git: {
          getRef: vi.fn()
            .mockResolvedValueOnce({ data: { object: { sha: baseSha } } })
            .mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 })),
          createRef,
        },
        repos: {
          getContent: vi.fn().mockResolvedValue({
            data: {
              type: "file",
              encoding: "base64",
              content: Buffer.from(runtimeWorkflow).toString("base64"),
            },
          }),
        },
        actions: { createWorkflowDispatch },
      },
    };

    await dispatchIssueRuntimeVerification(
      runtimeContext(),
      "https://closespan.example",
      { createClient: async () => github as never, template: runtimeWorkflow },
    );

    expect(createRef).toHaveBeenCalledWith(expect.objectContaining({
      ref: `refs/heads/closespan/runs/${runId}`,
      sha: baseSha,
    }));
    expect(createWorkflowDispatch).toHaveBeenCalledWith(expect.objectContaining({
      workflow_id: TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH,
      ref: `closespan/runs/${runId}`,
      inputs: expect.objectContaining({
        closespan_run_id: runId,
        closespan_workflow_hash: runtimeWorkflowHash,
        closespan_runner_label: "tenki-macos-xcode-16",
      }),
    }));
    expect(buildIssueRuntimeVerificationJob(runtimeContext())).toMatchObject({
      kind: "issue_runtime_verification",
      baseSha,
      workspaceRoot: "ZupNative",
      verificationPrompt: expect.stringContaining("Post Context"),
      runner: { label: "tenki-macos-xcode-16", platform: "macos" },
    });
  });

  it("explains how to recover when the runtime verifier workflow is missing", async () => {
    vi.stubEnv("TENKI_GITHUB_ACTIONS_ENABLED", "true");
    const createWorkflowDispatch = vi.fn();
    const github = {
      rest: {
        git: {
          getRef: vi.fn().mockResolvedValue({ data: { object: { sha: baseSha } } }),
        },
        repos: {
          getContent: vi.fn().mockRejectedValue(Object.assign(
            new Error("Not Found - https://docs.github.com/rest/repos/contents#get-repository-content"),
            { status: 404 },
          )),
        },
        actions: { createWorkflowDispatch },
      },
    };

    await expect(dispatchIssueRuntimeVerification(
      runtimeContext(),
      "https://closespan.example",
      { createClient: async () => github as never, template: runtimeWorkflow },
    )).rejects.toThrow(RUNTIME_VERIFIER_WORKFLOW_NOT_INSTALLED_MESSAGE);
    expect(createWorkflowDispatch).not.toHaveBeenCalled();
  });
});
