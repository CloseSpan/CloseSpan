import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({ process: vi.fn() }));
vi.mock("@/lib/github-webhook-repository", () => ({
  processGithubWebhook: repository.process,
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

const secret = "github-webhook-route-secret-with-at-least-32-characters";
const deliveryId = "11111111-1111-4111-8111-111111111111";

function request(body: string, overrides: Record<string, string> = {}) {
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  return new NextRequest("https://www.closespan.com/api/integrations/github/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-delivery": deliveryId,
      "x-github-event": "ping",
      "x-hub-signature-256": signature,
      ...overrides,
    },
    body,
  });
}

describe("GitHub App webhook route", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", secret);
    repository.process.mockReset().mockResolvedValue({
      accepted: true,
      duplicate: false,
      outcome: "ping_acknowledged",
    });
  });

  it("accepts a signed GitHub delivery and preserves its raw body", async () => {
    const body = '{"zen":"Keep it logically awesome."}';
    const response = await POST(request(body));
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(repository.process).toHaveBeenCalledWith({
      deliveryId,
      event: "ping",
      rawBody: body,
      payload: { zen: "Keep it logically awesome." },
    });
  });

  it("rejects an invalid signature before processing", async () => {
    const response = await POST(request("{}", { "x-hub-signature-256": `sha256=${"0".repeat(64)}` }));
    expect(response.status).toBe(401);
    expect(repository.process).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON after authenticating the delivery", async () => {
    const response = await POST(request("{"));
    expect(response.status).toBe(400);
    expect(repository.process).not.toHaveBeenCalled();
  });

  it("fails closed when the webhook secret is unavailable", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "");
    const response = await POST(request("{}"));
    expect(response.status).toBe(503);
    expect(repository.process).not.toHaveBeenCalled();
  });
});
