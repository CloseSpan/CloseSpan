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
  quote = "Export is empty",
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
      body: JSON.stringify({ quote }),
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

  it("accepts legacy pre-Closespan webhook headers for existing integrations", async () => {
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
