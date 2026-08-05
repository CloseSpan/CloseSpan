import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  client: { query: vi.fn() },
  pool: { query: vi.fn() },
  transaction: vi.fn(),
}));

vi.mock("./db", () => ({
  databasePool: () => database.pool,
  transaction: database.transaction,
}));

vi.mock("./workspace-persistence", () => ({
  requirePostgresWorkspace: vi.fn(),
  workspacePersistenceMode: () => "postgres",
}));

import {
  connectGithubInstallation,
  setGithubWorkspaceRepositoryBindings,
  syncGithubInstallationRecords,
} from "./github-installation-repository";

const actor = { actorId: "admin-1", actorName: "Admin", traceId: "trace-1" };
const installation = {
  installationId: "150109806",
  accountId: "42",
  accountLogin: "acme",
  accountType: "Organization",
  repositorySelection: "selected",
  settingsUrl: "https://github.com/organizations/acme/settings/installations/150109806",
  permissions: { contents: "write", pull_requests: "write" },
  repositories: [
    { repository: "acme/api", defaultBranch: "main", private: true },
    { repository: "acme/web", defaultBranch: "main", private: true },
  ],
};

function sql(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ") : "";
}

describe("GitHub installation persistence", () => {
  beforeEach(() => {
    database.pool.query.mockReset().mockResolvedValue({ rows: [{ exists: 1 }], rowCount: 1 });
    database.client.query.mockReset().mockImplementation(async (query: unknown) => {
      if (sql(query).includes("UPDATE github_app_install_attempts"))
        return { rows: [{ id: "attempt-1" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    database.transaction.mockReset().mockImplementation(
      async (work: (client: typeof database.client) => Promise<unknown>) => work(database.client),
    );
  });

  it("consumes one attempt and synchronizes only GitHub-authorized repositories", async () => {
    await expect(
      connectGithubInstallation("attempt-1", "org-1", actor, installation),
    ).resolves.toEqual({ repositoryCount: 2 });
    const queries = database.client.query.mock.calls.map(([query]) => sql(query));
    expect(queries.filter((query) => query.includes("INSERT INTO github_repository_allowlists")))
      .toHaveLength(2);
    expect(queries.some((query) => query.includes("connection_state='Connected'"))).toBe(true);
    expect(queries.some((query) => query.includes("SET consumed_at=now()"))).toBe(true);
    expect(queries.some((query) => query.includes("ON CONFLICT(org_id,installation_id)"))).toBe(true);
  });

  it("allows one customer installation to be explicitly bound to another workspace", async () => {
    await expect(
      connectGithubInstallation("attempt-1", "org-1", actor, installation),
    ).resolves.toEqual({ repositoryCount: 2 });
    expect(database.client.query.mock.calls.some(([query]) =>
      sql(query).includes("WHERE installation_id=$1 FOR UPDATE"),
    )).toBe(false);
  });

  it("preserves workspace repository selection during installation webhooks", async () => {
    database.client.query.mockImplementation(async (query: unknown) => {
      if (sql(query).includes("SELECT repository FROM github_repository_allowlists"))
        return { rows: [{ repository: "acme/api" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    await syncGithubInstallationRecords(database.client as never, "org-1", installation, {
      preserveWorkspaceRepositoryBindings: true,
    });
    const inserts = database.client.query.mock.calls.filter(([query]) =>
      sql(query).includes("INSERT INTO github_repository_allowlists"),
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.[1]).toContain("acme/api");
    expect(inserts[0]?.[1]).not.toContain("acme/web");
  });

  it("sets an explicit workspace repository subset after verifying GitHub access", async () => {
    const verifyInstallation = vi.fn().mockResolvedValue(installation);
    await expect(setGithubWorkspaceRepositoryBindings(
      "org-1",
      installation.installationId,
      ["acme/web"],
      actor,
      { verifyInstallation },
    )).resolves.toEqual({ repositoryCount: 1 });
    expect(verifyInstallation).toHaveBeenCalledWith(installation.installationId);
    const selectionUpdate = database.client.query.mock.calls.find(([query]) =>
      sql(query).includes("SET workspace_selected=false,active=false"),
    );
    expect(selectionUpdate?.[1]?.[2]).toEqual(["acme/web"]);
    const inserts = database.client.query.mock.calls.filter(([query]) =>
      sql(query).includes("INSERT INTO github_repository_allowlists"),
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.[1]).toContain("acme/web");
  });

  it("rejects a workspace repository that GitHub did not authorize", async () => {
    await expect(setGithubWorkspaceRepositoryBindings(
      "org-1",
      installation.installationId,
      ["acme/private-admin"],
      actor,
      { verifyInstallation: vi.fn().mockResolvedValue(installation) },
    )).rejects.toThrow("not accessible");
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("does not query GitHub for an installation outside the workspace", async () => {
    database.pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const verifyInstallation = vi.fn();
    await expect(setGithubWorkspaceRepositoryBindings(
      "org-1",
      installation.installationId,
      ["acme/api"],
      actor,
      { verifyInstallation },
    )).rejects.toThrow("not connected to this workspace");
    expect(verifyInstallation).not.toHaveBeenCalled();
  });

  it("rejects an expired or replayed installation attempt", async () => {
    database.client.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(
      connectGithubInstallation("attempt-1", "org-1", actor, installation),
    ).rejects.toThrow("expired or was already used");
  });
});
