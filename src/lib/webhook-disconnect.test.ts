import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  query: vi.fn(), release: vi.fn(), mode: "postgres",
}));
vi.mock("./db", () => ({
  persistenceMode: () => database.mode,
  databasePool: () => ({ connect: async () => ({ query: database.query, release: database.release }) }),
}));
import { disconnectWebhookIntegration } from "./integration-repository";

describe("webhook credential revocation", () => {
  beforeEach(() => {
    database.mode = "postgres";
    database.query.mockReset().mockResolvedValue({ rows: [], rowCount: 1 });
    database.release.mockReset();
  });
  it("atomically revokes only this workspace's credential and retains feedback", async () => {
    await disconnectWebhookIntegration("org_alpha", "admin_1");
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE integrations"), ["org_alpha", "int_webhook", "Custom webhook"]);
    expect(database.query).toHaveBeenCalledWith("DELETE FROM integration_webhook_secrets WHERE org_id=$1 AND integration_id=$2", ["org_alpha", "int_webhook"]);
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_events"), [expect.any(String), "org_alpha", "admin_1", "int_webhook", expect.any(String)]);
    const queries = database.query.mock.calls.map(([sql]) => sql);
    expect(queries[0]).toBe("BEGIN");
    expect(queries.at(-1)).toBe("COMMIT");
    expect(queries.join(" ")).not.toContain("feedback_items");
    expect(database.release).toHaveBeenCalledOnce();
  });
  it("rolls back state changes if credential revocation fails", async () => {
    database.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("DELETE")) throw new Error("Unavailable");
      return { rows: [] };
    });
    await expect(disconnectWebhookIntegration("org_alpha", "admin_1")).rejects.toThrow("Unavailable");
    expect(database.query).toHaveBeenCalledWith("ROLLBACK");
    expect(database.query).not.toHaveBeenCalledWith("COMMIT");
    expect(database.release).toHaveBeenCalledOnce();
  });
  it("rejects simulated workspaces before opening a transaction", async () => {
    database.mode = "memory";
    await expect(disconnectWebhookIntegration("org_demo", "admin_1")).rejects.toThrow("seeded demo");
    expect(database.query).not.toHaveBeenCalled();
  });
});
