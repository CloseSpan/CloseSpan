import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const billing = vi.hoisted(() => ({ retry: vi.fn() }));

vi.mock("@/lib/billing-outbox", () => ({
  requeueFailedBillingShadow: billing.retry,
}));

import { POST } from "./route";

function request(options: { role?: string; authenticated?: boolean } = {}) {
  return new NextRequest("http://localhost/api/settings/billing/retry", {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "idempotency-key": `billing_${crypto.randomUUID().replaceAll("-", "")}`,
      "x-request-id": crypto.randomUUID(),
      "x-test-auth": options.authenticated === false ? "none" : "user",
      "x-test-user-id": "user_alpha",
      "x-test-user-org-id": "org_alpha",
      "x-test-user-role": options.role ?? "Admin",
    },
  });
}

describe("billing shadow retry route", () => {
  beforeEach(() => {
    billing.retry.mockReset().mockResolvedValue({
      customersRequeued: 1,
      eventsRequeued: 2,
    });
  });

  it("allows an administrator to requeue only their workspace", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      customersRequeued: 1,
      eventsRequeued: 2,
    });
    expect(billing.retry).toHaveBeenCalledWith("org_alpha");
  });

  it("rejects unauthenticated and non-administrator requests", async () => {
    expect((await POST(request({ authenticated: false }))).status).toBe(401);
    expect((await POST(request({ role: "Contributor" }))).status).toBe(403);
    expect(billing.retry).not.toHaveBeenCalled();
  });
});
