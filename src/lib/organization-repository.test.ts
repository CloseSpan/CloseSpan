import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  client: { query: vi.fn() },
  pool: { query: vi.fn() },
  transaction: vi.fn(),
}));

vi.mock("./db", () => ({
  persistenceMode: () => "postgres",
  databasePool: () => database.pool,
  transaction: database.transaction,
}));

import { integrationCatalog } from "./integration-catalog";
import {
  createOrganization,
  findOrganizationMembership,
  listOrganizationMemberships,
  normalizeMembershipEmail,
  selectOrganizationMembership,
} from "./organization-repository";

const sqlIncludes = (sql: unknown, text: string) =>
  typeof sql === "string" && sql.replace(/\s+/g, " ").includes(text);

describe("organization repository", () => {
  beforeEach(() => {
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
});
