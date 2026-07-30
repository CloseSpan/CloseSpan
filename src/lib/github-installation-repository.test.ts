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

import { connectGithubInstallation } from "./github-installation-repository";

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
    database.client.query.mockReset().mockImplementation(async (query: unknown) => {
      if (sql(query).includes("UPDATE github_app_install_attempts"))
        return { rows: [{ id: "attempt-1" }], rowCount: 1 };
      if (sql(query).includes("SELECT org_id FROM github_app_installations"))
        return { rows: [], rowCount: 0 };
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
  });

  it("rejects an installation already bound to another tenant", async () => {
    database.client.query.mockImplementation(async (query: unknown) => {
      if (sql(query).includes("UPDATE github_app_install_attempts"))
        return { rows: [{ id: "attempt-1" }], rowCount: 1 };
      if (sql(query).includes("SELECT org_id FROM github_app_installations"))
        return { rows: [{ org_id: "org-other" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    await expect(
      connectGithubInstallation("attempt-1", "org-1", actor, installation),
    ).rejects.toThrow("another workspace");
  });

  it("rejects an expired or replayed installation attempt", async () => {
    database.client.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(
      connectGithubInstallation("attempt-1", "org-1", actor, installation),
    ).rejects.toThrow("expired or was already used");
  });
});
