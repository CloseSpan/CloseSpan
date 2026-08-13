import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  client: { query: vi.fn() },
  transaction: vi.fn(),
}));

vi.mock("./db", () => ({
  databasePool: () => database.client,
  transaction: database.transaction,
}));

import {
  ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MESSAGE,
  ISSUE_RUNTIME_VERIFICATION_RUNNING_TIMEOUT_MESSAGE,
  reconcileStaleIssueRuntimeVerifications,
} from "./issue-runtime-verification";

describe("runtime verification timeout reconciliation", () => {
  beforeEach(() => {
    database.client.query.mockReset();
    database.transaction.mockReset().mockImplementation(
      async (work: (client: typeof database.client) => Promise<unknown>) =>
        work(database.client),
    );
  });

  it("expires stale queue and execution states and releases their investigations", async () => {
    database.client.query.mockImplementation(async (statement: unknown) => {
      if (
        typeof statement === "string"
        && statement.includes("UPDATE issue_runtime_verification_runs")
      ) {
        return {
          rows: [
            {
              id: "run-queued",
              org_id: "org-1",
              investigation_id: "investigation-1",
              summary: ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MESSAGE,
              started_at: null,
            },
            {
              id: "run-running",
              org_id: "org-1",
              investigation_id: "investigation-2",
              summary: ISSUE_RUNTIME_VERIFICATION_RUNNING_TIMEOUT_MESSAGE,
              started_at: new Date("2026-08-12T10:00:00.000Z"),
            },
          ],
        };
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(reconcileStaleIssueRuntimeVerifications(
      "org-1",
      new Date("2026-08-12T12:00:00.000Z"),
    )).resolves.toEqual({ queuedTimedOut: 1, runningTimedOut: 1 });

    const timeoutUpdate = database.client.query.mock.calls[0];
    expect(timeoutUpdate[1]).toEqual([
      "org-1",
      "2026-08-12T11:45:00.000Z",
      "2026-08-12T10:40:00.000Z",
      ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MESSAGE,
      ISSUE_RUNTIME_VERIFICATION_RUNNING_TIMEOUT_MESSAGE,
    ]);
    expect(database.client.query.mock.calls.filter(([statement]) =>
      typeof statement === "string"
      && statement.includes("UPDATE investigations"))).toHaveLength(2);
    expect(database.client.query.mock.calls.filter(([statement]) =>
      typeof statement === "string"
      && statement.includes("INSERT INTO audit_events"))).toHaveLength(2);
    expect(database.client.query.mock.calls.some(([statement]) =>
      typeof statement === "string"
      && statement.includes("UPDATE workspaces"))).toBe(true);
  });

  it("does not touch investigations when no run crossed a deadline", async () => {
    database.client.query.mockResolvedValue({ rows: [] });

    await expect(reconcileStaleIssueRuntimeVerifications("org-1")).resolves.toEqual({
      queuedTimedOut: 0,
      runningTimedOut: 0,
    });
    expect(database.client.query).toHaveBeenCalledOnce();
  });
});
