import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const repository = vi.hoisted(() => ({
  loadSecret: vi.fn(),
  loadPublicId: vi.fn(),
  ingest: vi.fn(),
}));

vi.mock("@/lib/integration-repository", () => ({
  buildWebhookUrl: (publicId: string) =>
    `https://closespan.example/api/webhooks/${publicId}`,
  loadWebhookSecret: repository.loadSecret,
  loadWebhookPublicId: repository.loadPublicId,
  ingestWebhookFeedback: repository.ingest,
}));

import { POST } from "./route";

function request(orgId = "org_alpha") {
  return new NextRequest("http://localhost/api/integrations/webhook/test", {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "idempotency-key": `webhook_${crypto.randomUUID()}`,
      "x-request-id": crypto.randomUUID(),
      "x-test-user-id": "user_alpha",
      "x-test-user-org-id": orgId,
      "x-test-user-name": "Sam Operator",
      "x-test-user-email": "sam@example.com",
      "x-test-organization-name": "Alpha",
      "x-test-user-role": "Admin",
    },
  });
}

describe("webhook setup test route", () => {
  beforeEach(() => {
    repository.loadSecret.mockReset().mockResolvedValue("decrypted-secret");
    repository.loadPublicId.mockReset().mockResolvedValue("whk_alpha_opaque");
    repository.ingest.mockReset().mockResolvedValue({
      feedbackId: "fb_test",
      created: true,
    });
  });

  it("returns the tenant's persisted opaque webhook URL", async () => {
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(repository.loadSecret).toHaveBeenCalledWith(
      "org_alpha",
      "int_webhook",
    );
    expect(repository.loadPublicId).toHaveBeenCalledWith(
      "org_alpha",
      "int_webhook",
    );
    expect(body.webhookUrl).toBe(
      "https://closespan.example/api/webhooks/whk_alpha_opaque",
    );
    expect(body.webhookUrl).not.toContain("/int_webhook");
  });

  it("omits the URL when no persisted public endpoint is available", async () => {
    repository.loadPublicId.mockResolvedValue(null);

    const response = await POST(request("org_beta"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(repository.loadPublicId).toHaveBeenCalledWith(
      "org_beta",
      "int_webhook",
    );
    expect(body).not.toHaveProperty("webhookUrl");
    expect(JSON.stringify(body)).not.toContain("int_webhook");
  });
});
