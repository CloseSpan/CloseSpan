import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const repository = vi.hoisted(() => ({
  resolve: vi.fn(),
  loadSecret: vi.fn(),
  verify: vi.fn(),
  ingest: vi.fn(),
}));

vi.mock("@/lib/integration-repository", () => ({
  resolveWebhookIntegration: repository.resolve,
  loadWebhookSecret: repository.loadSecret,
  verifyWebhookSignature: repository.verify,
  ingestWebhookFeedback: repository.ingest,
}));

import { POST } from "./route";

function webhookRequest(
  endpointId: string,
  quoteOrPayload: string | Record<string, unknown> = "Export is empty",
  headers: Record<string, string> = {},
) {
  return {
    request: new NextRequest(`http://localhost/api/webhooks/${endpointId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-closespan-signature": "signed",
        "x-closespan-delivery-id": "delivery_1",
        ...headers,
      },
      body: JSON.stringify(
        typeof quoteOrPayload === "string"
          ? { quote: quoteOrPayload }
          : quoteOrPayload,
      ),
    }),
    context: { params: Promise.resolve({ integrationId: endpointId }) },
  };
}

describe("custom webhook endpoint isolation", () => {
  beforeEach(() => {
    repository.resolve.mockReset();
    repository.loadSecret.mockReset().mockResolvedValue("secret");
    repository.verify.mockReset().mockReturnValue(true);
    repository.ingest.mockReset().mockResolvedValue({
      feedbackId: "fb_1",
      created: true,
      accountId: null,
    });
  });

  it("routes an opaque endpoint to its exact organization", async () => {
    repository.resolve.mockResolvedValue({
      orgId: "org_beta",
      integrationId: "int_webhook",
    });
    const input = webhookRequest("whk_beta_opaque");

    const response = await POST(input.request, input.context);

    expect(response.status).toBe(201);
    expect(repository.resolve).toHaveBeenCalledWith("whk_beta_opaque");
    expect(repository.loadSecret).toHaveBeenCalledWith(
      "org_beta",
      "int_webhook",
    );
    expect(repository.ingest).toHaveBeenCalledWith(
      "org_beta",
      "int_webhook",
      "delivery_1",
      expect.objectContaining({ quote: "Export is empty" }),
    );
  });

  it("accepts legacy pre-CloseSpan webhook headers for existing integrations", async () => {
    repository.resolve.mockResolvedValue({
      orgId: "org_beta",
      integrationId: "int_webhook",
    });
    const input = webhookRequest("whk_beta_opaque", "Legacy delivery", {
      "x-closespan-signature": "",
      "x-closespan-delivery-id": "",
      "x-feelow-signature": "legacy-signed",
      "x-feelow-delivery-id": "legacy-delivery",
    });

    const response = await POST(input.request, input.context);

    expect(response.status).toBe(201);
    expect(repository.verify).toHaveBeenCalledWith(
      "secret",
      expect.any(String),
      "legacy-signed",
    );
    expect(repository.ingest).toHaveBeenCalledWith(
      "org_beta",
      "int_webhook",
      "legacy-delivery",
      expect.objectContaining({ quote: "Legacy delivery" }),
    );
  });

  it("uses a stable payload id when no delivery header is supplied", async () => {
    repository.resolve.mockResolvedValue({
      orgId: "org_beta",
      integrationId: "int_webhook",
    });
    const input = webhookRequest(
      "whk_beta_opaque",
      { id: "event_42", quote: "Payload-scoped delivery" },
      { "x-closespan-delivery-id": "" },
    );

    const response = await POST(input.request, input.context);

    expect(response.status).toBe(201);
    expect(repository.ingest).toHaveBeenCalledWith(
      "org_beta",
      "int_webhook",
      "event_42",
      expect.objectContaining({ id: "event_42" }),
    );
  });

  it("rejects a webhook without a stable delivery header or payload id", async () => {
    repository.resolve.mockResolvedValue({
      orgId: "org_beta",
      integrationId: "int_webhook",
    });
    const input = webhookRequest("whk_beta_opaque", "No stable identity", {
      "x-closespan-delivery-id": "",
    });

    const response = await POST(input.request, input.context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "A stable delivery header or webhook payload id is required",
    });
    expect(repository.ingest).not.toHaveBeenCalled();
  });

  it("does not treat a generic request id as a stable delivery identity", async () => {
    repository.resolve.mockResolvedValue({
      orgId: "org_beta",
      integrationId: "int_webhook",
    });
    const input = webhookRequest("whk_beta_opaque", "Proxy request identity", {
      "x-closespan-delivery-id": "",
      "x-request-id": "proxy-generated-request-42",
    });

    const response = await POST(input.request, input.context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "A stable delivery header or webhook payload id is required",
    });
    expect(repository.ingest).not.toHaveBeenCalled();
  });

  it("rejects an unsafe delivery header instead of silently falling back", async () => {
    repository.resolve.mockResolvedValue({
      orgId: "org_beta",
      integrationId: "int_webhook",
    });
    const input = webhookRequest(
      "whk_beta_opaque",
      { id: "event_42", quote: "Unsafe header" },
      { "x-closespan-delivery-id": "delivery id with spaces" },
    );

    const response = await POST(input.request, input.context);

    expect(response.status).toBe(400);
    expect(repository.ingest).not.toHaveBeenCalled();
  });

  it("does not accept organization scope from the webhook caller", async () => {
    repository.resolve.mockResolvedValue({
      orgId: "org_beta",
      integrationId: "int_webhook",
    });
    const input = webhookRequest(
      "whk_beta_opaque",
      "Billing exports are blank",
      { "x-org-id": "org_attacker" },
    );

    const response = await POST(input.request, input.context);

    expect(response.status).toBe(201);
    expect(repository.loadSecret).toHaveBeenCalledWith(
      "org_beta",
      "int_webhook",
    );
    expect(repository.ingest).toHaveBeenCalledWith(
      "org_beta",
      "int_webhook",
      "delivery_1",
      expect.objectContaining({ quote: "Billing exports are blank" }),
    );
    expect(repository.loadSecret).not.toHaveBeenCalledWith(
      "org_attacker",
      expect.anything(),
    );
  });

  it("passes a stable customer identity and account metadata to ingestion", async () => {
    repository.resolve.mockResolvedValue({
      orgId: "org_beta",
      integrationId: "int_webhook",
    });
    const input = webhookRequest("whk_beta_opaque", {
      id: "event_42",
      customerId: "customer_42",
      customer: "Acme Health",
      customerDomain: "acme.example",
      customerSince: 2022,
      churnRisk: "Elevated",
      sourceUpdatedAt: "2026-08-08T20:00:00.000Z",
      accountTier: "Enterprise",
      arr: 210_000,
      quote: "Exports are empty",
    });

    const response = await POST(input.request, input.context);

    expect(response.status).toBe(201);
    expect(repository.ingest).toHaveBeenCalledWith(
      "org_beta",
      "int_webhook",
      "delivery_1",
      expect.objectContaining({
        customerId: "customer_42",
        customer: "Acme Health",
        customerDomain: "acme.example",
        customerSince: 2022,
        churnRisk: "Elevated",
        accountTier: "Enterprise",
        arr: 210_000,
      }),
    );
  });

  it("rejects a customer identifier without the required account name", async () => {
    repository.resolve.mockResolvedValue({
      orgId: "org_beta",
      integrationId: "int_webhook",
    });
    const input = webhookRequest("whk_beta_opaque", {
      customerId: "customer_42",
      quote: "Exports are empty",
    });

    const response = await POST(input.request, input.context);

    expect(response.status).toBe(400);
    expect(repository.ingest).not.toHaveBeenCalled();
  });

  it("rejects customer materialization without a source update timestamp", async () => {
    repository.resolve.mockResolvedValue({
      orgId: "org_beta",
      integrationId: "int_webhook",
    });
    const input = webhookRequest("whk_beta_opaque", {
      customerId: "customer_42",
      customer: "Acme Health",
      quote: "Exports are empty",
    });

    const response = await POST(input.request, input.context);

    expect(response.status).toBe(400);
    expect(repository.ingest).not.toHaveBeenCalled();
  });

  it("rejects account metadata without a stable customer identifier", async () => {
    repository.resolve.mockResolvedValue({
      orgId: "org_beta",
      integrationId: "int_webhook",
    });
    const input = webhookRequest("whk_beta_opaque", {
      customer: "Acme Health",
      customerDomain: "acme.example",
      quote: "Exports are empty",
    });

    const response = await POST(input.request, input.context);

    expect(response.status).toBe(400);
    expect(repository.ingest).not.toHaveBeenCalled();
  });

  it("rejects an invalid customer source timestamp", async () => {
    repository.resolve.mockResolvedValue({
      orgId: "org_beta",
      integrationId: "int_webhook",
    });
    const input = webhookRequest("whk_beta_opaque", {
      customerId: "customer_42",
      customer: "Acme Health",
      sourceUpdatedAt: "not-a-date",
      quote: "Exports are empty",
    });

    const response = await POST(input.request, input.context);

    expect(response.status).toBe(400);
    expect(repository.ingest).not.toHaveBeenCalled();
  });

  it("does not fall back to a shared connector id", async () => {
    repository.resolve.mockResolvedValue(null);
    const input = webhookRequest("int_webhook");

    const response = await POST(input.request, input.context);

    expect(response.status).toBe(404);
    expect(repository.loadSecret).not.toHaveBeenCalled();
    expect(repository.verify).not.toHaveBeenCalled();
    expect(repository.ingest).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature before ingesting into the resolved tenant", async () => {
    repository.resolve.mockResolvedValue({
      orgId: "org_beta",
      integrationId: "int_webhook",
    });
    repository.verify.mockReturnValue(false);
    const input = webhookRequest("whk_beta_opaque");

    const response = await POST(input.request, input.context);

    expect(response.status).toBe(401);
    expect(repository.loadSecret).toHaveBeenCalledWith(
      "org_beta",
      "int_webhook",
    );
    expect(repository.ingest).not.toHaveBeenCalled();
  });
});
