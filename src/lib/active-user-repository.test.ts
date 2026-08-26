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
  listActivePlatformUsers,
  recordPlatformUserSignIn,
} from "./active-user-repository";

describe("active platform user repository", () => {
  beforeEach(() => {
    database.mode = "postgres";
    database.pool.query.mockReset().mockImplementation(async (sql: unknown) => {
      const statement = String(sql);
      if (statement.includes("FROM workspace_members member")) {
        return {
          rows: [
            {
              email: "Sam.Example+first@googlemail.com",
              display_name: "Sam Member",
              role: "Admin",
              organization_id: "org_new",
              organization_name: "New workspace",
              organization_created_at: new Date("2026-08-10T10:00:00Z"),
            },
            {
              email: "samexample@gmail.com",
              display_name: "Sam Member",
              role: "Contributor",
              organization_id: "org_old",
              organization_name: "Old workspace",
              organization_created_at: new Date("2026-08-01T10:00:00Z"),
            },
            {
              email: "member@example.com",
              display_name: "Member",
              role: "Admin",
              organization_id: "org_member",
              organization_name: "Member workspace",
              organization_created_at: new Date("2026-08-15T10:00:00Z"),
            },
          ],
          rowCount: 3,
        };
      }
      if (statement.includes("SELECT email,display_name,sign_in_count")) {
        return {
          rows: [{
            email: "samexample@gmail.com",
            display_name: "Sam Operator",
            sign_in_count: 4,
            first_signed_in_at: new Date("2026-08-01T10:00:00Z"),
            last_signed_in_at: new Date("2026-08-20T10:00:00Z"),
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
  });

  it("records verified sign-ins and lists unique workspace users", async () => {
    await recordPlatformUserSignIn(
      "Sam.Example+login@googlemail.com",
      " Sam Operator ",
    );
    const users = await listActivePlatformUsers();

    expect(database.pool.query).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT(email) DO UPDATE SET"),
      ["samexample@gmail.com", "Sam Operator"],
    );
    expect(users).toEqual([
      {
        email: "samexample@gmail.com",
        displayName: "Sam Operator",
        signInCount: 4,
        firstJoinedAt: new Date("2026-08-01T10:00:00Z"),
        lastSignedInAt: new Date("2026-08-20T10:00:00Z"),
        organizations: [
          { id: "org_new", name: "New workspace", role: "Admin" },
          { id: "org_old", name: "Old workspace", role: "Contributor" },
        ],
      },
      {
        email: "member@example.com",
        displayName: "Member",
        signInCount: 0,
        firstJoinedAt: new Date("2026-08-15T10:00:00Z"),
        lastSignedInAt: new Date("2026-08-15T10:00:00Z"),
        organizations: [
          { id: "org_member", name: "Member workspace", role: "Admin" },
        ],
      },
    ]);
  });

  it("does not read or write platform activity in memory mode", async () => {
    database.mode = "memory";

    await recordPlatformUserSignIn("member@example.com", "Member");
    await expect(listActivePlatformUsers()).resolves.toEqual([]);
    expect(database.pool.query).not.toHaveBeenCalled();
  });
});
