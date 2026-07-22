import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const importer = vi.hoisted(() => ({
  pullAll: vi.fn(),
  pullOne: vi.fn(),
}));

vi.mock("@/lib/pipedream-feedback-import", () => ({
  pullAllPipedreamFeedback: importer.pullAll,
  pullPipedreamFeedback: importer.pullOne,
}));

import { POST } from "./route";

function request(body: unknown, options: { role?: string; orgId?: string; authenticated?: boolean } = {}) {
  return new NextRequest("http://localhost/api/integrations/pipedream/pull", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `pull_${crypto.randomUUID()}`,
      "x-test-user-role": options.role ?? "Admin",
      ...(options.orgId ? { "x-org-id": options.orgId } : {}),
      ...(options.authenticated === false ? { "x-test-auth": "none" } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("Pipedream manual feedback pull route", () => {
  beforeEach(() => {
    process.env.APP_MODE = "demo";
    importer.pullAll.mockReset().mockResolvedValue({ results: [{ fetched: 2, created: 2, updated: 0 }], failed: 0, unsupported: 0 });
    importer.pullOne.mockReset().mockResolvedValue({ integrationId: "int_zendesk", accountId: "apn_test", fetched: 2, created: 2, updated: 0, skipped: 0 });
  });

  it("pulls all supported accounts for the authenticated workspace", async () => {
    const response = await POST(request({}));
    expect(response.status).toBe(200);
    expect(importer.pullAll).toHaveBeenCalledWith("org_northstar");
  });

  it("pulls only the tenant-selected account", async () => {
    const response = await POST(request({ integrationId: "int_zendesk", accountId: "apn_test" }));
    expect(response.status).toBe(200);
    expect(importer.pullOne).toHaveBeenCalledWith({ orgId: "org_northstar", integrationId: "int_zendesk", accountId: "apn_test" });
  });

  it("requires an administrator and rejects conflicting workspace scope", async () => {
    expect((await POST(request({}, { role: "Contributor" }))).status).toBe(403);
    expect((await POST(request({}, { orgId: "org_other" }))).status).toBe(403);
    expect(importer.pullAll).not.toHaveBeenCalled();
  });

  it("returns safe provider failures without exposing implementation details", async () => {
    importer.pullOne.mockRejectedValue(new Error("secret upstream stack details"));
    const response = await POST(request({ integrationId: "int_zendesk", accountId: "apn_test" }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Feedback could not be pulled right now. Retry shortly or reconnect the account." });
  });
});
