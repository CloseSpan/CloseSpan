import { beforeEach, describe, expect, it, vi } from "vitest";

const security = vi.hoisted(() => ({ read: vi.fn(), admin: vi.fn() }));
const repositories = vi.hoisted(() => ({ list: vi.fn() }));
const detector = vi.hoisted(() => ({ detect: vi.fn() }));
const repositoryContext = vi.hoisted(() => ({
  queue: vi.fn(),
  build: vi.fn(),
  removeUnselected: vi.fn(),
}));
const activation = vi.hoisted(() => ({ prepare: vi.fn(), activate: vi.fn(), probes: vi.fn() }));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (work: () => unknown) => work() };
});
const installations = vi.hoisted(() => ({ select: vi.fn() }));

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
vi.mock("@/lib/repository-profile-detection", () => ({
  detectAndSaveGithubRepositoryProfiles: detector.detect,
}));
vi.mock("@/lib/github-installation-repository", () => ({
  setGithubWorkspaceRepositoryBindings: installations.select,
}));
vi.mock("@/lib/repository-context-repository", () => ({
  queueRepositoryContexts: repositoryContext.queue,
  buildQueuedRepositoryContexts: repositoryContext.build,
  removeUnselectedRepositoryContexts: repositoryContext.removeUnselected,
}));
vi.mock("@/lib/tenki-runner-onboarding", () => ({
  prepareDetectedTenkiRunner: activation.prepare,
  prepareTenkiRunnerSizingProbes: activation.probes,
  activateReadyDetectedExecutionProfiles: activation.activate,
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
    security.admin.mockReset().mockResolvedValue(context);
    repositories.list.mockReset().mockResolvedValue([]);
    installations.select.mockReset().mockResolvedValue({ repositoryCount: 1 });
    detector.detect.mockReset().mockResolvedValue({ profiles: [] });
    repositoryContext.queue.mockReset().mockResolvedValue(undefined);
    repositoryContext.build.mockReset().mockResolvedValue(undefined);
    repositoryContext.removeUnselected.mockReset().mockResolvedValue(undefined);
    activation.prepare.mockReset().mockResolvedValue(null);
    activation.activate.mockReset().mockResolvedValue(1);
    activation.probes.mockReset().mockResolvedValue([]);
  });

  it("lists repositories synchronized from the GitHub App", async () => {
    const response = await GET(
      new NextRequest("https://closespan.com/api/integrations/github/repositories"),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ repositories: [] });
    expect(repositories.list).toHaveBeenCalledWith("org-1");
  });

  it("sets an explicit workspace repository selection", async () => {
    repositories.list.mockResolvedValue([{
      id: "repo-1",
      installationId: "150109806",
      repository: "acme/api",
      defaultBranch: "main",
      workspaceSelected: true,
      active: true,
    }]);
    const response = await PUT(
      new NextRequest("https://closespan.com/api/integrations/github/repositories", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          installationId: "150109806",
          repositories: ["acme/api"],
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(installations.select).toHaveBeenCalledWith(
      "org-1",
      "150109806",
      ["acme/api"],
      context,
    );
    await expect(response.json()).resolves.toMatchObject({
      repositoryCount: 1,
      repositories: [expect.objectContaining({ repository: "acme/api" })],
    });
    expect(detector.detect).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      repository: "acme/api",
      defaultBranch: "main",
    }));
    expect(repositoryContext.queue).toHaveBeenCalledWith({
      orgId: "org-1",
      installationId: "150109806",
      repositories: [{ repository: "acme/api", defaultBranch: "main" }],
    });
    expect(repositoryContext.removeUnselected).toHaveBeenCalledWith({
      orgId: "org-1",
      installationId: "150109806",
      selectedRepositories: ["acme/api"],
    });
    expect(repositoryContext.build).toHaveBeenCalledWith("org-1", ["acme/api"]);
    expect(activation.prepare).toHaveBeenCalledWith(expect.objectContaining({
      repository: "acme/api",
    }));
    expect(activation.activate).toHaveBeenCalledWith(expect.objectContaining({
      repository: "acme/api",
    }));
  });
});
