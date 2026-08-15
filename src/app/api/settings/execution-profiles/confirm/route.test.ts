import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const profiles = vi.hoisted(() => ({
  confirm: vi.fn(),
  getVersion: vi.fn(),
  list: vi.fn(),
}));
const matches = vi.hoisted(() => ({ refresh: vi.fn() }));
const github = vi.hoisted(() => ({ updateBranch: vi.fn() }));
const sizing = vi.hoisted(() => ({ getProfile: vi.fn() }));

vi.mock("@/lib/execution-profile-repository", () => ({
  confirmDetectedExecutionProfile: profiles.confirm,
  getExecutionProfileVersion: profiles.getVersion,
  listExecutionProfileSettings: profiles.list,
}));
vi.mock("@/lib/problem-repository-match-repository", () => ({
  refreshPendingProblemRepositoryMatches: matches.refresh,
}));
vi.mock("@/lib/github-repository-allowlist", () => ({
  updateGithubRepositoryExecutionBranch: github.updateBranch,
}));
vi.mock("@/lib/tenki-runner-sizing-probe-repository", () => ({
  getProfileTenkiRunnerSizingProbe: sizing.getProfile,
}));

import { POST } from "./route";

function request(role = "Admin") {
  return new NextRequest("http://localhost/api/settings/execution-profiles/confirm", {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "content-type": "application/json",
      "idempotency-key": `confirm_${crypto.randomUUID().replaceAll("-", "")}`,
      "x-test-auth": "user",
      "x-test-user-org-id": "org-1",
      "x-test-user-role": role,
    },
    body: JSON.stringify({
      detectedProfileId: "11111111-1111-4111-8111-111111111111",
      executionBranch: "release/test",
    }),
  });
}

describe("execution profile confirmation API", () => {
  beforeEach(() => {
    profiles.confirm.mockReset().mockResolvedValue({ id: "confirmed" });
    profiles.getVersion.mockReset().mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      source: "detected",
      repository: "acme/platform",
      workspaceRoot: ".",
      config: {},
      detectionEvidence: {},
    });
    profiles.list.mockReset().mockResolvedValue({ assignments: [] });
    matches.refresh.mockReset().mockResolvedValue([]);
    github.updateBranch.mockReset().mockResolvedValue("release/test");
    sizing.getProfile.mockReset().mockResolvedValue(null);
  });

  it("promotes a reviewed suggestion to a new immutable version", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(profiles.confirm).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      detectedProfileId: "11111111-1111-4111-8111-111111111111",
    }));
    expect(github.updateBranch).toHaveBeenCalledWith({
      orgId: "org-1",
      repository: "acme/platform",
      executionBranch: "release/test",
    });
    expect(matches.refresh).toHaveBeenCalledWith("org-1");
  });

  it("refuses to activate a runner profile before its compatibility probe passes", async () => {
    profiles.getVersion.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      source: "detected",
      repository: "acme/ios",
      workspaceRoot: ".",
      config: {
        schemaVersion: 3,
        executor: {
          kind: "tenki_github_actions",
          platform: "macos",
          architecture: "arm64",
          runnerLabel: "tenki-macos-15-small",
          workflowPath: ".github/workflows/closespan-agent-runner.yml",
          workflowSha256: "a".repeat(64),
          xcode: null,
          androidEmulator: null,
        },
      },
      detectionEvidence: {},
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("background"),
    });
    expect(profiles.confirm).not.toHaveBeenCalled();
  });

  it("activates a runner profile after its exact compatibility probe passes", async () => {
    profiles.getVersion.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      source: "detected",
      repository: "acme/ios",
      workspaceRoot: ".",
      config: {
        schemaVersion: 3,
        executor: {
          kind: "tenki_github_actions",
          platform: "macos",
          architecture: "arm64",
          runnerLabel: "tenki-macos-15-small",
          workflowPath: ".github/workflows/closespan-agent-runner.yml",
          workflowSha256: "a".repeat(64),
          xcode: null,
          androidEmulator: null,
        },
      },
      detectionEvidence: {},
    });
    sizing.getProfile.mockResolvedValue({
      status: "Completed",
      telemetry: { exitCode: 0 },
      failureMessage: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(profiles.confirm).toHaveBeenCalledOnce();
  });

  it("keeps a newly detected generic ecosystem inactive until a validated environment exists", async () => {
    profiles.getVersion.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      source: "detected",
      repository: "acme/python",
      workspaceRoot: ".",
      config: {},
      detectionEvidence: {
        compatibilityRequirements: {
          schemaVersion: 1,
          sourceSha: "a".repeat(40),
          dependencyFingerprint: "b".repeat(64),
          ecosystem: "python",
          runtimeFamily: "python",
          runtimeConstraint: ">=3.12",
          packageManager: "uv",
          toolchains: [],
          capabilities: [],
          validationKind: "managed_environment",
        },
      },
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("validated managed environment"),
    });
    expect(profiles.confirm).not.toHaveBeenCalled();
  });

  it("requires an administrator", async () => {
    expect((await POST(request("Contributor"))).status).toBe(403);
    expect(profiles.confirm).not.toHaveBeenCalled();
  });
});
