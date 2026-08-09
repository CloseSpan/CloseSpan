import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const database = vi.hoisted(() => ({
  mode: "postgres" as "memory" | "postgres",
  client: {
    query: vi.fn(),
    release: vi.fn(),
  },
  pool: {
    connect: vi.fn(),
    query: vi.fn(),
  },
}));

const accounts = vi.hoisted(() => ({
  resolve: vi.fn(),
}));

vi.mock("./db", () => ({
  persistenceMode: () => database.mode,
  databasePool: () => database.pool,
}));

vi.mock("./customer-account-repository", () => ({
  resolveOrCreateExternalAccount: accounts.resolve,
}));

vi.mock("./integration-catalog", () => ({
  integrationCatalog: [],
}));

vi.mock("./ai-config", () => ({
  getAiPublicConfiguration: vi.fn(async () => ({
    configured: false,
    connectionStatus: "missing",
  })),
}));

vi.mock("./pipedream-repository", () => ({
  listPipedreamConnections: vi.fn(async () => []),
}));

import { ingestWebhookFeedback } from "./integration-repository";

type QueryResult = {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
};

function result(
  rows: Array<Record<string, unknown>> = [],
  rowCount = rows.length,
): QueryResult {
  return { rows, rowCount };
}

function expectedFeedbackId(
  orgId: string,
  integrationId: string,
  externalId: string,
): string {
  return `fb_webhook_${createHash("sha256")
    .update(JSON.stringify([orgId, integrationId, "direct", externalId]))
    .digest("hex")
    .slice(0, 32)}`;
}

