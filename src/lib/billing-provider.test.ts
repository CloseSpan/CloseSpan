import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BillingProviderError,
  FlexpriceBillingProvider,
  createFlexpriceBillingProvider,
  flexpriceShadowConfiguration,
} from "./billing-provider";

function provider(fetcher: typeof fetch): FlexpriceBillingProvider {
  return new FlexpriceBillingProvider(
    {
      apiKey: "flexprice-test-secret",
      baseUrl: "https://us.api.flexprice.io/v1",
      timeoutMs: 2_000,
    },
    fetcher,
  );
}

describe("Flexprice billing provider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stays disabled until shadow delivery is explicitly enabled", () => {
    vi.stubEnv("FLEXPRICE_SHADOW_ENABLED", "false");
    vi.stubEnv("FLEXPRICE_API_KEY", "flexprice-test-secret");

    expect(flexpriceShadowConfiguration()).toMatchObject({
      enabled: false,
      configured: false,
    });
    expect(createFlexpriceBillingProvider()).toBeNull();
  });

  it("creates a missing customer with the organization as external ID", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        Response.json({ id: "customer-flex-1" }, { status: 201 }),
      );

    await expect(
      provider(fetcher).provisionCustomer({
        externalCustomerId: "org-1",
        name: "Acme",
        email: "owner@example.com",
        metadata: { closespan_org_id: "org-1", seats: 4 },
      }),
    ).resolves.toEqual({ providerId: "customer-flex-1" });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://us.api.flexprice.io/v1/customers/external/org-1",
      expect.objectContaining({ method: "GET" }),
    );
    const create = fetcher.mock.calls[1];
    expect(create?.[0]).toBe("https://us.api.flexprice.io/v1/customers");
    expect(JSON.parse(String(create?.[1]?.body))).toEqual({
      external_id: "org-1",
      name: "Acme",
      email: "owner@example.com",
      skip_onboarding_workflow: true,
      metadata: { closespan_org_id: "org-1", seats: "4" },
    });
  });

  it("updates an existing customer and converges after a create race", async () => {
    const existingFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { id: "customer-flex-1", metadata: { operator_field: "keep" } },
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({ id: "customer-flex-1" }, { status: 200 }),
      );
    await provider(existingFetcher).provisionCustomer({
      externalCustomerId: "org-1",
      name: "Renamed Acme",
    });
    expect(existingFetcher.mock.calls[1]?.[0]).toBe(
      "https://us.api.flexprice.io/v1/customers?external_customer_id=org-1",
    );
    expect(existingFetcher.mock.calls[1]?.[1]?.method).toBe("PUT");
    expect(JSON.parse(String(existingFetcher.mock.calls[1]?.[1]?.body))).toEqual({
      external_id: "org-1",
      name: "Renamed Acme",
    });

    const racedFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(
        Response.json({ id: "customer-flex-1" }, { status: 200 }),
      )
      .mockResolvedValueOnce(
        Response.json({ id: "customer-flex-1" }, { status: 200 }),
      );
    await expect(
      provider(racedFetcher).provisionCustomer({
        externalCustomerId: "org-1",
        name: "Acme",
      }),
    ).resolves.toEqual({ providerId: "customer-flex-1" });
    expect(racedFetcher).toHaveBeenCalledTimes(4);
  });

  it("merges CloseSpan metadata without erasing existing provider fields", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { id: "customer-flex-1", metadata: { operator_field: "keep" } },
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({ id: "customer-flex-1" }, { status: 200 }),
      );

    await provider(fetcher).provisionCustomer({
      externalCustomerId: "org-1",
      name: "Acme",
      metadata: { closespan_org_id: "org-1", mode: "shadow" },
    });

    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({
      metadata: {
        operator_field: "keep",
        closespan_org_id: "org-1",
        mode: "shadow",
      },
    });
  });

  it("retries documented duplicate-customer races but fails genuine validation", async () => {
    const convergedFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        Response.json({ code: "already_exists" }, { status: 400 }),
      )
      .mockResolvedValueOnce(
        Response.json({ id: "customer-flex-1" }, { status: 200 }),
      )
      .mockResolvedValueOnce(
        Response.json({ id: "customer-flex-1" }, { status: 200 }),
      );
    await expect(
      provider(convergedFetcher).provisionCustomer({
        externalCustomerId: "org-1",
        name: "Acme",
      }),
    ).resolves.toEqual({ providerId: "customer-flex-1" });

    const laggedFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        Response.json({ error: { code: "already_exists" } }, { status: 400 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(
      provider(laggedFetcher).provisionCustomer({
        externalCustomerId: "org-1",
        name: "Acme",
      }),
    ).rejects.toMatchObject({
      retryable: true,
      code: "already_exists",
    } satisfies Partial<BillingProviderError>);

    const invalidFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        Response.json({ code: "invalid_request" }, { status: 400 }),
      );
    await expect(
      provider(invalidFetcher).provisionCustomer({
        externalCustomerId: "org-1",
        name: "Acme",
      }),
    ).rejects.toMatchObject({
      retryable: false,
      code: "invalid_request",
    } satisfies Partial<BillingProviderError>);
    expect(invalidFetcher).toHaveBeenCalledTimes(2);
  });

  it("publishes a stable usage event without exposing the API key", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({ event_id: "provider-event-1" }, { status: 202 }),
    );
    const result = await provider(fetcher).publishUsage({
      eventId: "feedback.processed:org-1:fb-1",
      eventName: "feedback.processed",
      externalCustomerId: "org-1",
      source: "closespan.feedback",
      properties: { quantity: 1 },
      occurredAt: "2026-08-04T10:00:00.000Z",
    });
    expect(result).toEqual({ providerId: "provider-event-1" });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      event_id: "feedback.processed:org-1:fb-1",
      event_name: "feedback.processed",
      external_customer_id: "org-1",
      source: "closespan.feedback",
      properties: { quantity: 1 },
      timestamp: "2026-08-04T10:00:00.000Z",
    });
  });

  it("requires Flexprice's 202 event acknowledgement and a nonblank event ID", async () => {
    for (const status of [200, 204]) {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(status === 200 ? "login" : null, { status }));
      await expect(
        provider(fetcher).publishUsage({
          eventId: `event-${status}`,
          eventName: "feedback.processed",
          externalCustomerId: "org-1",
          source: "test",
          properties: {},
          occurredAt: new Date().toISOString(),
        }),
      ).rejects.toMatchObject({
        retryable: true,
        status,
      } satisfies Partial<BillingProviderError>);
    }

    const fetcher = vi.fn<typeof fetch>();
    await expect(
      provider(fetcher).publishUsage({
        eventId: "   ",
        eventName: "feedback.processed",
        externalCustomerId: "org-1",
        source: "test",
        properties: {},
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("classifies transient and permanent failures", async () => {
    const network = provider(
      vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("offline")),
    );
    await expect(
      network.publishUsage({
        eventId: "event-1",
        eventName: "feedback.processed",
        externalCustomerId: "org-1",
        source: "test",
        properties: {},
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ retryable: true } satisfies Partial<BillingProviderError>);

    for (const [status, retryable] of [
      [429, true],
      [503, true],
      [400, false],
    ] as const) {
      const failing = provider(
        vi.fn<typeof fetch>().mockResolvedValueOnce(
          new Response("secret response body", { status }),
        ),
      );
      const error = await failing
        .publishUsage({
          eventId: `event-${status}`,
          eventName: "feedback.processed",
          externalCustomerId: "org-1",
          source: "test",
          properties: {},
          occurredAt: new Date().toISOString(),
        })
        .catch((value: unknown) => value);
      expect(error).toMatchObject({ retryable, status });
      expect(String(error)).not.toContain("flexprice-test-secret");
      expect(String(error)).not.toContain("secret response body");
    }

    const rateLimited = provider(
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: { "Retry-After": "120" },
        }),
      ),
    );
    await expect(
      rateLimited.publishUsage({
        eventId: "event-rate-limit",
        eventName: "feedback.processed",
        externalCustomerId: "org-1",
        source: "test",
        properties: {},
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({
      retryable: true,
      status: 429,
      retryAfterMs: 120_000,
    } satisfies Partial<BillingProviderError>);
  });
});
