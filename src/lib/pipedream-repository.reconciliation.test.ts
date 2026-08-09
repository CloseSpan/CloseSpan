import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  client: { query: vi.fn() },
  pool: { query: vi.fn() },
  transaction: vi.fn(),
}));

vi.mock("./db", () => ({
  databasePool: () => database.pool,
  persistenceMode: () => "postgres",
  transaction: database.transaction,
}));

import {
  claimPipedreamImport,
  disconnectPipedreamAccount,
  reconcilePipedreamAccounts,
  updatePipedreamImportCursor,
  updatePipedreamImportState,
} from "./pipedream-repository";

describe("Pipedream account reconciliation", () => {
  beforeEach(() => {
    database.client.query.mockReset();
    database.pool.query.mockReset();
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

  it("updates an import cursor through the caller's transaction client", async () => {
    database.client.query.mockResolvedValueOnce({
      rows: [{ id: "binding_alpha" }],
      rowCount: 1,
    });

    await updatePipedreamImportCursor(database.client as never, {
      orgId: "org_alpha",
      integrationId: "int_zendesk",
      accountId: "apn_alpha",
      cursor: "cursor_next",
      leaseToken: "9",
    });

    expect(database.client.query).toHaveBeenCalledWith(
      expect.stringContaining("SET import_cursor=$4"),
      ["org_alpha", "int_zendesk", "apn_alpha", "cursor_next", "9"],
    );
    expect(database.client.query.mock.calls[0]?.[0]).toContain(
      "import_generation=$5::bigint",
    );
  });

  it("refuses to commit a Postgres cursor without a transaction client", async () => {
    await expect(
      updatePipedreamImportCursor(null, {
        orgId: "org_alpha",
        integrationId: "int_zendesk",
        accountId: "apn_alpha",
        cursor: "cursor_next",
        leaseToken: "9",
      }),
    ).rejects.toThrow("pipedream_cursor_transaction_required");
  });

  it("atomically returns the cursor and a new fencing generation when claiming", async () => {
    database.pool.query.mockResolvedValueOnce({
      rows: [{ import_cursor: "cursor_before_claim", lease_token: "12" }],
      rowCount: 1,
    });

    await expect(
      claimPipedreamImport({
        orgId: "org_alpha",
        integrationId: "int_zendesk",
        accountId: "apn_alpha",
      }),
    ).resolves.toEqual({
      importCursor: "cursor_before_claim",
      leaseToken: "12",
    });

    const [sql, values] = database.pool.query.mock.calls[0];
    expect(sql).toContain("import_generation=import_generation + 1");
    expect(sql).toContain("import_claimed_at=now()");
    expect(sql).toContain(
      "import_claimed_at < now() - interval '5 minutes'",
    );
    expect(sql).toContain(
      "RETURNING import_cursor,import_generation::text AS lease_token",
    );
    expect(values).toEqual(["org_alpha", "int_zendesk", "apn_alpha"]);
  });

  it("rejects a terminal update from a stale import generation", async () => {
    database.pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(
      updatePipedreamImportState({
        orgId: "org_alpha",
        integrationId: "int_zendesk",
        accountId: "apn_alpha",
        status: "Succeeded",
        count: 12,
        safeError: null,
        leaseToken: "11",
      }),
    ).rejects.toThrow("stale_import_lease");

    const [sql, values] = database.pool.query.mock.calls[0];
    expect(sql).toContain("last_import_status='Running'");
    expect(sql).toContain("import_generation=$7::bigint");
    expect(sql).toContain("import_claimed_at=NULL");
    expect(values).toEqual([
      "org_alpha",
      "int_zendesk",
      "apn_alpha",
      "Succeeded",
      12,
      null,
      "11",
    ]);
  });
});
