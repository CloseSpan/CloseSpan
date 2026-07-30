import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "./request-security";

export const GITHUB_WEBHOOK_MAX_BYTES = 1_048_576;

export function githubWebhookSecret(explicit?: string): string {
  const secret = (explicit ?? process.env.GITHUB_WEBHOOK_SECRET)?.trim();
  if (!secret || Buffer.byteLength(secret, "utf8") < 32)
    throw new HttpError(503, "GitHub webhook is not configured");
  return secret;
}

export function verifyGithubWebhookSignature(
  rawBody: string,
  signature: string | null,
  explicitSecret?: string,
): boolean {
  const secret = githubWebhookSecret(explicitSecret);
  if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const supplied = Buffer.from(signature.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function requireGithubDeliveryId(value: string | null): string {
  const deliveryId = value?.trim().toLowerCase() ?? "";
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(deliveryId))
    throw new HttpError(400, "A valid GitHub delivery ID is required");
  return deliveryId;
}

export function requireGithubEvent(value: string | null): string {
  const event = value?.trim().toLowerCase() ?? "";
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(event))
    throw new HttpError(400, "A valid GitHub event is required");
  return event;
}
