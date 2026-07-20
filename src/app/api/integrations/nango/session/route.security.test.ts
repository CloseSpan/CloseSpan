import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const nangoSdk = vi.hoisted(() => ({
  createConnectSession: vi.fn(),
}));

vi.mock("@/lib/nango", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nango")>();
  return {
    ...actual,
    getNangoClient: () => ({
      createConnectSession: nangoSdk.createConnectSession,
    }),
  };
});

import { POST } from "./route";
import { NANGO_TAGS, resetNangoMemoryState } from "@/lib/nango-repository";

function sessionRequest(
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest("http://localhost/api/integrations/nango/session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `nango_${crypto.randomUUID()}`,
      "x-org-id": "org_northstar",
      "x-request-id": crypto.randomUUID(),
      "x-test-user-id": "admin_ada",
      "x-test-user-org-id": "org_northstar",
      "x-test-user-name": "Ada Admin",
      "x-test-user-email": "ada@example.com",
      "x-test-organization-name": "Northstar Labs",
      "x-test-user-role": "Admin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("Nango Connect session API security", () => {
  beforeEach(() => {
    process.env.PERSISTENCE_MODE = "memory";
    process.env.APP_MODE = "demo";
    process.env.NANGO_WEBHOOK_SIGNING_KEY = "test-webhook-signing-key";
    resetNangoMemoryState();
    nangoSdk.createConnectSession.mockReset();
    nangoSdk.createConnectSession.mockResolvedValue({
      data: {
        token: "connect-session-token",
        expires_at: "2026-07-19T12:30:00.000Z",
      },
    });
  });

  afterEach(() => {
    resetNangoMemoryState();
    delete process.env.PERSISTENCE_MODE;
    delete process.env.APP_MODE;
    delete process.env.NANGO_WEBHOOK_SIGNING_KEY;
  });

  it("derives the allowlist, tenant, end user, and exact tags on the server", async () => {
    const response = await POST(sessionRequest({ integrationId: "int_github" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      token: "connect-session-token",
      expiresAt: "2026-07-19T12:30:00.000Z",
      apiUrl: "https://api.nango.dev",
    });

    expect(nangoSdk.createConnectSession).toHaveBeenCalledTimes(1);
    const session = nangoSdk.createConnectSession.mock.calls[0]?.[0];
    expect(session).toMatchObject({
      allowed_integrations: ["github-getting-started"],
      end_user: {
        id: "org_northstar:admin_ada",
        email: "ada@example.com",
        display_name: "Ada Admin",
      },
      organization: {
        id: "org_northstar",
        display_name: "Northstar Labs",
      },
    });
    expect(Object.keys(session.tags).sort()).toEqual(
      Object.values(NANGO_TAGS).sort(),
    );
    expect(session.tags).toEqual({
      [NANGO_TAGS.attemptId]: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f-]{27}$/,
      ),
      [NANGO_TAGS.integrationId]: "int_github",
      [NANGO_TAGS.organizationId]: "org_northstar",
      [NANGO_TAGS.endUserId]: "org_northstar:admin_ada",
      [NANGO_TAGS.endUserEmail]: "ada@example.com",
      [NANGO_TAGS.endUserDisplayName]: "Ada Admin",
    });
  });

  it("rejects client-supplied provider keys, tags, or connection IDs", async () => {
    const response = await POST(
      sessionRequest({
        integrationId: "int_github",
        providerConfigKey: "attacker-provider",
        connectionId: "victim-connection",
        tags: { organization_id: "org_victim" },
      }),
    );

    expect(response.status).toBe(400);
    expect(nangoSdk.createConnectSession).not.toHaveBeenCalled();
  });

  it("reuses the pending attempt for an exact idempotent retry", async () => {
    const headers = { "idempotency-key": "nango_exact_retry_001" };
    const first = await POST(
      sessionRequest({ integrationId: "int_slack" }, headers),
    );
    const second = await POST(
      sessionRequest({ integrationId: "int_slack" }, headers),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(nangoSdk.createConnectSession).toHaveBeenCalledTimes(2);
    expect(
      nangoSdk.createConnectSession.mock.calls[0]?.[0].tags[
        NANGO_TAGS.attemptId
      ],
    ).toBe(
      nangoSdk.createConnectSession.mock.calls[1]?.[0].tags[
        NANGO_TAGS.attemptId
      ],
    );
  });

  it("uses the persisted identity tags when an idempotent retry has updated profile fields", async () => {
    const idempotency = { "idempotency-key": "nango_profile_retry_001" };
    const first = await POST(
      sessionRequest({ integrationId: "int_slack" }, idempotency),
    );
    const second = await POST(
      sessionRequest(
        { integrationId: "int_slack" },
        {
          ...idempotency,
          "x-test-user-name": "Ada Renamed",
          "x-test-user-email": "ada.renamed@example.com",
        },
      ),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const retrySession = nangoSdk.createConnectSession.mock.calls[1]?.[0];
    expect(retrySession.end_user).toEqual({
      id: "org_northstar:admin_ada",
      email: "ada@example.com",
      display_name: "Ada Admin",
    });
    expect(retrySession.tags).toEqual(
      expect.objectContaining({
        [NANGO_TAGS.endUserEmail]: "ada@example.com",
        [NANGO_TAGS.endUserDisplayName]: "Ada Admin",
      }),
    );
  });

  it("rejects a different concurrent command instead of invalidating its live session", async () => {
    const first = await POST(
      sessionRequest(
        { integrationId: "int_intercom" },
        { "idempotency-key": "nango_first_command" },
      ),
    );
    const conflict = await POST(
      sessionRequest(
        { integrationId: "int_intercom" },
        { "idempotency-key": "nango_second_command" },
      ),
    );

    expect(first.status).toBe(200);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      error: "A connection is already in progress.",
    });
    expect(nangoSdk.createConnectSession).toHaveBeenCalledTimes(1);
  });

  it("requires an administrator and enforces the authenticated organization", async () => {
    const contributor = await POST(
      sessionRequest(
        { integrationId: "int_slack" },
        { "x-test-user-role": "Contributor" },
      ),
    );
    expect(contributor.status).toBe(403);

    const crossTenant = await POST(
      sessionRequest(
        { integrationId: "int_slack" },
        { "x-org-id": "org_other" },
      ),
    );
    expect(crossTenant.status).toBe(403);
    expect(nangoSdk.createConnectSession).not.toHaveBeenCalled();
  });

  it("fails closed before creating an attempt when the webhook signing key is missing", async () => {
    delete process.env.NANGO_WEBHOOK_SIGNING_KEY;
    const blocked = await POST(
      sessionRequest(
        { integrationId: "int_github" },
        { "idempotency-key": "nango_missing_webhook_key" },
      ),
    );

    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toEqual({
      error: "This connector is unavailable right now. Please try again later.",
    });
    expect(nangoSdk.createConnectSession).not.toHaveBeenCalled();

    process.env.NANGO_WEBHOOK_SIGNING_KEY = "test-webhook-signing-key";
    const retryWithAnotherCommand = await POST(
      sessionRequest(
        { integrationId: "int_github" },
        { "idempotency-key": "nango_after_webhook_key" },
      ),
    );
    expect(retryWithAnotherCommand.status).toBe(200);
    expect(nangoSdk.createConnectSession).toHaveBeenCalledTimes(1);
  });

  it("returns a generic failure and allows the exact command to retry safely", async () => {
    const headers = { "idempotency-key": "nango_failed_retry_001" };
    nangoSdk.createConnectSession.mockRejectedValueOnce(
      new Error("upstream leaked credential and account details"),
    );
    const failed = await POST(
      sessionRequest({ integrationId: "int_zendesk" }, headers),
    );
    expect(failed.status).toBe(503);
    const body = await failed.json();
    expect(body).toEqual({
      error: "This connector is unavailable right now. Please try again later.",
    });
    expect(JSON.stringify(body)).not.toContain("credential");

    const retry = await POST(
      sessionRequest({ integrationId: "int_zendesk" }, headers),
    );
    expect(retry.status).toBe(200);
    expect(nangoSdk.createConnectSession).toHaveBeenCalledTimes(2);
  });
});
