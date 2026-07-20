import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { resetNangoMemoryState } from "@/lib/nango-repository";
import {
  claimNextNangoSyncJob,
  enqueueNangoSyncJob,
  failNangoSyncJob,
  resetNangoSyncMemoryState,
} from "@/lib/nango-sync-repository";

function request(integrationId: string, orgId = "org_alpha") {
  return new NextRequest(
    `http://localhost/api/integrations/nango/sync/status?integrationId=${integrationId}`,
    {
      headers: {
        "x-org-id": orgId,
        "x-test-user-org-id": "org_alpha",
        "x-test-user-role": "Admin",
      },
    },
  );
}

describe("Nango sync status route", () => {
  beforeEach(() => {
    process.env.PERSISTENCE_MODE = "memory";
    process.env.APP_MODE = "demo";
    resetNangoMemoryState();
    resetNangoSyncMemoryState();
  });

  afterEach(() => {
    resetNangoMemoryState();
    resetNangoSyncMemoryState();
    delete process.env.PERSISTENCE_MODE;
    delete process.env.APP_MODE;
  });

  it("exposes the durable retry time without exposing the connection ID", async () => {
    await enqueueNangoSyncJob({
      payloadHash: "b".repeat(64),
      orgId: "org_alpha",
      integrationId: "int_zendesk",
      providerConfigKey: "zendesk",
      connectionId: "must-not-leak",
      nangoEnvironment: "DEV",
      syncName: "tickets",
      syncVariant: "",
      model: "Ticket",
    });
    const now = new Date("2026-07-20T10:00:00.000Z");
    const job = await claimNextNangoSyncJob({
      workerId: "status-test",
      now,
    });
    await failNangoSyncJob({
      jobId: job!.id,
      workerId: "status-test",
      errorCode: "nango_records_unavailable",
      now,
    });

    const response = await GET(request("int_zendesk"));
    const body = await response.json();
    expect(body.sync).toEqual(
      expect.objectContaining({
        status: "Retrying",
        nextAttemptAt: "2026-07-20T10:01:00.000Z",
      }),
    );
    expect(JSON.stringify(body)).not.toContain("must-not-leak");
  });

  it("returns the latest tenant-scoped import without exposing credentials", async () => {
    await enqueueNangoSyncJob({
      payloadHash: "a".repeat(64),
      orgId: "org_alpha",
      integrationId: "int_zendesk",
      providerConfigKey: "zendesk",
      connectionId: "connection_alpha",
      nangoEnvironment: "DEV",
      syncName: "tickets",
      syncVariant: "",
      model: "Ticket",
    });

    const response = await GET(request("int_zendesk"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      integrationId: "int_zendesk",
      connectionState: null,
      sync: expect.objectContaining({
        integrationId: "int_zendesk",
        syncName: "tickets",
        model: "Ticket",
        status: "Queued",
      }),
    });
  });

  it("rejects unsupported connectors and cross-tenant reads", async () => {
    const unsupported = await GET(request("int_unknown"));
    expect(unsupported.status).toBe(400);

    const crossTenant = await GET(request("int_zendesk", "org_other"));
    expect(crossTenant.status).toBe(403);
  });
});
