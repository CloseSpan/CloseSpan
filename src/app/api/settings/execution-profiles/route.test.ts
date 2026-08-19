import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { upgradeExecutionProfileConfigV2 } from "@/lib/execution-profile";

const profiles = vi.hoisted(() => ({ list: vi.fn(), override: vi.fn(), clear: vi.fn() }));
const repositories = vi.hoisted(() => ({ list: vi.fn() }));
const runtimeSecrets = vi.hoisted(() => ({ validate: vi.fn() }));
const runnerSetups = vi.hoisted(() => ({ list: vi.fn() }));
const sizing = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("@/lib/execution-profile-repository", () => ({
  listExecutionProfileSettings: profiles.list,
  overrideExecutionProfile: profiles.override,
  clearExecutionProfileAssignment: profiles.clear,
}));
vi.mock("@/lib/github-repository-allowlist", () => ({
  listGithubRepositoryAuthorizations: repositories.list,
}));
vi.mock("@/lib/workspace-persistence", () => ({
  workspacePersistenceMode: () => "postgres",
}));
vi.mock("@/lib/runtime-secret-repository", () => ({
  validateRuntimeSecretBindings: runtimeSecrets.validate,
}));
vi.mock("@/lib/tenki-runner-workflow-setup-repository", () => ({
  listPendingTenkiRunnerWorkflowSetups: runnerSetups.list,
}));
vi.mock("@/lib/tenki-runner-sizing-probe-repository", () => ({
  listTenkiRunnerSizingProbes: sizing.list,
}));

import { DELETE, GET, PUT } from "./route";

function request(method = "GET", body?: unknown, role = "Admin") {
  return new NextRequest("http://localhost/api/settings/execution-profiles", {
    method,
    headers: {
      origin: "http://localhost",
      "content-type": "application/json",
      "idempotency-key": `profile_${crypto.randomUUID().replaceAll("-", "")}`,
      "x-test-auth": "user",
      "x-test-user-org-id": "org-1",
      "x-test-user-role": role,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("execution profile settings API", () => {
  beforeEach(() => {
    profiles.list.mockReset().mockResolvedValue({
      assignments: [],
      safeGenericProfile: { id: "safe" },
    });
    profiles.override.mockReset().mockResolvedValue({ id: "override" });
    profiles.clear.mockReset().mockResolvedValue(undefined);
    repositories.list.mockReset().mockResolvedValue([]);
    runtimeSecrets.validate.mockReset().mockResolvedValue(undefined);
    runnerSetups.list.mockReset().mockResolvedValue([{
      repository: "acme/app",
      workflowPath: ".github/workflows/closespan-agent-runner.yml",
      pullRequestNumber: 12,
      pullRequestUrl: "https://github.example/pull/12",
      updatedAt: "2026-08-11T12:00:00.000Z",
    }]);
    sizing.list.mockReset().mockResolvedValue([]);
  });

  it("returns profiles and the workspace's GitHub-authorized repositories", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      available: true,
      assignments: [],
      repositories: [],
      runnerWorkflowSetups: [{
        repository: "acme/app",
        pullRequestNumber: 12,
      }],
      compatibilityByProfileId: {},
    });
    expect(profiles.list).toHaveBeenCalledWith("org-1");
    expect(runnerSetups.list).toHaveBeenCalledWith("org-1");
    expect(sizing.list).toHaveBeenCalledWith("org-1");
  });

  it("does not disclose execution profiles or repository access to non-admin members", async () => {
    const response = await GET(request("GET", undefined, "Contributor"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Administrator permission is required",
    });
    expect(profiles.list).not.toHaveBeenCalled();
    expect(repositories.list).not.toHaveBeenCalled();
  });

  it("creates an immutable override only for an administrator", async () => {
    const payload = {
      repository: "acme/app",
      workspaceRoot: ".",
      parentProfileId: null,
      config: { schemaVersion: 1 },
    };
    const response = await PUT(request("PUT", payload));
    expect(response.status).toBe(200);
    expect(profiles.override).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      repository: "acme/app",
      config: payload.config,
    }));

    const forbidden = await PUT(request("PUT", payload, "Contributor"));
    expect(forbidden.status).toBe(403);
  });

  it("deactivates a repository root while retaining its immutable profile history", async () => {
    const response = await DELETE(request("DELETE", {
      repository: "acme/app",
      workspaceRoot: "ZupNative",
    }));
    expect(response.status).toBe(200);
    expect(profiles.clear).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      repository: "acme/app",
      workspaceRoot: "ZupNative",
    }));
  });

  it("validates opaque runtime secret bindings before persisting a v2 profile", async () => {
    const config = {
      ...upgradeExecutionProfileConfigV2({ schemaVersion: 1 }),
      secretBindings: [{
        envName: "DATABASE_URL",
        secretId: "11111111-1111-4111-8111-111111111111",
        secretVersion: 3,
        exposure: "runtime" as const,
      }],
    };
    const response = await PUT(request("PUT", {
      repository: "acme/app",
      workspaceRoot: ".",
      parentProfileId: null,
      config,
    }));

    expect(response.status).toBe(200);
    expect(runtimeSecrets.validate).toHaveBeenCalledWith({
      orgId: "org-1",
      repository: "acme/app",
      workspaceRoot: ".",
      bindings: config.secretBindings,
    });
    expect(profiles.override).toHaveBeenCalledOnce();
  });

  it("allows discovered runner labels while enforcing resources for documented sizes", async () => {
    const config = {
      schemaVersion: 3 as const,
      language: "swift",
      packageManager: "xcode",
      workingDirectory: ".",
      permittedPaths: ["**/*"],
      cpuCores: 6,
      memoryMb: 16_384,
      executor: {
        kind: "tenki_github_actions" as const,
        platform: "macos" as const,
        architecture: "arm64" as const,
        runnerLabel: "tenki-macos-15-medium",
        workflowPath: ".github/workflows/closespan-agent-runner.yml",
        workflowSha256: "a".repeat(64),
        xcode: {
          version: "16",
          containerKind: "project" as const,
          containerPath: "App.xcodeproj",
          scheme: "App",
          configuration: "Debug",
          destination: "platform=iOS Simulator,name=iPhone 16",
          sdk: "iphonesimulator" as const,
          signingPolicy: "simulator_only" as const,
        },
        androidEmulator: null,
      },
    };
    expect((await PUT(request("PUT", {
      repository: "acme/app", workspaceRoot: ".", parentProfileId: null, config,
    }))).status).toBe(200);
    expect((await PUT(request("PUT", {
      repository: "acme/app", workspaceRoot: ".", parentProfileId: null,
      config: { ...config, executor: { ...config.executor, runnerLabel: "tenki-macos-xcode-26" } },
    }))).status).toBe(200);
    expect((await PUT(request("PUT", {
      repository: "acme/app", workspaceRoot: ".", parentProfileId: null,
      config: { ...config, executor: { ...config.executor, runnerLabel: "invalid label" } },
    }))).status).toBe(409);
    expect((await PUT(request("PUT", {
      repository: "acme/app", workspaceRoot: ".", parentProfileId: null,
      config: { ...config, cpuCores: 4 },
    }))).status).toBe(409);
  });
});
