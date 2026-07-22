import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  client: { query: vi.fn() },
  transaction: vi.fn(),
}));

vi.mock("./db", () => ({
  databasePool: vi.fn(),
  persistenceMode: () => "postgres",
  transaction: database.transaction,
}));

import {
  disconnectPipedreamAccount,
  reconcilePipedreamAccounts,
} from "./pipedream-repository";

describe("Pipedream account reconciliation", () => {
  beforeEach(() => {
    database.client.query.mockReset();
    database.transaction.mockReset().mockImplementation(
      async (work: (client: typeof database.client) => Promise<unknown>) =>
        work(database.client),
    );
  });

  it("disconnects only stale tenant bindings absent from the complete upstream set", async () => {
    database.client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ state: "Connected" }, { state: "Needs reconnect" }],
        rowCount: 2,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const verifiedBefore = new Date("2026-07-21T20:00:00.000Z");

    await reconcilePipedreamAccounts({
      orgId: "org_alpha",
      integrationId: "int_zendesk",
      upstreamAccountIds: ["apn_keep", "apn_keep"],
      verifiedBefore,
    });

    const [disconnectSql, disconnectValues] = database.client.query.mock.calls[0];
    expect(disconnectSql).toContain("org_id=$1 AND integration_id=$2");
    expect(disconnectSql).toContain("NOT (account_id=ANY($3::text[]))");
    expect(disconnectSql).toContain("last_verified_at <= $4");
    expect(disconnectValues).toEqual([
      "org_alpha",
      "int_zendesk",
      ["apn_keep"],
      verifiedBefore,
    ]);
    expect(database.client.query.mock.calls[2]?.[1]).toEqual([
      "org_alpha",
      "int_zendesk",
      "Connected",
    ]);
  });

  it("keeps the integration in reconnect state when another unhealthy account remains", async () => {
    database.client.query
      .mockResolvedValueOnce({ rows: [{ id: "binding_removed" }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ state: "Needs reconnect" }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await expect(
      disconnectPipedreamAccount({
        orgId: "org_alpha",
        integrationId: "int_zendesk",
        accountId: "apn_removed",
      }),
    ).resolves.toBe(true);

    expect(database.client.query.mock.calls[2]?.[1]).toEqual([
      "org_alpha",
      "int_zendesk",
      "Needs reconnect",
    ]);
  });
});
