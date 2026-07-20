import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import {
  createNangoConnectionAttempt,
  getNangoConnectionStatuses,
  NANGO_TAGS,
  type NangoConnectionAttempt,
  resetNangoMemoryState,
} from "@/lib/nango-repository";
import { getNangoSyncStatus } from "@/lib/nango-sync-repository";

const signingKey = "nango-webhook-signing-key-for-tests";

function signature(rawBody: string): string {
  return createHmac("sha256", signingKey).update(rawBody).digest("hex");
}

function webhookRequest(
  rawBody: string,
  suppliedSignature = signature(rawBody),
): NextRequest {
  return new NextRequest("http://localhost/api/integrations/nango/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-nango-hmac-sha256": suppliedSignature,
    },
    body: rawBody,
  });
}

async function pendingAttempt(): Promise<NangoConnectionAttempt> {
  return createNangoConnectionAttempt({
    orgId: "org_alpha",
    integrationId: "int_github",
    providerConfigKey: "github-getting-started",
    nangoEnvironment: "DEV",
    actorId: "admin_ada",
    actorName: "Ada Admin",
    actorEmail: "ada@example.com",
    idempotencyKey: `nango_${crypto.randomUUID()}`,
    traceId: `trace_${crypto.randomUUID()}`,
    expiresAt: new Date(Date.now() + 60_000),
  });
}

function exactTags(attempt: NangoConnectionAttempt): Record<string, string> {
  return {
    [NANGO_TAGS.attemptId]: attempt.id,
    [NANGO_TAGS.integrationId]: attempt.integrationId,
    [NANGO_TAGS.organizationId]: attempt.orgId,
    [NANGO_TAGS.endUserId]: `${attempt.orgId}:${attempt.actorId}`,
    [NANGO_TAGS.endUserEmail]: attempt.actorEmail,
    [NANGO_TAGS.endUserDisplayName]: attempt.actorName,
  };
}

function authEvent(attempt: NangoConnectionAttempt) {
  return {
    from: "nango",
    type: "auth",
    operation: "creation",
    success: true,
    connectionId: "github_connection_alpha",
    providerConfigKey: attempt.providerConfigKey,
    provider: "github",
    environment: attempt.nangoEnvironment,
    tags: exactTags(attempt),
  };
}

describe("Nango webhook signature and raw-body boundary", () => {
  beforeEach(() => {
    process.env.PERSISTENCE_MODE = "memory";
    process.env.APP_MODE = "demo";
    process.env.NANGO_API_KEY = "nango-api-key-not-used-by-verification";
    process.env.NANGO_WEBHOOK_SIGNING_KEY = signingKey;
    resetNangoMemoryState();
  });

  afterEach(() => {
    resetNangoMemoryState();
    delete process.env.PERSISTENCE_MODE;
    delete process.env.APP_MODE;
    delete process.env.NANGO_API_KEY;
    delete process.env.NANGO_WEBHOOK_SIGNING_KEY;
  });

  it("accepts a signature over the exact raw body, including whitespace", async () => {
    const attempt = await pendingAttempt();
    const rawBody = JSON.stringify(authEvent(attempt), null, 2);

    const response = await POST(webhookRequest(rawBody));

    expect(response.status).toBe(204);
    expect(await getNangoConnectionStatuses(attempt.orgId)).toEqual([
      expect.objectContaining({
        integrationId: "int_github",
        state: "Connected",
      }),
    ]);
  });

  it("rejects any body change made after signing before reconciliation", async () => {
    const attempt = await pendingAttempt();
    const signedBody = JSON.stringify(authEvent(attempt));
    const changedBody = `${signedBody}\n`;

    const response = await POST(
      webhookRequest(changedBody, signature(signedBody)),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Invalid webhook signature",
    });
    expect(await getNangoConnectionStatuses(attempt.orgId)).toEqual([]);
  });

  it("verifies the signature before attempting to parse JSON", async () => {
    const invalidJson = "{ definitely-not-json";
    const unverified = await POST(
      webhookRequest(invalidJson, "0".repeat(64)),
    );
    expect(unverified.status).toBe(401);
    expect(await unverified.json()).toEqual({
      error: "Invalid webhook signature",
    });

    const verified = await POST(webhookRequest(invalidJson));
    expect(verified.status).toBe(400);
    expect(await verified.json()).toEqual({
      error: "Invalid webhook payload",
    });
  });

  it("does not reveal whether a signed but tenant-mismatched event found an attempt", async () => {
    const attempt = await pendingAttempt();
    const payload = authEvent(attempt);
    payload.tags[NANGO_TAGS.organizationId] = "org_other";
    payload.tags[NANGO_TAGS.endUserId] = `org_other:${attempt.actorId}`;

    const response = await POST(webhookRequest(JSON.stringify(payload)));

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(await getNangoConnectionStatuses(attempt.orgId)).toEqual([]);
    expect(await getNangoConnectionStatuses("org_other")).toEqual([]);
  });

  it("fails closed when the independent webhook signing key is absent", async () => {
    delete process.env.NANGO_WEBHOOK_SIGNING_KEY;
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error:
        "The connector event could not be processed. Please try again later.",
    });
  });

  it("durably enqueues record ingestion without pulling records in the webhook", async () => {
    const attempt = await pendingAttempt();
    const auth = authEvent(attempt);
    expect(
      (await POST(webhookRequest(JSON.stringify(auth)))).status,
    ).toBe(204);

    const sync = {
      from: "nango",
      type: "sync",
      success: true,
      connectionId: auth.connectionId,
      providerConfigKey: auth.providerConfigKey,
      syncName: "github-feedback",
      syncVariant: "",
      model: "GithubFeedback",
      modifiedAfter: "2026-07-20T10:00:00.000Z",
      responseResults: { added: 1, updated: 0, deleted: 0 },
    };
    const rawBody = JSON.stringify(sync);
    const first = await POST(webhookRequest(rawBody));
    const replay = await POST(webhookRequest(rawBody));

    expect(first.status).toBe(204);
    expect(replay.status).toBe(204);
    expect(await getNangoSyncStatus(attempt.orgId, attempt.integrationId)).toEqual(
      expect.objectContaining({
        integrationId: "int_github",
        syncName: "github-feedback",
        model: "GithubFeedback",
        status: "Queued",
        recordsProcessed: 0,
      }),
    );
  });
});
