import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  mode: "postgres" as "memory" | "postgres",
  pool: { query: vi.fn() },
}));

vi.mock("./db", () => ({
  persistenceMode: () => database.mode,
  databasePool: () => database.pool,
}));

import {
  ensureWorkspaceAccessWaitlistEntry,
  recordWorkspaceAccessAttempt,
} from "./access-waitlist-repository";

describe("workspace access waitlist repository", () => {
  beforeEach(() => {
    database.mode = "postgres";
    database.pool.query.mockReset().mockResolvedValue({
      rowCount: 1,
      rows: [{ status: "Pending" }],
    });
  });

  it("atomically upserts a normalized verified Google identity", async () => {
    await recordWorkspaceAccessAttempt(
      "Shanmukh.Sain+demo@googlemail.com",
      "  Demo Operator  ",
    );

    expect(database.pool.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "CREATE TABLE IF NOT EXISTS workspace_access_waitlist",
      ),
    );
    expect(database.pool.query).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT(email) DO UPDATE SET"),
      ["shanmukhsain@gmail.com", "Demo Operator"],
    );
    const sql = database.pool.query.mock.calls.find(([statement]) =>
      String(statement).includes("ON CONFLICT(email) DO UPDATE SET"),
    )?.[0] as string;
    expect(sql).toContain(
      "login_attempt_count=workspace_access_waitlist.login_attempt_count+1",
    );
    const conflictUpdate = sql.split("ON CONFLICT(email) DO UPDATE SET")[1];
    expect(conflictUpdate).not.toContain("first_attempted_at");
  });

  it("does not write a waitlist entry in memory mode", async () => {
    database.mode = "memory";

    await recordWorkspaceAccessAttempt("person@example.com", "Person");

    expect(database.pool.query).not.toHaveBeenCalled();
  });

  it("idempotently confirms the waitlist entry on the denied page", async () => {
    await expect(
      ensureWorkspaceAccessWaitlistEntry("Prospect@Example.com"),
    ).resolves.toBe(true);

    expect(database.pool.query).toHaveBeenCalledWith(
      expect.stringContaining("RETURNING status"),
      ["prospect@example.com"],
    );
  });

  it("does not present a declined record as a successful waitlist entry", async () => {
    database.pool.query.mockResolvedValue({
      rowCount: 1,
      rows: [{ status: "Declined" }],
    });

    await expect(
      ensureWorkspaceAccessWaitlistEntry("declined@example.com"),
    ).resolves.toBe(false);
  });
});
