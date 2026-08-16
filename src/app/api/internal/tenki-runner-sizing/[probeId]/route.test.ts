import { beforeEach, describe, expect, it, vi } from "vitest";

const oidc = vi.hoisted(() => ({ verify: vi.fn(), assert: vi.fn() }));
const probes = vi.hoisted(() => ({
  get: vi.fn(),
  running: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
}));
const profiles = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  confirm: vi.fn(),
}));
const repositories = vi.hoisted(() => ({ list: vi.fn() }));
const dispatch = vi.hoisted(() => ({ queue: vi.fn() }));

vi.mock("@/lib/github-actions-oidc", () => ({
  verifyGithubActionsOidcToken: oidc.verify,
  assertGithubActionsProbeIdentity: oidc.assert,
}));
vi.mock("@/lib/tenki-runner-sizing-probe-repository", () => ({
  getTenkiRunnerSizingProbe: probes.get,
  markTenkiRunnerSizingProbeRunning: probes.running,
  completeTenkiRunnerSizingProbe: probes.complete,
  failTenkiRunnerSizingProbe: probes.fail,
}));
vi.mock("@/lib/execution-profile-repository", () => ({
  getExecutionProfileVersion: profiles.get,
  saveDetectedExecutionProfileSuggestion: profiles.save,
  confirmDetectedExecutionProfile: profiles.confirm,
}));
vi.mock("@/lib/github-repository-allowlist", () => ({
  listGithubRepositoryAuthorizations: repositories.list,
}));
vi.mock("@/lib/tenki-runner-sizing-probe", () => ({
  queueAndDispatchTenkiRunnerSizingProbe: dispatch.queue,
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

const probeId = "11111111-1111-4111-8111-111111111111";
const candidates = [
  { label: "tenki-macos-xcode-26-small", cpuCores: 4, memoryMb: 14_336 },
  { label: "tenki-macos-xcode-26-medium", cpuCores: 6, memoryMb: 21_504 },
  { label: "tenki-macos-xcode-26-large", cpuCores: 8, memoryMb: 28_672 },
];

function profile(runnerLabel = candidates[0].label) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    orgId: "org-1",
    repository: "owner/repo",
    workspaceRoot: "App",
    version: 1,
    source: "detected",
    contentHash: "b".repeat(64),
    parentProfileId: null,
    config: {
      schemaVersion: 3,
      language: "swift",
      packageManager: "xcode",
      workingDirectory: "App",
      buildCommands: ["xcodebuild build"],
      permittedPaths: ["App/**"],
      cpuCores: 4,
      memoryMb: 14_336,
      executor: {
        kind: "tenki_github_actions",
        platform: "macos",
        architecture: "arm64",
        runnerLabel,
        workflowPath: ".github/workflows/closespan-agent-runner.yml",
        workflowSha256: "a".repeat(64),
        xcode: {
          version: "26.1",
          containerKind: "project",
          containerPath: "App.xcodeproj",
          scheme: "App",
          configuration: "Debug",
          destination: "platform=iOS Simulator,name=iPhone 16",
          sdk: "iphonesimulator",
          signingPolicy: "simulator_only",
        },
        androidEmulator: null,
      },
    },
    detectionEvidence: {
      runnerSizing: {
        baselineRunnerLabel: candidates[0].label,
        compatibleCandidates: candidates,
      },
    },
    createdBy: "system:test",
    createdAt: new Date().toISOString(),
  };
}

function probe(runnerLabel = candidates[0].label) {
  return {
    id: probeId,
    orgId: "org-1",
    repository: "owner/repo",
    workspaceRoot: "App",
    profileId: profile().id,
    profileHash: profile().contentHash,
    sourceSha: "c".repeat(40),
    workflowPath: ".github/workflows/closespan-runner-sizing.yml",
    workflowSha256: "d".repeat(64),
    runnerLabel,
    workloadClass: "ios_simulator",
    workloadReasons: ["iOS simulator workload"],
    probeCommands: ["xcodebuild build"],
    workingDirectory: "App",
    status: "Running",
  };
}

function request(body: unknown) {
  return new NextRequest(
    `https://app.closespan.com/api/internal/tenki-runner-sizing/${probeId}`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer github-oidc-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

describe("Tenki runner sizing callback retries", () => {
  beforeEach(() => {
    oidc.verify.mockReset().mockResolvedValue({ run_id: "314" });
    oidc.assert.mockReset();
    probes.get.mockReset().mockResolvedValue(probe());
    probes.running.mockReset().mockResolvedValue(undefined);
    probes.complete.mockReset().mockResolvedValue({ recommendationReasons: [] });
    probes.fail.mockReset().mockResolvedValue(undefined);
    profiles.get.mockReset().mockResolvedValue(profile());
    profiles.save.mockReset().mockImplementation(async (input) => ({
      ...profile(input.config.executor.runnerLabel),
      id: "33333333-3333-4333-8333-333333333333",
      config: input.config,
      detectionEvidence: input.detectionEvidence,
      contentHash: "e".repeat(64),
    }));
    profiles.confirm.mockReset().mockResolvedValue(undefined);
    repositories.list.mockReset().mockResolvedValue([{
      repository: "owner/repo",
      active: true,
      installationId: "9001",
    }]);
    dispatch.queue.mockReset().mockResolvedValue({ id: "next-probe-id" });
  });

  it("records an explicit toolchain failure and dispatches the next compatible label", async () => {
    const response = await POST(request({
      orgId: "org-1",
      event: "failed",
      code: "toolchain_incompatible",
      message: "Runner Xcode 16.4 does not satisfy approved Xcode 26.1",
      githubWorkflowRunId: 314,
    }), { params: Promise.resolve({ probeId }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      activated: false,
      selectedRunnerLabel: candidates[1].label,
      nextProbeId: "next-probe-id",
    });
    expect(probes.fail).toHaveBeenCalledWith(expect.objectContaining({
      code: "toolchain_incompatible",
    }));
    expect(profiles.save).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        executor: expect.objectContaining({ runnerLabel: candidates[1].label }),
      }),
    }));
    expect(dispatch.queue).toHaveBeenCalledOnce();
  });

  it("advances after a completed probe reports a generic command failure", async () => {
    const response = await POST(request({
      orgId: "org-1",
      event: "completed",
      githubWorkflowRunId: 314,
      telemetry: {
        durationMs: 12_000,
        cpuSaturationRatio: 0.4,
        memoryPressureRatio: 0.3,
        peakMemoryMb: 4_096,
        memoryLimitMb: 14_336,
        exitCode: 65,
        signal: null,
        oomKilled: false,
        timedOut: false,
        sampledAt: new Date().toISOString(),
        samples: 12,
      },
    }), { params: Promise.resolve({ probeId }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      selectedRunnerLabel: candidates[1].label,
      nextProbeId: "next-probe-id",
    });
    expect(probes.complete).toHaveBeenCalledWith(expect.objectContaining({
      recommendedRunnerLabel: candidates[1].label,
    }));
    expect(dispatch.queue).toHaveBeenCalledOnce();
  });

  it("stops cleanly when the final compatible label fails", async () => {
    probes.get.mockResolvedValue(probe(candidates[2].label));
    profiles.get.mockResolvedValue(profile(candidates[2].label));
    const response = await POST(request({
      orgId: "org-1",
      event: "failed",
      code: "probe_failed",
      message: "The repository probe failed",
    }), { params: Promise.resolve({ probeId }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      activated: false,
      exhausted: true,
    });
    expect(profiles.save).not.toHaveBeenCalled();
    expect(dispatch.queue).not.toHaveBeenCalled();
  });
});
