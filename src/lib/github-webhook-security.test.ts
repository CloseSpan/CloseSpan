import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  requireGithubDeliveryId,
  requireGithubEvent,
  verifyGithubWebhookSignature,
} from "./github-webhook-security";

const secret = "github-webhook-test-secret-with-at-least-32-characters";

describe("GitHub webhook security", () => {
  it("validates the exact raw body with HMAC SHA-256", () => {
    const body = '{"zen":"Keep it logically awesome."}';
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(verifyGithubWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyGithubWebhookSignature(`${body}\n`, signature, secret)).toBe(false);
    expect(verifyGithubWebhookSignature(body, "sha256=not-a-digest", secret)).toBe(false);
  });

  it("requires canonical delivery and event headers", () => {
    expect(requireGithubDeliveryId("11111111-1111-4111-8111-111111111111"))
      .toBe("11111111-1111-4111-8111-111111111111");
    expect(requireGithubEvent("pull_request")).toBe("pull_request");
    expect(() => requireGithubDeliveryId("delivery-1")).toThrow("valid GitHub delivery ID");
    expect(() => requireGithubEvent("pull request")).toThrow("valid GitHub event");
  });
});
