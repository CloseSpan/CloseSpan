import { beforeEach, describe, expect, it, vi } from "vitest";

const security = vi.hoisted(() => ({ admin: vi.fn(), read: vi.fn() }));
const integration = vi.hoisted(() => ({ pending: vi.fn() }));
const installation = vi.hoisted(() => ({
  list: vi.fn(),
  disconnect: vi.fn(),
}));
const repositories = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("@/lib/request-security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/request-security")>();
  return { ...actual, authorizeAdminMutation: security.admin, authorizeRead: security.read };
});
vi.mock("@/lib/integration-repository", () => ({ markGithubPendingSetup: integration.pending }));
vi.mock("@/lib/github-installation-repository", () => ({
  listGithubAppInstallations: installation.list,
  disconnectGithubInstallations: installation.disconnect,
}));
vi.mock("@/lib/github-repository-allowlist", () => ({
  listGithubRepositoryAuthorizations: repositories.list,
}));

import { NextRequest } from "next/server";
import { DELETE, GET, POST } from "./route";

const context = {
  orgId: "org-1",
  actorId: "admin-1",
  actorName: "Admin",
  role: "Admin",
  traceId: "trace-1",
};

function request(method: string) {
  return new NextRequest("https://closespan.com/api/integrations/github", { method });
}

describe("GitHub integration API", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "github-route-test-secret-with-at-least-32-characters");
    security.admin.mockReset().mockResolvedValue(context);
    security.read.mockReset().mockResolvedValue(context);
    integration.pending.mockReset().mockResolvedValue({
      installUrl: "https://github.com/apps/closespan/installations/new",
      attemptId: "11111111-1111-4111-8111-111111111111",
      expiresAt: new Date("2030-01-01T00:10:00.000Z"),
    });
    installation.list.mockReset().mockResolvedValue([]);
    installation.disconnect.mockReset().mockResolvedValue(undefined);
    repositories.list.mockReset().mockResolvedValue([]);
  });

  it("starts a short-lived install and sets an HTTP-only callback cookie", async () => {
    const response = await POST(request("POST"));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("closespan_github_install=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    await expect(response.json()).resolves.toMatchObject({
      installUrl: "https://github.com/apps/closespan/installations/new",
    });
  });

  it("lists tenant-scoped installations and repositories", async () => {
    const response = await GET(request("GET"));
    await expect(response.json()).resolves.toEqual({ installations: [], repositories: [] });
    expect(installation.list).toHaveBeenCalledWith("org-1");
  });

  it("disconnects the workspace without uninstalling another tenant", async () => {
    const response = await DELETE(request("DELETE"));
    expect(response.status).toBe(200);
    expect(installation.disconnect).toHaveBeenCalledWith("org-1", context);
  });
});