describe("custom webhook customer materialization", () => {
  beforeEach(() => {
    database.mode = "postgres";
    database.client.query.mockReset();
    database.client.release.mockReset();
    database.pool.connect.mockReset().mockResolvedValue(database.client);
    database.pool.query.mockReset();
    accounts.resolve.mockReset().mockResolvedValue({
      accountId: "acct_customer_42",
      created: true,
    });

    database.client.query.mockImplementation(
      (sql: string, values?: unknown[]) => {
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
          return Promise.resolve(result());
        }
        if (sql.includes("INSERT INTO webhook_deliveries")) {
          return Promise.resolve(result([{ id: "delivery_row" }], 1));
        }
        if (
          sql.includes("SELECT id,account_id FROM feedback_items") &&
          sql.includes("FOR UPDATE")
        ) {
          return Promise.resolve(result());
        }
        if (
          sql.includes("SELECT id,account_id FROM feedback_items") &&
          sql.includes("LIMIT 1")
        ) {
          return Promise.resolve(result());
        }
        if (sql.includes("INSERT INTO feedback_items")) {
          const accountId = values?.[12] ?? null;
          return Promise.resolve(result([{ account_id: accountId }], 1));
        }
        if (sql.includes("UPDATE integrations")) {
          return Promise.resolve(result([], 1));
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    );
  });

  it("creates and links an account when a stable customer ID is supplied", async () => {
    const output = await ingestWebhookFeedback(
      "org_alpha",
      "int_webhook",
      "delivery_42",
      {
        id: "event_42",
        customerId: "customer_42",
        customer: "Acme Health",
        customerDomain: "acme.example",
        customerSince: 2022,
        churnRisk: "Elevated",
        sourceUpdatedAt: "2026-08-08T20:00:00.000Z",
        quote: "Exports are empty",
        accountTier: "Enterprise",
        arr: 210_000,
      },
    );

    expect(accounts.resolve).toHaveBeenCalledWith(
      database.client,
      expect.objectContaining({
        orgId: "org_alpha",
        integrationId: "int_webhook",
        sourceNamespace: "direct",
        externalAccountId: "customer_42",
        name: "Acme Health",
        domain: "acme.example",
        tier: "Enterprise",
        arr: 210_000,
        revenueAuthority: "webhook",
        customerSince: 2022,
        churnRisk: "Elevated",
        sourceUpdatedAt: new Date("2026-08-08T20:00:00.000Z"),
      }),
    );
    expect(output).toEqual({
      feedbackId: expectedFeedbackId(
        "org_alpha",
        "int_webhook",
        "event_42",
      ),
      created: true,
      accountId: "acct_customer_42",
    });

    const feedbackInsert = database.client.query.mock.calls.find(
      ([sql]) =>
        typeof sql === "string" && sql.includes("INSERT INTO feedback_items"),
    );
    expect(feedbackInsert?.[0]).toContain("external_id, account_id");
    expect(feedbackInsert?.[0]).toContain(
      "ON CONFLICT (org_id, integration_id, source_namespace, external_id)",
    );
    expect(feedbackInsert?.[1]?.[0]).toBe(
      expectedFeedbackId("org_alpha", "int_webhook", "event_42"),
    );
    expect(feedbackInsert?.[1]?.[11]).toBe("event_42");
    expect(feedbackInsert?.[1]?.at(-1)).toBe("acct_customer_42");
    for (const [sql, values] of database.client.query.mock.calls) {
      if (typeof sql !== "string" || !Array.isArray(values)) continue;
      const placeholders = [...sql.matchAll(/\$(\d+)/g)]
        .map((match) => Number(match[1]));
      expect(Math.max(0, ...placeholders)).toBe(values.length);
    }
  });

  it("keeps name-only legacy webhook feedback unresolved", async () => {
    const output = await ingestWebhookFeedback(
      "org_alpha",
      "int_webhook",
      "delivery_legacy",
      {
        customer: "Acme Health",
        quote: "Exports are empty",
      },
    );

    expect(accounts.resolve).not.toHaveBeenCalled();
    expect(output).toEqual({
      feedbackId: expectedFeedbackId(
        "org_alpha",
        "int_webhook",
        "delivery_legacy",
      ),
      created: true,
      accountId: null,
    });
    const feedbackInsert = database.client.query.mock.calls.find(
      ([sql]) =>
        typeof sql === "string" && sql.includes("INSERT INTO feedback_items"),
    );
    expect(feedbackInsert?.[1]?.at(-1)).toBeNull();
    expect(feedbackInsert?.[1]?.[3]).toBe("Unknown");
  });

  it("does not create a real account for an internal setup test", async () => {
    const output = await ingestWebhookFeedback(
      "org_alpha",
      "int_webhook",
      "delivery_test",
      {
        customerId: "test_customer",
        customer: "Test customer",
        quote: "Test feedback",
      },
      { materializeCustomer: false },
    );

    expect(accounts.resolve).not.toHaveBeenCalled();
    expect(output.accountId).toBeNull();
  });

  it("updates a repeated external feedback ID and preserves its account link", async () => {
    database.client.query.mockImplementation(
      (sql: string, values?: unknown[]) => {
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
          return Promise.resolve(result());
        }
        if (sql.includes("INSERT INTO webhook_deliveries")) {
          return Promise.resolve(result([{ id: "delivery_row" }], 1));
        }
        if (
          sql.includes("SELECT id,account_id FROM feedback_items") &&
          sql.includes("FOR UPDATE")
        ) {
          return Promise.resolve(
            result([{
              id: expectedFeedbackId(
                "org_alpha",
                "int_webhook",
                "event_42",
              ),
              account_id: "acct_existing",
            }], 1),
          );
        }
        if (sql.includes("UPDATE feedback_items SET")) {
          return Promise.resolve(
            result([{ account_id: values?.[10] ?? "acct_existing" }], 1),
          );
        }
        if (sql.includes("UPDATE integrations")) {
          return Promise.resolve(result([], 1));
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    );
    accounts.resolve.mockResolvedValue({
      accountId: "acct_existing",
      created: false,
    });

    const output = await ingestWebhookFeedback(
      "org_alpha",
      "int_webhook",
      "delivery_new_attempt",
      {
        id: "event_42",
        customerId: "customer_42",
        customer: "Acme Health renamed",
        sourceUpdatedAt: "2026-08-08T21:00:00.000Z",
        quote: "Updated feedback",
      },
    );

    expect(output).toEqual({
      feedbackId: expectedFeedbackId(
        "org_alpha",
        "int_webhook",
        "event_42",
      ),
      created: false,
      accountId: "acct_existing",
    });
    expect(
      database.client.query.mock.calls.some(
        ([sql]) =>
          typeof sql === "string" && sql.includes("UPDATE feedback_items SET"),
      ),
    ).toBe(true);
    expect(accounts.resolve).toHaveBeenCalledWith(
      database.client,
      expect.objectContaining({ revenueAuthority: undefined }),
    );
  });

  it("rejects account metadata without a stable customer identity", async () => {
    await expect(
      ingestWebhookFeedback(
        "org_alpha",
        "int_webhook",
        "delivery_invalid",
        {
          customer: "Acme Health",
          customerDomain: "acme.example",
          quote: "Exports are empty",
        },
      ),
    ).rejects.toThrow("customerId is required");

    expect(database.pool.connect).not.toHaveBeenCalled();
  });

  it("requires an authoritative source timestamp before materializing a customer", async () => {
    await expect(
      ingestWebhookFeedback(
        "org_alpha",
        "int_webhook",
        "delivery_missing_time",
        {
          customerId: "customer_42",
          customer: "Acme Health",
          quote: "Exports are empty",
        },
      ),
    ).rejects.toThrow("sourceUpdatedAt is required");

    expect(database.pool.connect).not.toHaveBeenCalled();
    expect(accounts.resolve).not.toHaveBeenCalled();
  });

  it("does not silently succeed when an external-identity conflict has no matching row", async () => {
    database.client.query.mockImplementation(
      (sql: string) => {
        if (sql === "BEGIN" || sql === "ROLLBACK") {
          return Promise.resolve(result());
        }
        if (sql.includes("INSERT INTO webhook_deliveries")) {
          return Promise.resolve(result([{ id: "delivery_row" }], 1));
        }
        if (
          sql.includes("SELECT id,account_id FROM feedback_items") &&
          sql.includes("FOR UPDATE")
        ) {
          return Promise.resolve(result());
        }
        if (
          sql.includes("SELECT id,account_id FROM feedback_items") &&
          sql.includes("LIMIT 1")
        ) {
          return Promise.resolve(result());
        }
        if (sql.includes("INSERT INTO feedback_items")) {
          return Promise.resolve(result([], 0));
        }
        if (sql.includes("UPDATE integrations")) {
          return Promise.resolve(result([], 1));
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    );
    await expect(
      ingestWebhookFeedback(
        "org_alpha",
        "int_webhook",
        "delivery_collision",
        { id: "event_collision", quote: "Collision test" },
      ),
    ).rejects.toThrow("external identity conflict could not be resolved");
  });

  it("rejects reuse of a delivery identifier with a different payload", async () => {
    database.client.query.mockImplementation(
      (sql: string) => {
        if (sql === "BEGIN" || sql === "ROLLBACK") {
          return Promise.resolve(result());
        }
        if (sql.includes("INSERT INTO webhook_deliveries")) {
          return Promise.resolve(result([], 0));
        }
        if (sql.includes("SELECT payload_hash FROM webhook_deliveries")) {
          return Promise.resolve(result([{ payload_hash: "different" }], 1));
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    );

    await expect(
      ingestWebhookFeedback(
        "org_alpha",
        "int_webhook",
        "delivery_reused",
        { id: "event_new", quote: "Different payload" },
      ),
    ).rejects.toThrow("delivery identifier was reused with a different payload");
  });
});
