import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const repositories = vi.hoisted(() => ({ listBranches: vi.fn() }));

vi.mock("@/lib/github-repository-allowlist", () => ({
  listAuthorizedGithubRepositoryBranches: repositories.listBranches,
}));

import { GET } from "./route";

function request(repository = "samshanmukh/zup", role = "Admin") {
  const url = new URL("http://localhost/api/settings/execution-profiles/branches");
  if (repository) url.searchParams.set("repository", repository);
  return new NextRequest(url, {
    headers: {
      "x-test-auth": "user",
      "x-test-user-org-id": "org-1",
      "x-test-user-role": role,
    },
  });
}

describe("execution profile branch list API", () => {
  beforeEach(() => {
    repositories.listBranches.mockReset().mockResolvedValue({
      repository: "samshanmukh/zup",
      branches: ["main", "feature/menu"],
      truncated: false,
    });
  });

  it("returns branches for an administrator's workspace-selected repository", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      repository: "samshanmukh/zup",
      branches: ["main", "feature/menu"],
      truncated: false,
    });
    expect(repositories.listBranches).toHaveBeenCalledWith({
      orgId: "org-1",
      repository: "samshanmukh/zup",
    });
  });

  it("does not disclose branches to a non-admin member", async () => {
    const response = await GET(request("samshanmukh/zup", "Contributor"));
    expect(response.status).toBe(403);
    expect(repositories.listBranches).not.toHaveBeenCalled();
  });

  it("requires an explicit repository", async () => {
    const response = await GET(request(""));
    expect(response.status).toBe(400);
    expect(repositories.listBranches).not.toHaveBeenCalled();
  });
});
