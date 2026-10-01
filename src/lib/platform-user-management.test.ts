import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";

const state = vi.hoisted(() => ({
  mode: "postgres",
  query: vi.fn(),
  statuses: [] as { email: string; status: string }[],
  previous: [] as { target_email: string; action: string }[],
  members: [] as { id: string; org_id: string; email: string; role: string; organization_name: string }[],
  committed: false,
  rolledBack: false,
}));
vi.mock("./db", () => ({
  persistenceMode: () => state.mode,
  transaction: async (work: (client: PoolClient) => Promise<unknown>) => {
    try { const result = await work({ query: state.query } as unknown as PoolClient); state.committed = true; return result; }
    catch (error) { state.rolledBack = true; throw error; }
  },
}));
vi.mock("./platform-user-access", () => ({ ensurePlatformUserAccessSchema: vi.fn() }));

import { managePlatformUser, type ManagePlatformUserInput } from "./platform-user-management";

const input: ManagePlatformUserInput = { actor: { email: "shanmukhsain@gmail.com", role: "Admin" }, email: "person@example.com", action: "block", expectedStatus: "Active", requestId: "manage_user_test" };
const target = { id: "member_a", org_id: "org_a", email: input.email, role: "Admin", organization_name: "Acme" };
beforeEach(() => {
  state.mode = "postgres"; state.statuses = []; state.previous = [];
  state.members = [target]; state.committed = false; state.rolledBack = false;
  state.query.mockReset().mockImplementation(async (sql: string) => ({ rows:
    sql.startsWith("SELECT email,status") ? state.statuses :
      sql.startsWith("SELECT status FROM") ? state.statuses.filter((row) => row.email === input.email) :
      sql.startsWith("SELECT target_email,action") ? state.previous :
        sql.includes("FROM workspace_members member") ? state.members : [],
  }));
});

describe("platform account management", () => {
  it("blocks an account without deleting any memberships or workspaces and records the actor", async () => {
    await expect(managePlatformUser(input)).resolves.toEqual({ status: "Blocked" });
    expect(state.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO platform_user_access"), [input.email, "Blocked"]);
    expect(state.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO platform_user_admin_events"), [expect.any(String), input.actor.email, input.email, "block", "Active", '["org_a"]', input.requestId]);
    expect(state.query.mock.calls.some(([sql]) => sql.includes("DELETE"))).toBe(false);
    expect(state.committed).toBe(true);
  });
  it("unblocks existing memberships", async () => {
    state.statuses = [{ email: input.email, status: "Blocked" }];
    await expect(managePlatformUser({ ...input, action: "unblock", expectedStatus: "Blocked" })).resolves.toEqual({ status: "Active" });
  });
  it.each([
    { email: "admin@another-tenant.com", role: "Admin" },
    { email: input.actor.email, role: "Viewer" },
  ])("rejects non-platform administrators", async (actor) => {
    await expect(managePlatformUser({ ...input, actor })).rejects.toMatchObject({ status: 403 });
    expect(state.query).not.toHaveBeenCalled();
  });
  it("protects the owner through canonical Google aliases", async () => {
    await expect(managePlatformUser({ ...input, email: "Shanmukh.Sain+alias@googlemail.com" })).rejects.toMatchObject({ status: 403 });
    expect(state.query).not.toHaveBeenCalled();
  });
  it("requires typed confirmation for deletion", async () => {
    await expect(managePlatformUser({ ...input, action: "delete", confirmationEmail: "wrong@example.com" })).rejects.toMatchObject({ status: 400 });
    expect(state.query).not.toHaveBeenCalled();
  });
  it("prevents deletion of a sole administrator", async () => {
    await expect(managePlatformUser({ ...input, action: "delete", confirmationEmail: input.email })).rejects.toThrow("Assign another active admin in Acme");
    expect(state.query.mock.calls.some(([sql]) => sql.includes("DELETE"))).toBe(false);
    expect(state.rolledBack).toBe(true);
  });
  it("does not count a blocked admin or an alias of the target as a replacement admin", async () => {
    state.members.push({ ...target, id: "member_b", email: "blocked@example.com" });
    state.statuses = [{ email: "blocked@example.com", status: "Blocked" }];
    await expect(managePlatformUser({ ...input, action: "delete", confirmationEmail: input.email })).rejects.toMatchObject({ status: 409 });
  });
  it("deletes only target memberships and sign-in history, preserving tenant data and a denial tombstone", async () => {
    state.members.push({ ...target, id: "member_b", email: "other@example.com" });
    await expect(managePlatformUser({ ...input, action: "delete", confirmationEmail: input.email })).resolves.toEqual({ status: "Deleted" });
    expect(state.query).toHaveBeenCalledWith("DELETE FROM workspace_members WHERE org_id=$1 AND id=$2", ["org_a", "member_a"]);
    expect(state.query).toHaveBeenCalledWith("DELETE FROM platform_user_activity WHERE email=$1", [input.email]);
    expect(state.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO platform_user_access"), [input.email, "Deleted"]);
    expect(state.query.mock.calls.some(([sql]) => sql.includes("DELETE FROM organizations"))).toBe(false);
  });
  it("guards every workspace against losing its last admin", async () => {
    state.members.push({ ...target, id: "member_b", email: "other@example.com" }, { ...target, id: "member_c", org_id: "org_b", organization_name: "Beta" });
    await expect(managePlatformUser({ ...input, action: "delete", confirmationEmail: input.email })).rejects.toThrow("active admin in Beta");
  });
  it("rejects stale state without changing access", async () => {
    state.statuses = [{ email: input.email, status: "Blocked" }];
    await expect(managePlatformUser(input)).rejects.toMatchObject({ status: 409 });
    expect(state.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO"))).toBe(false);
  });
  it("replays a matching retry without repeating deletion", async () => {
    state.previous = [{ target_email: input.email, action: "delete" }];
    state.statuses = [{ email: input.email, status: "Deleted" }];
    await expect(managePlatformUser({ ...input, action: "delete", confirmationEmail: input.email })).resolves.toEqual({ status: "Deleted" });
    expect(state.query.mock.calls.some(([sql]) => sql.includes("DELETE"))).toBe(false);
  });
  it("does not report a stale block retry as successful after the account was unblocked", async () => {
    state.previous = [{ target_email: input.email, action: "block" }];
    state.statuses = [{ email: input.email, status: "Active" }];
    await expect(managePlatformUser(input)).rejects.toMatchObject({ status: 409 });
  });
  it("rejects reuse of an idempotency key for a different target or action", async () => {
    state.previous = [{ target_email: "other@example.com", action: "block" }];
    await expect(managePlatformUser(input)).rejects.toMatchObject({ status: 409 });
  });
  it("rolls back when the audit insert fails", async () => {
    const original = state.query.getMockImplementation()!;
    state.query.mockImplementation(async (sql: string) => { if (sql.includes("INSERT INTO platform_user_admin_events")) throw new Error("offline"); return original(sql); });
    await expect(managePlatformUser(input)).rejects.toThrow("offline");
    expect(state.committed).toBe(false); expect(state.rolledBack).toBe(true);
  });
  it("never simulates a successful mutation in memory mode", async () => {
    state.mode = "memory";
    await expect(managePlatformUser(input)).rejects.toMatchObject({ status: 503 });
    expect(state.query).not.toHaveBeenCalled();
  });
});
