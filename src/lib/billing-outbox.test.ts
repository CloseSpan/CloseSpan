import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingProvider } from "./billing-provider";
import { BillingProviderError } from "./billing-provider";

const database = vi.hoisted(() => ({
  client: { query: vi.fn() },
  pool: { query: vi.fn() },
}));

vi.mock("./db", () => ({
  databasePool: () => database.pool,
  transaction: async <T>(work: (client: typeof database.client) => Promise<T>) =>
    work(database.client),
}));

vi.mock("./workspace-persistence", () => ({
  workspacePersistenceMode: () => "postgres",
}));

import {
  BILLING_EVENT_NAMES,
  deliverBillingShadow,
  enqueueBillingUsageEvent,
  getBillingShadowStatus,
  requeueFailedBillingShadow,
} from "./billing-outbox";

function mockProvider(overrides: Partial<BillingProvider> = {}): BillingProvider {
  return {
    name: "flexprice",
    provisionCustomer: vi.fn(async () => ({ providerId: "customer-flex-1" })),
    publishUsage: vi.fn(async () => ({ providerId: "event-flex-1" })),
    ...overrides,
  };
}

describe("billing shadow outbox", () => {
  beforeEach(() => {
    database.client.query.mockReset();
    database.pool.query.mockReset().mockResolvedValue({ rows: [], rowCount: 1 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("records a stable event with provider-level deduplication", async () => {
    database.client.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const created = await enqueueBillingUsageEvent(database.client as never, {
      orgId: "org-1",
      eventId: "ai.tokens:org-1:run-1",
      eventName: BILLING_EVENT_NAMES.aiTokens,
      source: "closespan.ai",
      properties: { total_tokens: 42 },
      occurredAt: "2026-08-04T10:00:00.000Z",
    });
    expect(created).toBe(true);
    const [sql, values] = database.client.query.mock.calls[0] ?? [];
    expect(String(sql).replace(/\s+/g, " ")).toContain(
      "ON CONFLICT(provider,event_id) DO NOTHING",
    );
    expect(values).toEqual([
      "org-1",
      "ai.tokens:org-1:run-1",
      "ai.tokens",
      "closespan.ai",
      JSON.stringify({ total_tokens: 42 }),
      "2026-08-04T10:00:00.000Z",
    ]);
    expect(String(sql)).toContain("customer.metering_enabled=true");
  });

  it("skips excluded workspaces and tolerates deploy-before-migrate", async () => {
    database.client.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(
      enqueueBillingUsageEvent(database.client as never, {
        orgId: "org_demo",
        eventId: "feedback.processed:org_demo:fb-1",
        eventName: BILLING_EVENT_NAMES.feedbackProcessed,
        source: "test",
        properties: { quantity: 1 },
      }),
    ).resolves.toBe(false);

    database.client.query.mockRejectedValueOnce(
      Object.assign(new Error("relation does not exist"), { code: "42P01" }),
    );
    await expect(
      enqueueBillingUsageEvent(database.client as never, {
        orgId: "org-legacy",
        eventId: "ai.tokens:org-legacy:run-1",
        eventName: BILLING_EVENT_NAMES.aiTokens,
        source: "test",
        properties: { total_tokens: 1 },
      }),
    ).resolves.toBe(false);
  });

  it("does not claim or transmit records while provider delivery is disabled", async () => {
    const result = await deliverBillingShadow({ provider: null });
    expect(result).toMatchObject({ configured: false, eventsAccepted: 0 });
    expect(database.client.query).not.toHaveBeenCalled();
    expect(database.pool.query).not.toHaveBeenCalled();
  });

  it("provisions the customer before delivering its usage event", async () => {
    database.client.query
      .mockResolvedValueOnce({
        rows: [
          {
            org_id: "org-1",
            external_customer_id: "org-1",
            provider_customer_id: null,
            attempts: 1,
            organization_name: "Acme",
            billing_email: "owner@example.com",
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "outbox-1",
            org_id: "org-1",
            external_customer_id: "org-1",
            event_id: "feedback.processed:org-1:fb-1",
            event_name: "feedback.processed",
            source: "closespan.feedback",
            properties: { quantity: 1 },
            occurred_at: new Date("2026-08-04T10:00:00.000Z"),
            attempts: 1,
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const provider = mockProvider();

    const result = await deliverBillingShadow({
      provider,
      customerLimit: 2,
      eventLimit: 2,
    });

    expect(result).toMatchObject({
      configured: true,
      customersProvisioned: 1,
      eventsAccepted: 1,
      failed: 0,
    });
    expect(provider.provisionCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ externalCustomerId: "org-1", name: "Acme" }),
    );
    expect(provider.publishUsage).toHaveBeenCalledWith({
      eventId: "feedback.processed:org-1:fb-1",
      eventName: "feedback.processed",
      externalCustomerId: "org-1",
      source: "closespan.feedback",
      properties: { quantity: 1 },
      occurredAt: "2026-08-04T10:00:00.000Z",
    });
    expect(
      database.client.query.mock.calls.some(([sql]) =>
        String(sql).includes("FOR UPDATE OF outbox SKIP LOCKED"),
      ),
    ).toBe(true);
    expect(
      database.pool.query.mock.calls.some(([sql, values]) =>
        String(sql).includes("status='Provisioning' AND attempts=$3") &&
        Array.isArray(values) &&
        values[2] === 1,
      ),
    ).toBe(true);
  });

  it("retries transient provider failures without changing the event identity", async () => {
    database.client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "outbox-1",
            org_id: "org-1",
            external_customer_id: "org-1",
            event_id: "feedback.processed:org-1:fb-1",
            event_name: "feedback.processed",
            source: "closespan.feedback",
            properties: { quantity: 1 },
            occurred_at: new Date("2026-08-04T10:00:00.000Z"),
            attempts: 2,
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const publishUsage = vi.fn(async () => {
      throw new BillingProviderError("rate limited", {
        retryable: true,
        status: 429,
        retryAfterMs: 300_000,
      });
    });

    const result = await deliverBillingShadow({
      provider: mockProvider({ publishUsage }),
      customerLimit: 1,
      eventLimit: 2,
    });

    expect(result).toMatchObject({ retried: 1, eventsAccepted: 0, failed: 0 });
    expect(publishUsage).toHaveBeenCalledOnce();
    const statusUpdate = database.pool.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE billing_event_outbox"),
    );
    expect(statusUpdate?.[1]).toEqual([
      "outbox-1",
      "Pending",
      "rate limited",
      300,
      2,
    ]);
  });

  it("stops a batch after a provider-wide authentication failure", async () => {
    database.client.query.mockResolvedValueOnce({
      rows: [
        {
          org_id: "org-1",
          external_customer_id: "org-1",
          provider_customer_id: null,
          attempts: 1,
          organization_name: "Acme",
        },
      ],
      rowCount: 1,
    });
    const provisionCustomer = vi.fn(async () => {
      throw new BillingProviderError("Flexprice returned HTTP 401", {
        retryable: false,
        status: 401,
      });
    });

    const result = await deliverBillingShadow({
      provider: mockProvider({ provisionCustomer }),
      customerLimit: 5,
      eventLimit: 5,
    });

    expect(result).toMatchObject({ failed: 1, eventsAccepted: 0 });
    expect(provisionCustomer).toHaveBeenCalledOnce();
    expect(database.client.query).toHaveBeenCalledOnce();
  });

  it("surfaces customer failure state and supports an explicit admin requeue", async () => {
    vi.stubEnv("FLEXPRICE_SHADOW_ENABLED", "true");
    vi.stubEnv("FLEXPRICE_API_KEY", "test-key");
    database.pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            status: "Failed",
            metering_enabled: true,
            last_error: "Flexprice returned HTTP 401",
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ pending: 2, sent: 4, failed: 1, last_sent_at: null }],
        rowCount: 1,
      });

    await expect(getBillingShadowStatus("org-1")).resolves.toMatchObject({
      configured: true,
      customerStatus: "Failed",
      customerLastError: "Flexprice returned HTTP 401",
      pendingEvents: 2,
      failedEvents: 1,
    });

    database.client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 3 });
    await expect(requeueFailedBillingShadow("org-1")).resolves.toEqual({
      customersRequeued: 1,
      eventsRequeued: 3,
    });
  });

  it("reports excluded workspaces and pending rollout without failing Settings", async () => {
    database.pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            status: "Pending",
            metering_enabled: false,
            last_error: null,
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ pending: 0, sent: 0, failed: 0, last_sent_at: null }],
        rowCount: 1,
      });
    await expect(getBillingShadowStatus("org_demo")).resolves.toMatchObject({
      mode: "Excluded",
      meteringEnabled: false,
      customerStatus: "Not applicable",
    });

    database.pool.query.mockReset().mockRejectedValueOnce(
      Object.assign(new Error("relation does not exist"), { code: "42P01" }),
    );
    await expect(getBillingShadowStatus("org-legacy")).resolves.toMatchObject({
      configured: false,
      configurationIssue: "Billing migration 032 is pending",
    });
  });
});
