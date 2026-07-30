import { beforeEach, describe, expect, it, vi } from "vitest";

const security = vi.hoisted(() => ({ adminRead: vi.fn() }));
const github = vi.hoisted(() => ({ verify: vi.fn() }));
const repository = vi.hoisted(() => ({ requireAttempt: vi.fn(), connect: vi.fn() }));

vi.mock("@/lib/request-security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/request-security")>();
  return { ...actual, authorizeAdminRead: security.adminRead };
});
vi.mock("@/lib/github-app-auth", () => ({ verifyGithubInstallation: github.verify }));
vi.mock("@/lib/github-installation-repository", () => ({
  requireGithubInstallAttempt: repository.requireAttempt,
  connectGithubInstallation: repository.connect,
}));

import { NextRequest } from "next/server";
import { createGithubInstallStateToken, GITHUB_INSTALL_STATE_COOKIE } from "@/lib/github-installation-state";
import { GET } from "./route";

const secret = "github-callback-test-secret-with-at-least-32-characters";
const attemptId = "11111111-1111-4111-8111-111111111111";
const context = {
  orgId: "org-1",
  actorId: "admin-1",
  actorName: "Admin",
  role: "Admin",
  traceId: "trace-1",
};
const verified = {
  installationId: "150109806",
  accountId: "42",
  accountLogin: "acme",
  accountType: "Organization",
  repositorySelection: "selected",
  settingsUrl: "https://github.com/settings/installations/150109806",
  permissions: { contents: "write", pull_requests: "write" },
  repositories: [{ repository: "acme/api", defaultBranch: "main", private: true }],
};

function request(includeCookie = true) {
  const expiresAt = new Date(Date.now() + 60_000);
  const token = createGithubInstallStateToken(attemptId, expiresAt, secret);
  return new NextRequest(
    "https://closespan.com/api/integrations/github/callback?installation_id=150109806&setup_action=install",
    { headers: includeCookie ? { cookie: `${GITHUB_INSTALL_STATE_COOKIE}=${token}` } : {} },
  );
}

describe("GitHub installation callback", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", secret);
    security.adminRead.mockReset().mockResolvedValue(context);
    github.verify.mockReset().mockResolvedValue(verified);
    repository.requireAttempt.mockReset().mockResolvedValue(undefined);
    repository.connect.mockReset().mockResolvedValue({ repositoryCount: 1 });
  });

  it("verifies and persists the installation before redirecting to the workspace", async () => {
    const response = await GET(request());
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/integrations");
    expect(location.searchParams.get("github")).toBe("connected");
    expect(location.searchParams.get("repositories")).toBe("1");
    expect(repository.requireAttempt).toHaveBeenCalledWith(attemptId, "org-1", "admin-1");
    expect(repository.connect).toHaveBeenCalledWith(attemptId, "org-1", context, verified);
  });

  it("fails closed when the signed installation cookie is absent", async () => {
    const response = await GET(request(false));
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("github")).toBe("error");
    expect(location.searchParams.get("reason")).toBe("invalid_callback");
    expect(github.verify).not.toHaveBeenCalled();
  });
});
