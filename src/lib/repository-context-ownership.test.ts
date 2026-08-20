import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  pool: { query: vi.fn() },
  client: { query: vi.fn() },
  transaction: vi.fn(),
}));
const github = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("./db", () => ({
  databasePool: () => database.pool,
  transaction: database.transaction,
}));
vi.mock("./github-app-auth", () => ({
  createGithubInstallationClient: github.createClient,
}));
vi.mock("./workspace-persistence", () => ({
  requirePostgresWorkspace: vi.fn(),
}));

import {
  buildRepositoryContext,
  queueRepositoryContexts,
  queueRepositoryContextRetry,
  removeUnselectedRepositoryContexts,
} from "./repository-context-repository";

function sql(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ") : "";
}

describe("repository context indexing ownership", () => {
  beforeEach(() => {
    database.pool.query.mockReset().mockResolvedValue({ rows: [], rowCount: 1 });
    database.client.query.mockReset().mockResolvedValue({ rows: [], rowCount: 1 });
    database.transaction.mockReset().mockImplementation(
      async (work: (client: typeof database.client) => Promise<unknown>) => work(database.client),
    );
    github.createClient.mockReset();
  });

  it("does not requeue an active or ready repository snapshot", async () => {
    await queueRepositoryContexts({
      orgId: "org-1",
      installationId: "150109806",
      repositories: [{ repository: "acme/api", defaultBranch: "main" }],
    });

    const query = sql(database.pool.query.mock.calls[0]?.[0]);
    expect(query).toContain("WHEN repository_context_snapshots.status='Failed' THEN 'Queued'");
    expect(query).toContain("ELSE repository_context_snapshots.status");
    expect(query).toContain("ELSE repository_context_snapshots.indexing_attempt_id");
  });

  it("does not retry a repository while another attempt owns it", async () => {
    database.pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ exists: 1 }], rowCount: 1 });

    await expect(queueRepositoryContextRetry("org-1", "acme/api")).resolves.toBe(false);

    const retryQuery = sql(database.pool.query.mock.calls[0]?.[0]);
    expect(retryQuery).toContain("updated_at=now(), indexing_attempt_id=NULL");
    expect(retryQuery).toContain("AND status='Failed'");
  });

  it("does not let a stale failed worker overwrite a ready result", async () => {
    database.pool.query.mockImplementation(async (query: unknown) => {
      const statement = sql(query);
      if (statement.includes("SET provider='closespan',status='Discovering'")) {
        return {
          rows: [{
            id: "context-1",
            org_id: "org-1",
            installation_id: "150109806",
            repository: "acme/api",
            default_branch: "main",
            commit_sha: null,
            provider: "closespan",
            status: "Discovering",
            stage: "Reading repository structure",
            progress: 6,
            total_files: 0,
            indexed_files: 0,
            skipped_files: 0,
            context_state: null,
            indexing_attempt_id: "attempt-1",
            indexing_lease_acquired_at: new Date(),
            started_at: new Date(),
            completed_at: null,
            updated_at: new Date(),
            error_message: null,
          }],
          rowCount: 1,
        };
      }
      if (statement.includes("SELECT snapshot.status")) {
        return { rows: [{ status: "Ready", complete: true }], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${statement}`);
    });
    github.createClient.mockRejectedValue(new Error("temporary GitHub read failure"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(buildRepositoryContext("org-1", "acme/api")).resolves.toBeUndefined();

    expect(database.pool.query.mock.calls.some(([query]) =>
      sql(query).includes("SET status='Failed'"),
    )).toBe(false);
    consoleError.mockRestore();
  });

  it("removes repository context only for repositories deselected from this workspace", async () => {
    await removeUnselectedRepositoryContexts({
      orgId: "org-1",
      installationId: "150109806",
      selectedRepositories: ["acme/api"],
    });

    expect(sql(database.pool.query.mock.calls[0]?.[0])).toContain(
      "WHERE org_id=$1 AND installation_id=$2 AND NOT (repository=ANY($3::text[]))",
    );
    expect(database.pool.query.mock.calls[0]?.[1]).toEqual([
      "org-1",
      "150109806",
      ["acme/api"],
    ]);
  });
});
