import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  client: { query: vi.fn() },
  transaction: vi.fn(),
}));

vi.mock("./db", () => ({
  databasePool: () => ({ query: vi.fn() }),
  transaction: database.transaction,
}));

vi.mock("./workspace-persistence", () => ({
  requirePostgresWorkspace: vi.fn(),
}));

import { clearExecutionProfileAssignment } from "./execution-profile-repository";

function normalizedSql(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ") : "";
}

describe("execution profile repository locking", () => {
  beforeEach(() => {
    database.client.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    database.transaction.mockReset().mockImplementation(
      async (work: (client: typeof database.client) => Promise<unknown>) =>
        work(database.client),
    );
  });

  it("uses NUL-free, scope-unique advisory lock parameters", async () => {
    const scopes = [
      { orgId: "org-alpha", repository: "acme/widget", workspaceRoot: "." },
      { orgId: "org-alpha", repository: "acme/widget", workspaceRoot: "apps/web" },
      { orgId: "org-alpha", repository: "acme/api", workspaceRoot: "." },
      { orgId: "org-beta", repository: "acme/widget", workspaceRoot: "." },
    ];

    for (const scope of scopes) {
      await clearExecutionProfileAssignment({
        ...scope,
        actor: { actorId: "admin-1" },
      });
    }

    const lockCalls = database.client.query.mock.calls.filter(([query]) =>
      normalizedSql(query).includes(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      ),
    );
    const lockKeys = lockCalls.map(([, parameters]) => parameters?.[0]);

    expect(lockCalls).toHaveLength(scopes.length);
    expect(lockKeys).toEqual(scopes.map((scope) => JSON.stringify([
      scope.orgId,
      scope.repository,
      scope.workspaceRoot,
    ])));
    expect(lockKeys.every((key) =>
      typeof key === "string" && !key.includes("\u0000"),
    )).toBe(true);
    expect(new Set(lockKeys).size).toBe(scopes.length);
  });
});
