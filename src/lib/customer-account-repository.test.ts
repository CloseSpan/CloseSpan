import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  customerAccountId,
  resolveOrCreateExternalAccount,
} from "./customer-account-repository";

const client = {
  query: vi.fn(),
};

function normalizedSql(sql: unknown): string {
  return typeof sql === "string" ? sql.replace(/\s+/g, " ").trim() : "";
}

function expectSqlBindingsToMatch(
  calls: readonly unknown[][],
): void {
  for (const call of calls) {
    const [sql, values] = call;
    if (typeof sql !== "string" || !Array.isArray(values)) continue;
    const placeholders = [...sql.matchAll(/\$(\d+)/g)]
      .map((match) => Number(match[1]));
    expect(Math.max(0, ...placeholders)).toBe(values.length);
  }
}

describe("customer account repository", () => {
  beforeEach(() => {
    client.query.mockReset().mockImplementation(async (sql: unknown) => {
      if (normalizedSql(sql).includes("SELECT account_id FROM account_source_links")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });
  });

  it("derives stable identities that remain isolated by tenant and source", () => {
    const identity = {
      orgId: "org_alpha",
      integrationId: "int_zendesk",
      sourceNamespace: "pipedream:account-1:zendesk:organizations",
      externalAccountId: "42",
    };

    expect(customerAccountId(identity)).toBe(customerAccountId(identity));
    expect(customerAccountId({ ...identity, orgId: "org_beta" }))
      .not.toBe(customerAccountId(identity));
    expect(customerAccountId({ ...identity, integrationId: "int_webhook" }))
      .not.toBe(customerAccountId(identity));
    expect(customerAccountId({ ...identity, externalAccountId: "43" }))
      .not.toBe(customerAccountId(identity));
  });

  it("creates one canonical account and a tenant-scoped source link", async () => {
    const sourceUpdatedAt = new Date("2026-08-08T12:00:00.000Z");
    const result = await resolveOrCreateExternalAccount(client, {
      orgId: "org_alpha",
      integrationId: "int_webhook",
      sourceNamespace: "direct",
      externalAccountId: "customer-42",
      name: " Acme   Health ",
      domain: "ACME.EXAMPLE",
      tier: "Enterprise",
      arr: 210_000,
      sourceAuthority: "webhook",
      revenueAuthority: "webhook",
      customerSince: 2022,
      sourceUpdatedAt,
    });

    expect(result).toEqual({
      accountId: customerAccountId({
        orgId: "org_alpha",
        integrationId: "int_webhook",
        sourceNamespace: "direct",
        externalAccountId: "customer-42",
      }),
      created: true,
    });

    const calls = client.query.mock.calls;
    expect(normalizedSql(calls[0]?.[0])).toContain("pg_advisory_xact_lock");
    expect(calls[0]?.[1]).toEqual([
      "org_alpha:int_webhook:direct:customer-42",
    ]);

    const accountInsert = calls.find(([sql]) =>
      normalizedSql(sql).includes("INSERT INTO accounts"),
    );
    expect(accountInsert?.[1]).toEqual([
      result.accountId,
      "org_alpha",
      "Acme Health",
      210_000,
      "Enterprise",
      2022,
      "Unknown",
      "webhook",
      40,
      sourceUpdatedAt,
      "webhook",
      40,
      sourceUpdatedAt,
      true,
    ]);

    const sourceInsert = calls.find(([sql]) =>
      normalizedSql(sql).includes("INSERT INTO account_source_links"),
    );
    expect(sourceInsert?.[1]).toEqual([
      "org_alpha",
      "int_webhook",
      "direct",
      "customer-42",
      result.accountId,
      "Acme Health",
      "acme.example",
      null,
      sourceUpdatedAt,
      "{}",
    ]);
    expectSqlBindingsToMatch(client.query.mock.calls);
  });

  it("reuses an existing source identity instead of creating a duplicate account", async () => {
    client.query.mockImplementation(async (sql: unknown) => {
      if (normalizedSql(sql).includes("SELECT account_id FROM account_source_links")) {
        return { rows: [{ account_id: "acct_existing" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    const result = await resolveOrCreateExternalAccount(client, {
      orgId: "org_alpha",
      integrationId: "int_zendesk",
      sourceNamespace: "pipedream:account-1:zendesk:organizations",
      externalAccountId: "42",
      name: "Acme Health",
    });

    expect(result).toEqual({ accountId: "acct_existing", created: false });
    const statements = client.query.mock.calls.map(([sql]) => normalizedSql(sql));
    expect(statements.some((sql) => sql.includes("INSERT INTO accounts")))
      .toBe(false);
    expect(statements.some((sql) => sql.includes("INSERT INTO account_source_links")))
      .toBe(false);
    expect(statements.some((sql) => sql.includes("UPDATE accounts SET")))
      .toBe(true);
    expect(statements.some((sql) => sql.includes("UPDATE account_source_links SET")))
      .toBe(true);
  });

  it("relinks a reconnected source only through an explicit trusted namespace alias", async () => {
    client.query.mockImplementation(async (sql: unknown, values?: unknown[]) => {
      const statement = normalizedSql(sql);
      if (
        statement.includes("source_namespace=$3") &&
        statement.includes("external_account_id=$4") &&
        statement.includes("SELECT account_id")
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (
        statement.includes("source_namespace=ANY($3::text[])") &&
        statement.includes("SELECT account_id")
      ) {
        expect(values).toEqual([
          "org_alpha",
          "int_zendesk",
          ["pipedream:old-connection:zendesk:organizations"],
          "42",
        ]);
        return { rows: [{ account_id: "acct_existing" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    const result = await resolveOrCreateExternalAccount(client, {
      orgId: "org_alpha",
      integrationId: "int_zendesk",
      sourceNamespace: "zendesk:acme.zendesk.com:organizations",
      sourceNamespaceAliases: [
        "pipedream:old-connection:zendesk:organizations",
      ],
      externalAccountId: "42",
      name: "Acme Health",
      domain: "acme.example",
      sourceAuthority: "zendesk",
    });

    expect(result).toEqual({ accountId: "acct_existing", created: false });
    const sourceInsert = client.query.mock.calls.find(([sql]) =>
      normalizedSql(sql).includes("INSERT INTO account_source_links"),
    );
    expect(sourceInsert?.[1]?.slice(0, 5)).toEqual([
      "org_alpha",
      "int_zendesk",
      "zendesk:acme.zendesk.com:organizations",
      "42",
      "acct_existing",
    ]);
    expect(client.query.mock.calls.some(([sql]) =>
      normalizedSql(sql).includes("source_domain") &&
      normalizedSql(sql).startsWith("SELECT")
    )).toBe(false);
    expectSqlBindingsToMatch(client.query.mock.calls);
  });

  it("does not merge accounts solely from an unverified shared domain", async () => {
    client.query.mockImplementation(async (sql: unknown) => {
      const statement = normalizedSql(sql);
      if (statement.includes("SELECT account_id FROM account_source_links")) {
        return { rows: [], rowCount: 0 };
      }
      if (statement.includes("SELECT min(account_id) account_id")) {
        return { rows: [{ account_id: "acct_existing" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    const result = await resolveOrCreateExternalAccount(client, {
      orgId: "org_alpha",
      integrationId: "int_webhook",
      sourceNamespace: "direct",
      externalAccountId: "webhook-customer-9",
      name: "Acme Health",
      domain: "ACME.EXAMPLE",
      sourceAuthority: "webhook",
    });

    const expectedAccountId = customerAccountId({
      orgId: "org_alpha",
      integrationId: "int_webhook",
      sourceNamespace: "direct",
      externalAccountId: "webhook-customer-9",
    });
    expect(result).toEqual({ accountId: expectedAccountId, created: true });

    const statements = client.query.mock.calls.map(([sql]) => normalizedSql(sql));
    expect(statements.some((sql) => sql.includes("SELECT min(account_id) account_id")))
      .toBe(false);
    expect(statements.some((sql) => sql.includes("INSERT INTO accounts")))
      .toBe(true);
    const sourceInsert = client.query.mock.calls.find(([sql]) =>
      normalizedSql(sql).includes("INSERT INTO account_source_links"),
    );
    expect(sourceInsert?.[1]?.[4]).toBe(expectedAccountId);
  });

  it("does not let absent Zendesk revenue compete with an existing ARR source", async () => {
    client.query.mockImplementation(async (sql: unknown) => {
      if (normalizedSql(sql).includes("SELECT account_id FROM account_source_links")) {
        return { rows: [{ account_id: "acct_existing" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    await resolveOrCreateExternalAccount(client, {
      orgId: "org_alpha",
      integrationId: "int_zendesk",
      sourceNamespace: "pipedream:account-1:zendesk:organizations",
      externalAccountId: "42",
      name: "Acme Health",
      revenueAuthority: "zendesk",
    });

    const accountUpdate = client.query.mock.calls.find(([sql]) =>
      normalizedSql(sql).includes("UPDATE accounts SET"),
    );
    expect(accountUpdate?.[1]?.[6]).toBeNull();
    expect(accountUpdate?.[1]?.[7]).toBe(0);
    expect(accountUpdate?.[1]?.[8]).toBe("unknown");
    expect(accountUpdate?.[1]?.[10]).toBe(0);
    expect(accountUpdate?.[1]?.[11]).toBe("unknown");
    expect(normalizedSql(accountUpdate?.[0])).toContain(
      "WHEN $7::integer IS NOT NULL",
    );
  });

  it("guards profile, revenue, and source metadata from stale events", async () => {
    client.query.mockImplementation(async (sql: unknown) => {
      if (normalizedSql(sql).includes("SELECT account_id FROM account_source_links")) {
        return { rows: [{ account_id: "acct_existing" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    const staleSourceTime = new Date("2026-01-01T00:00:00.000Z");
    await resolveOrCreateExternalAccount(client, {
      orgId: "org_alpha",
      integrationId: "int_webhook",
      sourceNamespace: "direct",
      externalAccountId: "customer-42",
      name: "Stale customer name",
      domain: "stale.example",
      tier: "Starter",
      arr: 1,
      sourceAuthority: "webhook",
      revenueAuthority: "webhook",
      sourceUpdatedAt: staleSourceTime,
    });

    const accountUpdate = client.query.mock.calls.find(([sql]) =>
      normalizedSql(sql).includes("UPDATE accounts SET"),
    );
    const accountSql = normalizedSql(accountUpdate?.[0]);
    expect(accountSql).toContain(
      "$8::smallint = profile_source_priority AND $10::timestamptz >= profile_source_updated_at",
    );
    expect(accountSql).toContain(
      "$11::smallint = arr_source_priority AND $13::timestamptz >= arr_source_updated_at",
    );
    expect(accountUpdate?.[1]?.[9]).toEqual(staleSourceTime);
    expect(accountUpdate?.[1]?.[12]).toEqual(staleSourceTime);

    const sourceUpdate = client.query.mock.calls.find(([sql]) =>
      normalizedSql(sql).includes("UPDATE account_source_links SET"),
    );
    const sourceSql = normalizedSql(sourceUpdate?.[0]);
    expect(sourceSql).toContain(
      "$8::timestamptz IS NULL OR source_updated_at IS NULL OR $8 >= source_updated_at",
    );
    expect(sourceUpdate?.[1]?.[7]).toEqual(staleSourceTime);
  });

  it("rejects source timestamps beyond the allowed clock skew", async () => {
    const futureSourceTime = new Date(Date.now() + 6 * 60 * 1000);

    await expect(
      resolveOrCreateExternalAccount(client, {
        orgId: "org_alpha",
        integrationId: "int_webhook",
        sourceNamespace: "direct",
        externalAccountId: "customer-42",
        name: "Acme Health",
        sourceUpdatedAt: futureSourceTime,
      }),
    ).rejects.toThrow("sourceUpdatedAt cannot be in the future");
    expect(client.query).not.toHaveBeenCalled();
  });

  it("rejects incomplete source identities before acquiring a database lock", async () => {
    await expect(
      resolveOrCreateExternalAccount(client, {
        orgId: "org_alpha",
        integrationId: "int_webhook",
        sourceNamespace: "direct",
        externalAccountId: " ",
        name: "Acme Health",
      }),
    ).rejects.toThrow("A stable source identity and customer name are required");
    expect(client.query).not.toHaveBeenCalled();
  });
});
