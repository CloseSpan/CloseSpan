import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const db = vi.hoisted(() => ({ mode: "postgres", query: vi.fn() }));
vi.mock("./db", () => ({ persistenceMode: () => db.mode, databasePool: () => ({ query: db.query }) }));
import { readPlatformUserStatus, platformUserAccessSchema } from "./platform-user-access";

beforeEach(() => { db.mode = "postgres"; db.query.mockReset().mockResolvedValue({ rows: [] }); });
describe("platform access restrictions", () => {
  it.each(["Blocked", "Deleted"])("reads %s for a normalized identity", async (status) => {
    db.query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith("SELECT") ? [{ status }] : [] }));
    await expect(readPlatformUserStatus("Sam.Example+tag@googlemail.com")).resolves.toBe(status);
    expect(db.query).toHaveBeenCalledWith("SELECT status FROM platform_user_access WHERE email=$1", ["samexample@gmail.com"]);
  });
  it("defaults unlisted accounts to active", async () => {
    await expect(readPlatformUserStatus("new@example.com")).resolves.toBe("Active");
  });
  it("never treats a storage outage as an active account", async () => {
    db.query.mockRejectedValue(new Error("unavailable"));
    await expect(readPlatformUserStatus("member@example.com")).rejects.toThrow("unavailable");
  });
  it("does not access a database in isolated memory mode", async () => {
    db.mode = "memory";
    await expect(readPlatformUserStatus("member@example.com")).resolves.toBe("Active");
    expect(db.query).not.toHaveBeenCalled();
  });
  it("keeps the additive migration equivalent to its compatibility schema", () => {
    const sql = readFileSync(new URL("../../db/migrations/083_platform_user_access.sql", import.meta.url), "utf8");
    const normalize = (source: string) => source.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
    expect(normalize(sql)).toBe(normalize(platformUserAccessSchema));
  });
});
