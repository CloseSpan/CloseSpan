import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const profiles = vi.hoisted(() => ({ list: vi.fn(), override: vi.fn() }));
const repositories = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("@/lib/execution-profile-repository", () => ({
  listExecutionProfileSettings: profiles.list,
  overrideExecutionProfile: profiles.override,
}));
vi.mock("@/lib/github-repository-allowlist", () => ({
  listGithubRepositoryAuthorizations: repositories.list,
}));
vi.mock("@/lib/workspace-persistence", () => ({
  workspacePersistenceMode: () => "postgres",
}));

import { GET, PUT } from "./route";

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
    repositories.list.mockReset().mockResolvedValue([]);
  });

  it("returns profiles and the workspace's GitHub-authorized repositories", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      available: true,
      assignments: [],
      repositories: [],
    });
    expect(profiles.list).toHaveBeenCalledWith("org-1");
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
});
