import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  client: { query: vi.fn() },
  pool: { query: vi.fn() },
  transaction: vi.fn(),
  mode: "postgres",
  workspaceMode: "postgres",
}));

vi.mock("./db", () => ({
  persistenceMode: () => database.mode,
  databasePool: () => database.pool,
  transaction: database.transaction,
}));

vi.mock("./workspace-persistence", () => ({
  workspacePersistenceMode: () => database.workspaceMode,
}));

import { integrationCatalog } from "./integration-catalog";
import {
  createOrganization,
  deleteOrganization,
  findOrganizationMembership,
  listOrganizationMemberships,
  normalizeMembershipEmail,
  renameOrganization,
  selectOrganizationMembership,
} from "./organization-repository";

const sqlIncludes = (sql: unknown, text: string) =>
  typeof sql === "string" && sql.replace(/\s+/g, " ").includes(text);

describe("organization repository", () => {
  beforeEach(() => {
    database.mode = "postgres";
    database.workspaceMode = "postgres";
    database.client.query.mockReset().mockResolvedValue({ rows: [], rowCount: 1 });
    database.pool.query.mockReset();
    database.transaction.mockReset().mockImplementation(
      async (work: (client: typeof database.client) => Promise<unknown>) =>
        work(database.client),
    );
  });

  it("normalizes Gmail aliases without changing dotted corporate addresses", () => {
    expect(normalizeMembershipEmail("Sam.Example+ops@googlemail.com"))
      .toBe("samexample@gmail.com");
    expect(normalizeMembershipEmail("Sam.Example@Company.com"))
      .toBe("sam.example@company.com");
  });

  it("lists memberships and validates an organization against that trusted list", async () => {
    database.pool.query.mockResolvedValue({
      rows: [
        {
          member_id: "member_a",
          org_id: "org_a",
          organization_name: "Alpha",
          display_name: "Sam",
          email: "sam@example.com",
          role: "Admin",
        },
        {
          member_id: "member_b",
          org_id: "org_b",
          organization_name: "Beta",
          display_name: "Sam",
          email: "sam@example.com",
          role: "Viewer",
        },
      ],
    });

    const listed = await listOrganizationMemberships("sam@example.com");
    const selected = selectOrganizationMembership(listed, "org_b");
    const denied = await findOrganizationMembership(
      "sam@example.com",
      "org_outside_membership",
    );

    expect(selected).toMatchObject({
      memberId: "member_b",
      organizationId: "org_b",
      role: "Viewer",
    });
    expect(denied).toBeNull();
    expect(database.pool.query).toHaveBeenCalledWith(
      expect.stringContaining("FROM workspace_members"),
      ["sam@example.com"],
    );
    const membershipSql = database.pool.query.mock.calls[0]?.[0];
    expect(membershipSql).toContain("IN ('gmail.com','googlemail.com')");
    expect(membershipSql).toContain(
      "ELSE lower(split_part(btrim(m.email), '@', 1))",
    );
  });

  it("provisions every tenant-owned foundation record in one transaction", async () => {
    const result = await createOrganization({
      name: "  Northstar Labs  ",
      productName: "Northstar",
      productUrl: "https://northstar.example",
      productDescription: "Customer operations software",
      creator: { name: "Sam Operator", email: "SAM@example.com" },
    });

    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(result.organizationName).toBe("Northstar Labs");
    expect(result.organizationId).toMatch(/^org_[a-f0-9]{32}$/);
    expect(result.workspaceId).toMatch(/^ws_[a-f0-9]{32}$/);
    expect(result.memberId).toMatch(/^user_[a-f0-9]{32}$/);

    const calls = database.client.query.mock.calls;
    expect(calls.some(([sql, values]) =>
      sqlIncludes(sql, "INSERT INTO organizations") &&
      values[0] === result.organizationId &&
      values[1] === "Northstar Labs",
    )).toBe(true);
    expect(calls.some(([sql, values]) =>
      sqlIncludes(sql, "INSERT INTO workspace_members") &&
      values[1] === result.organizationId &&
      values[3] === "sam@example.com",
    )).toBe(true);
    expect(calls.some(([sql, values]) =>
      sqlIncludes(sql, "INSERT INTO workspace_onboarding") &&
      values[0] === result.organizationId &&
      JSON.parse(values[1]).productName === "Northstar",
    )).toBe(true);
    expect(
      calls.filter(([sql]) => sqlIncludes(sql, "INSERT INTO integrations")),
    ).toHaveLength(integrationCatalog.length);
    expect(calls.some(([sql, values]) =>
      sqlIncludes(sql, "INSERT INTO audit_events") &&
      values[1] === result.organizationId,
    )).toBe(true);
  });

  it("rejects an empty organization name before opening a transaction", async () => {
    await expect(
      createOrganization({
        name: "   ",
        creator: { name: "Sam", email: "sam@example.com" },
      }),
    ).rejects.toThrow("Organization name is required");
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("renames the organization and workspace and audits the actor in one transaction", async () => {
    const result = await renameOrganization({
      orgId: "org_northstar",
      name: "  Northstar Workspace  ",
      actor: {
        actorId: "member_admin",
        actorName: "Sam Operator",
        traceId: "trace_request_123",
      },
    });

    expect(result).toEqual({
      organizationId: "org_northstar",
      organizationName: "Northstar Workspace",
    });
    expect(database.transaction).toHaveBeenCalledTimes(1);

    const organizationUpdate = database.client.query.mock.calls.find(([sql]) =>
      sqlIncludes(sql, "UPDATE organizations SET name=$2,updated_at=now() WHERE id=$1"),
    );
    expect(organizationUpdate?.[1]).toEqual([
      "org_northstar",
      "Northstar Workspace",
    ]);

    const workspaceUpdate = database.client.query.mock.calls.find(([sql]) =>
      sqlIncludes(sql, "UPDATE workspaces SET name=$2,version=version+1,updated_at=now() WHERE org_id=$1"),
    );
    expect(workspaceUpdate?.[1]).toEqual([
      "org_northstar",
      "Northstar Workspace",
    ]);

    const auditInsert = database.client.query.mock.calls.find(([sql]) =>
      sqlIncludes(sql, "INSERT INTO audit_events"),
    );
    expect(auditInsert?.[1]).toEqual([
      expect.stringMatching(/^[a-f0-9-]{36}$/),
      "org_northstar",
      "member_admin",
      "Sam Operator",
      "Renamed workspace to Northstar Workspace",
      expect.stringMatching(
        /^trace_request_123_organization_renamed_[a-f0-9-]{36}$/,
      ),
    ]);
  });

  it.each([
    ["   ", "Organization name is required"],
    ["x".repeat(121), "Organization name must be 120 characters or fewer"],
  ])("rejects an invalid rename before opening a transaction", async (name, message) => {
    await expect(
      renameOrganization({
        orgId: "org_northstar",
        name,
        actor: {
          actorId: "member_admin",
          actorName: "Sam Operator",
          traceId: "trace_request_123",
        },
      }),
    ).rejects.toThrow(message);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("requires PostgreSQL persistence for a rename", async () => {
    database.mode = "postgres";
    database.workspaceMode = "memory";

    await expect(
      renameOrganization({
        orgId: "org_northstar",
        name: "Northstar Workspace",
        actor: {
          actorId: "member_admin",
          actorName: "Sam Operator",
          traceId: "trace_request_123",
        },
      }),
    ).rejects.toThrow(
      "PostgreSQL persistence is required to rename organizations",
    );
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("rejects an unknown organization without updating a workspace or auditing", async () => {
    database.client.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(
      renameOrganization({
        orgId: "org_unknown",
        name: "Unknown Workspace",
        actor: {
          actorId: "member_admin",
          actorName: "Sam Operator",
          traceId: "trace_request_123",
        },
      }),
    ).rejects.toThrow("Organization was not found");

    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(database.client.query).toHaveBeenCalledTimes(1);
    expect(database.client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE workspaces"),
      expect.anything(),
    );
    expect(database.client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_events"),
      expect.anything(),
    );
  });

  it("rolls back instead of auditing when the organization has no workspace", async () => {
    database.client.query
      .mockResolvedValueOnce({ rows: [{ id: "org_northstar" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(
      renameOrganization({
        orgId: "org_northstar",
        name: "Northstar Workspace",
        actor: {
          actorId: "member_admin",
          actorName: "Sam Operator",
          traceId: "trace_request_123",
        },
      }),
    ).rejects.toThrow("Workspace was not found");

    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(database.client.query).toHaveBeenCalledTimes(2);
    expect(database.client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_events"),
      expect.anything(),
    );
  });

  it("deletes only an organization owned by the authorized administrator", async () => {
    database.pool.query.mockResolvedValue({
      rows: [{ id: "org_northstar" }],
      rowCount: 1,
    });

    await deleteOrganization({
      orgId: "org_northstar",
      actorMemberId: "member_admin",
    });

    expect(database.pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM organizations[\s\S]*workspace_members[\s\S]*member\.role='Admin'/),
      ["org_northstar", "member_admin"],
    );
  });

  it("rejects deletion when administrator access is missing or revoked", async () => {
    database.pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await expect(
      deleteOrganization({
        orgId: "org_northstar",
        actorMemberId: "member_viewer",
      }),
    ).rejects.toThrow(
      "Organization was not found or administrator access was revoked",
    );
  });

  it("requires PostgreSQL persistence for deletion", async () => {
    database.workspaceMode = "memory";

    await expect(
      deleteOrganization({
        orgId: "org_demo",
        actorMemberId: "member_admin",
      }),
    ).rejects.toThrow(
      "PostgreSQL persistence is required to delete organizations",
    );
    expect(database.pool.query).not.toHaveBeenCalled();
  });
});
