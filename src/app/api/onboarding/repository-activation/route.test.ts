import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const security = vi.hoisted(() => ({ read: vi.fn(), admin: vi.fn() }));
const repositories = vi.hoisted(() => ({ list: vi.fn() }));
const profiles = vi.hoisted(() => ({ list: vi.fn(), detect: vi.fn() }));
const setups = vi.hoisted(() => ({ list: vi.fn(), prepare: vi.fn() }));
const activation = vi.hoisted(() => ({ activate: vi.fn(), probes: vi.fn() }));
const sizing = vi.hoisted(() => ({ list: vi.fn() }));
const matches = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("@/lib/request-security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/request-security")>();
  return {
    ...actual,
    authorizeRead: security.read,
    authorizeAdminMutation: security.admin,
  };
});
vi.mock("@/lib/github-repository-allowlist", () => ({
  listGithubRepositoryAuthorizations: repositories.list,
}));
vi.mock("@/lib/execution-profile-repository", () => ({
  listExecutionProfileSettings: profiles.list,
}));
vi.mock("@/lib/repository-profile-detection", () => ({
  detectAndSaveGithubRepositoryProfiles: profiles.detect,
}));
vi.mock("@/lib/tenki-runner-workflow-setup-repository", () => ({
  listTenkiRunnerWorkflowSetups: setups.list,
}));
vi.mock("@/lib/tenki-runner-sizing-probe-repository", () => ({
  listTenkiRunnerSizingProbes: sizing.list,
}));
vi.mock("@/lib/tenki-runner-onboarding", () => ({
  prepareDetectedTenkiRunner: setups.prepare,
  prepareTenkiRunnerSizingProbes: activation.probes,
  activateReadyDetectedExecutionProfiles: activation.activate,
}));
vi.mock("@/lib/problem-repository-match-repository", () => ({
  refreshPendingProblemRepositoryMatches: matches.refresh,
}));
vi.mock("@/lib/workspace-persistence", () => ({
  workspacePersistenceMode: () => "postgres",
}));

import { GET, POST } from "./route";

const context = {
  orgId: "org-1",
  actorId: "admin-1",
  actorName: "Admin",
  role: "Admin",
  traceId: "trace-1",
};
const repository = {
  id: "repo-1",
  installationId: "42",
  repository: "acme/app",
  defaultBranch: "main",
  workspaceSelected: true,
  active: true,
};

describe("repository activation onboarding API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    security.read.mockResolvedValue(context);
    security.admin.mockResolvedValue(context);
    repositories.list.mockResolvedValue([repository]);
    profiles.list.mockResolvedValue({
      safeGenericProfile: {},
      assignments: [{
        repository: "acme/app",
        workspaceRoot: ".",
        activeProfile: null,
        detectedProfile: {
          id: "profile-1",
          detectionEvidence: { confidence: 0.95 },
          config: { schemaVersion: 3, executor: { kind: "tenki_github_actions", platform: "macos" } },
        },
      }],
    });
    setups.list.mockResolvedValue([{
      repository: "acme/app",
      status: "Pending",
      pullRequestNumber: 12,
      pullRequestUrl: "https://github.example/pull/12",
    }]);
    sizing.list.mockResolvedValue([]);
    profiles.detect.mockResolvedValue({ sourceSha: "c".repeat(40), profiles: [] });
    setups.prepare.mockResolvedValue({ status: "Pending" });
    activation.probes.mockResolvedValue([]);
    activation.activate.mockResolvedValue(0);
    matches.refresh.mockResolvedValue([]);
  });

  it("projects the persisted approval state for onboarding", async () => {
    const response = await GET(new NextRequest("http://localhost/api/onboarding/repository-activation"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      repositories: [{
        repository: "acme/app",
        profileDetected: true,
        executionReady: false,
        tenkiRequired: true,
        compatibilityStatus: "validating",
        compatibilitySummary: "Validating toolchain compatibility",
        setup: { status: "Pending", pullRequestNumber: 12 },
      }],
    });
  });

  it("retries detection, setup preparation, and safe activation as one action", async () => {
    const response = await POST(new NextRequest(
      "http://localhost/api/onboarding/repository-activation",
      { method: "POST", body: JSON.stringify({ repository: "acme/app" }) },
    ));
    expect(response.status).toBe(200);
    expect(profiles.detect).toHaveBeenCalledWith(expect.objectContaining({
      repository: "acme/app",
      installationId: "42",
    }));
    expect(setups.prepare).toHaveBeenCalledWith(expect.objectContaining({
      repository: "acme/app",
    }));
    expect(activation.activate).toHaveBeenCalledWith(expect.objectContaining({
      repository: "acme/app",
    }));
    expect(activation.probes).toHaveBeenCalledWith(expect.objectContaining({
      repository: "acme/app",
      callbackBaseUrl: "http://localhost",
    }));
    expect(matches.refresh).toHaveBeenCalledWith("org-1");
  });
});
