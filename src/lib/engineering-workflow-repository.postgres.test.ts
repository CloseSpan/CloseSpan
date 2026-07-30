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
  workspacePersistenceMode: () => "postgres",
}));

import {
  approveImplementationRun,
  claimQueuedAgentRun,
  markAgentRunRunning,
  rejectImplementationApproval,
} from "./engineering-workflow-repository";

const actor = {
  actorId: "admin",
  actorName: "Admin",
  traceId: "trace-1",
  idempotencyKey: "workflow-1",
};

function normalizedSql(sql: unknown): string {
  return typeof sql === "string" ? sql.replace(/\s+/g, " ") : "";
}

describe("PostgreSQL engineering workflow state guards", () => {
  beforeEach(() => {
    database.client.query.mockReset();
    database.pool.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    database.transaction.mockReset().mockImplementation(
      async (work: (client: typeof database.client) => Promise<unknown>) => work(database.client),
    );
  });

  it("makes duplicate started callbacks idempotent for queued and running runs", async () => {
    database.pool.query.mockResolvedValue({ rows: [], rowCount: 1 });

    await markAgentRunRunning("org-1", "run-1", "sandbox-1");
    expect(normalizedSql(database.pool.query.mock.calls[0]?.[0]))
      .toContain("status IN ('Queued','Running')");
  });

  it("atomically claims a queued run only once before provisioning Tenki", async () => {
    database.pool.query.mockResolvedValueOnce({ rows: [{ status: "Running" }], rowCount: 1 });
    await expect(claimQueuedAgentRun("org-1", "run-1")).resolves.toBe("claimed");
    expect(normalizedSql(database.pool.query.mock.calls[0]?.[0]))
      .toContain("status='Queued'");
    expect(normalizedSql(database.pool.query.mock.calls[0]?.[0]))
      .toContain("sandbox_id='tenki:provisioning'");
    expect(normalizedSql(database.pool.query.mock.calls[0]?.[0]))
      .toContain("interval '13 minutes'");

    database.pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    database.pool.query.mockResolvedValueOnce({ rows: [{ status: "Running" }], rowCount: 1 });
    await expect(claimQueuedAgentRun("org-1", "run-1")).resolves.toBe("active");

    database.pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    database.pool.query.mockResolvedValueOnce({ rows: [{ status: "Failed" }], rowCount: 1 });
    await expect(claimQueuedAgentRun("org-1", "run-1")).resolves.toBe("terminal");
  });

  it("returns the immutable prompt to Ready when an approval is rejected", async () => {
    database.client.query.mockImplementation(async (sql: unknown) => {
      if (normalizedSql(sql).includes("UPDATE approval_requests SET status='Rejected'")) {
        return {
          rows: [{ problem_id: "problem-1", prompt_revision_id: "prompt-1" }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });

    await rejectImplementationApproval("org-1", "approval-1", actor);
    expect(database.client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE implementation_prompts SET status='Ready'"),
      ["org-1", "prompt-1"],
    );
  });

  it("returns the immutable prompt to Ready when an approval expires", async () => {
    database.client.query.mockImplementation(async (sql: unknown) => {
      if (normalizedSql(sql).includes("FROM approval_requests")) {
        return {
          rows: [{
            id: "approval-1",
            problem_id: "problem-1",
            status: "Pending",
            expires_at: new Date("2020-01-01T00:00:00Z"),
            prompt_revision_id: "prompt-1",
            prompt_hash: "hash-1",
            repository: "owner/repo",
            base_branch: "main",
            base_sha: "a".repeat(40),
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(approveImplementationRun("org-1", "approval-1", actor))
      .rejects.toThrow("Approval expired");
    expect(database.client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE implementation_prompts SET status='Ready'"),
      ["org-1", "prompt-1"],
    );
  });
});
