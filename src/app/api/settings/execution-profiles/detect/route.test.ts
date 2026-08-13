import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const repositories = vi.hoisted(() => ({ list: vi.fn() }));
const detector = vi.hoisted(() => ({ detect: vi.fn() }));
const profiles = vi.hoisted(() => ({ list: vi.fn() }));
const matches = vi.hoisted(() => ({ refresh: vi.fn() }));
const activation = vi.hoisted(() => ({ activate: vi.fn() }));

vi.mock("@/lib/github-repository-allowlist", () => ({ listGithubRepositoryAuthorizations: repositories.list }));
vi.mock("@/lib/repository-profile-detection", () => ({ detectAndSaveGithubRepositoryProfiles: detector.detect }));
vi.mock("@/lib/execution-profile-repository", () => ({ listExecutionProfileSettings: profiles.list }));
vi.mock("@/lib/problem-repository-match-repository", () => ({ refreshPendingProblemRepositoryMatches: matches.refresh }));
vi.mock("@/lib/tenki-runner-onboarding", () => ({ activateReadyDetectedExecutionProfiles: activation.activate }));

import { POST } from "./route";

function request(repository: string, role = "Admin") {
  return new NextRequest("http://localhost/api/settings/execution-profiles/detect", {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "content-type": "application/json",
      "idempotency-key": `detect_${crypto.randomUUID().replaceAll("-", "")}`,
      "x-test-auth": "user",
      "x-test-user-org-id": "org-1",
      "x-test-user-role": role,
    },
    body: JSON.stringify({ repository }),
  });
}

describe("execution profile detection API", () => {
  beforeEach(() => {
    repositories.list.mockReset().mockResolvedValue([{
      id: "repo-1",
      installationId: "42",
      repository: "acme/app",
      defaultBranch: "main",
      active: true,
    }]);
    detector.detect.mockReset().mockResolvedValue({ profiles: [{ root: "." }] });
    profiles.list.mockReset().mockResolvedValue({ assignments: [] });
    matches.refresh.mockReset().mockResolvedValue([]);
    activation.activate.mockReset().mockResolvedValue(1);
  });

  it("detects only metadata from an explicitly authorized repository", async () => {
    const response = await POST(request("acme/app"));
    expect(response.status).toBe(200);
    expect(detector.detect).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      installationId: "42",
      repository: "acme/app",
      defaultBranch: "main",
    }));
    expect(matches.refresh).toHaveBeenCalledWith("org-1");
    expect(activation.activate).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      repository: "acme/app",
      actor: expect.objectContaining({ actorId: "system:repository-detector" }),
    }));
  });

  it("rejects repositories outside the GitHub App allowlist", async () => {
    const response = await POST(request("attacker/repository"));
    expect(response.status).toBe(404);
    expect(detector.detect).not.toHaveBeenCalled();
  });
});
