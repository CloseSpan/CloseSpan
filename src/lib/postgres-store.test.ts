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

import {
  approvePostgresAction,
  findPostgresState,
  rejectPostgresAction,
} from "./postgres-store";

const context = {
  actorId: "admin",
  actorName: "Admin",
  idempotencyKey: "approval-action-1",
  traceId: "trace-1",
};

function normalizedSql(sql: unknown): string {
  return typeof sql === "string" ? sql.replace(/\s+/g, " ") : "";
}

describe("legacy PostgreSQL approval workflow", () => {
  beforeEach(() => {
    database.client.query.mockReset().mockImplementation(async (sql: unknown) => {
      const query = normalizedSql(sql);
      if (query.includes("SELECT id FROM organizations")) return { rows: [{ id: "org-1" }], rowCount: 1 };
      if (query.includes("SELECT a.id approval_id")) {
        return { rows: [{ approval_id: "approval-1", problem_id: "problem-1", stage: "Reviewed" }], rowCount: 1 };
      }
      if (query.includes("SELECT action FROM idempotency_keys")) return { rows: [], rowCount: 0 };
      if (query.includes("SELECT coalesce(w.version")) {
        return {
          rows: [{
            version: 2,
            stage: "Approved",
            approval: { id: "approval-1", status: "Approved" },
            work_item: null,
            notification_status: "Not drafted",
          }],
          rowCount: 1,
        };
      }
      if (query.includes("FROM audit_events") || query.includes("SELECT key, action FROM idempotency_keys")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });
    database.pool.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    database.transaction.mockReset().mockImplementation(
      async (work: (client: typeof database.client) => Promise<unknown>) => work(database.client),
    );
  });

  it("reads only external-work-item approvals", async () => {
    await findPostgresState("org-1");
    expect(normalizedSql(database.pool.query.mock.calls[0]?.[0]))
      .toContain("a.action_type='external_work_item'");
  });

  it.each([
    ["approve", approvePostgresAction, "status='Approved'"],
    ["reject", rejectPostgresAction, "status='Rejected'"],
  ])("scopes the %s selector and mutation to external-work-item approvals", async (_name, action, statusSql) => {
    await action("org-1", context);
    const calls = database.client.query.mock.calls.map(([sql]) => normalizedSql(sql));
    expect(calls.find((sql) => sql.includes("SELECT a.id approval_id")))
      .toContain("a.action_type='external_work_item'");
    expect(calls.find((sql) => sql.includes(`UPDATE approval_requests SET ${statusSql}`)))
      .toContain("action_type='external_work_item'");
  });
});
