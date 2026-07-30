import { beforeEach, describe, expect, it, vi } from "vitest";

const security = vi.hoisted(() => ({ read: vi.fn() }));
const repositories = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("@/lib/request-security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/request-security")>();
  return { ...actual, authorizeRead: security.read };
});
vi.mock("@/lib/github-repository-allowlist", () => ({
  listGithubRepositoryAuthorizations: repositories.list,
}));

import { NextRequest } from "next/server";
import { GET, PUT } from "./route";

const context = {
  orgId: "org-1",
  actorId: "admin-1",
  actorName: "Admin",
  role: "Admin",
  traceId: "trace-1",
};

describe("GitHub repository authorization API", () => {
  beforeEach(() => {
    security.read.mockReset().mockResolvedValue(context);
    repositories.list.mockReset().mockResolvedValue([]);
  });

  it("lists repositories synchronized from the GitHub App", async () => {
    const response = await GET(
      new NextRequest("https://closespan.com/api/integrations/github/repositories"),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ repositories: [] });
    expect(repositories.list).toHaveBeenCalledWith("org-1");
  });

  it("rejects manual repository authorization", async () => {
    const response = await PUT(
      new NextRequest("https://closespan.com/api/integrations/github/repositories", {
        method: "PUT",
        body: JSON.stringify({
          installationId: "150109806",
          repository: "acme/api",
          defaultBranch: "main",
        }),
      }),
    );
    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("synchronized from the CloseSpan GitHub App"),
    });
  });
});
