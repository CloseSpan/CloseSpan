import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const profiles = vi.hoisted(() => ({
  settings: vi.fn(),
  matches: vi.fn(),
}));
const repositories = vi.hoisted(() => ({ list: vi.fn() }));
const review = vi.hoisted(() => ({
  requireProblem: vi.fn(),
  active: vi.fn(),
  refresh: vi.fn(),
  confirm: vi.fn(),
  reject: vi.fn(),
}));
const detector = vi.hoisted(() => ({ detect: vi.fn() }));

vi.mock("@/lib/execution-profile-repository", () => ({
  listExecutionProfileSettings: profiles.settings,
  listProblemRepositoryMatches: profiles.matches,
}));
vi.mock("@/lib/github-repository-allowlist", () => ({
  listGithubRepositoryAuthorizations: repositories.list,
}));
vi.mock("@/lib/problem-repository-match-repository", () => ({
  requireProblemRepositoryMatchProblem: review.requireProblem,
  getActiveConfirmedProblemRepositoryMatch: review.active,
  refreshProblemRepositoryMatch: review.refresh,
  confirmProblemRepositoryMatch: review.confirm,
  rejectProblemRepositoryMatch: review.reject,
}));
vi.mock("@/lib/repository-profile-detection", () => ({
  detectAndSaveGithubRepositoryProfiles: detector.detect,
}));
vi.mock("@/lib/workspace-persistence", () => ({
  workspacePersistenceMode: () => "postgres",
}));

import { GET, PUT } from "./route";

const problemId = "problem-1";
const profileId = "11111111-1111-4111-8111-111111111111";
const repository = {
  id: "repo-1",
  installationId: "42",
  repository: "acme/app",
  defaultBranch: "main",
  workspaceSelected: true,
  active: true,
};
const match = {
  problemId,
  repository: repository.repository,
  workspaceRoot: ".",
  profileId,
  profileHash: "a".repeat(64),
  confidence: 0.91,
  reasons: ["The problem names this authorized repository exactly."],
  status: "Confirmed" as const,
  createdAt: "2026-08-05T00:00:00.000Z",
  updatedAt: "2026-08-05T00:00:00.000Z",
};

function request(method = "GET", body?: unknown, role = "Admin") {
  return new NextRequest(
    `http://localhost/api/problems/${problemId}/repository-match`,
    {
      method,
      headers: {
        origin: "http://localhost",
        "content-type": "application/json",
        "idempotency-key": `match_${crypto.randomUUID().replaceAll("-", "")}`,
        "x-test-auth": "user",
        "x-test-user-org-id": "org-1",
        "x-test-user-role": role,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}

const context = { params: Promise.resolve({ problemId }) };

describe("problem repository match API", () => {
  beforeEach(() => {
    profiles.settings.mockReset().mockResolvedValue({ assignments: [] });
    profiles.matches.mockReset().mockResolvedValue([]);
    repositories.list.mockReset().mockResolvedValue([repository]);
    review.requireProblem.mockReset().mockResolvedValue(undefined);
    review.active.mockReset().mockResolvedValue(null);
    review.refresh.mockReset().mockResolvedValue({
      problemId,
      resolution: { selected: null, ranked: [], needsReview: true, reason: "Ambiguous" },
      persistedProfileId: null,
      profileDetectionRequired: false,
    });
    review.confirm.mockReset().mockResolvedValue({
      match,
      problemFiles: [],
      engineeringSpecificationUpdated: false,
      engineeringUpdateReason: "No safe ticket update was available.",
    });
    review.reject.mockReset().mockResolvedValue({ ...match, status: "Rejected" });
    detector.detect.mockReset().mockResolvedValue({ profiles: [] });
  });

  it("returns a tenant-scoped read view without granting viewer mutations", async () => {
    const response = await GET(request("GET", undefined, "Viewer"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      available: true,
      canReview: false,
      canRefreshDetection: false,
      pddProfileReady: false,
    });
    expect(review.requireProblem).toHaveBeenCalledWith("org-1", problemId);
    expect(profiles.matches).toHaveBeenCalledWith("org-1", problemId);
  });

  it("lets a contributor confirm an explicitly selected active profile", async () => {
    review.active.mockResolvedValue(match);
    profiles.matches.mockResolvedValue([match]);
    const response = await PUT(request("PUT", {
      action: "confirm",
      repository: "acme/app",
      workspaceRoot: ".",
      profileId,
    }, "Contributor"), context);
    expect(response.status).toBe(200);
    expect(review.confirm).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      problemId,
      repository: "acme/app",
      workspaceRoot: ".",
      profileId,
    }));
    await expect(response.json()).resolves.toMatchObject({
      pddProfileReady: true,
      confirmation: { engineeringSpecificationUpdated: false },
    });
  });

  it("keeps detection refresh admin-only and allowlist-scoped", async () => {
    const forbidden = await PUT(request("PUT", {
      action: "refresh",
      repository: "acme/app",
    }, "Contributor"), context);
    expect(forbidden.status).toBe(403);
    expect(detector.detect).not.toHaveBeenCalled();

    const response = await PUT(request("PUT", {
      action: "refresh",
      repository: "acme/app",
    }), context);
    expect(response.status).toBe(200);
    expect(detector.detect).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      installationId: "42",
      repository: "acme/app",
    }));
    expect(review.refresh).toHaveBeenCalledWith("org-1", problemId);
  });

  it("rejects a repository outside the active authorization list", async () => {
    const response = await PUT(request("PUT", {
      action: "refresh",
      repository: "attacker/repository",
    }), context);
    expect(response.status).toBe(404);
    expect(detector.detect).not.toHaveBeenCalled();
  });
});
