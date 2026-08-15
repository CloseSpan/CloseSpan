import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const repositories = vi.hoisted(() => ({ list: vi.fn() }));
const detection = vi.hoisted(() => ({ detect: vi.fn() }));
const activation = vi.hoisted(() => ({
  activate: vi.fn(),
  setup: vi.fn(),
  probes: vi.fn(),
}));
const matches = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("@/lib/github-repository-allowlist", () => ({
  listGithubRepositoryAuthorizations: repositories.list,
}));
vi.mock("@/lib/repository-profile-detection", () => ({
  detectAndSaveGithubRepositoryProfiles: detection.detect,
}));
vi.mock("@/lib/tenki-runner-onboarding", () => ({
  activateReadyDetectedExecutionProfiles: activation.activate,
  prepareDetectedTenkiRunner: activation.setup,
  prepareTenkiRunnerSizingProbes: activation.probes,
}));
vi.mock("@/lib/problem-repository-match-repository", () => ({
  refreshPendingProblemRepositoryMatches: matches.refresh,
}));

import { POST } from "./route";

function request(secret = "test-cron-secret") {
  return new NextRequest("http://localhost/api/internal/execution-profiles/refresh", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ orgId: "org-1", repository: "acme/app" }),
  });
}

describe("internal execution-profile refresh", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    repositories.list.mockReset().mockResolvedValue([{
      installationId: "42",
      repository: "acme/app",
      defaultBranch: "main",
      active: true,
      workspaceSelected: true,
    }]);
    detection.detect.mockReset().mockResolvedValue({ profiles: [{ root: "." }] });
    activation.activate.mockReset().mockResolvedValue(1);
    activation.setup.mockReset().mockResolvedValue(null);
    activation.probes.mockReset().mockResolvedValue([]);
    matches.refresh.mockReset().mockResolvedValue([]);
  });

  it("automatically activates the latest ready detection", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      profiles: 1,
      activatedProfiles: 1,
    });
    expect(detection.detect).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      repository: "acme/app",
    }));
    expect(activation.activate).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      repository: "acme/app",
    }));
    expect(activation.setup).toHaveBeenCalledWith(expect.objectContaining({
      repository: "acme/app",
      detection: { profiles: [{ root: "." }] },
    }));
    expect(activation.probes).toHaveBeenCalledWith(expect.objectContaining({
      repository: "acme/app",
      callbackBaseUrl: "http://localhost",
    }));
    expect(matches.refresh).toHaveBeenCalledWith("org-1");
  });

  it("rejects an invalid cron credential before detection", async () => {
    expect((await POST(request("wrong-secret"))).status).toBe(401);
    expect(detection.detect).not.toHaveBeenCalled();
    expect(activation.activate).not.toHaveBeenCalled();
    expect(activation.setup).not.toHaveBeenCalled();
    expect(activation.probes).not.toHaveBeenCalled();
  });
});
