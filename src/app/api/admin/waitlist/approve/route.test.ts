import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const dependencies = vi.hoisted(() => ({ approve: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/access-waitlist-repository", () => ({
  approveWorkspaceAccessWaitlistEntry: dependencies.approve,
}));
vi.mock("@/lib/waitlist-approval-email", () => ({
  sendWaitlistApprovalEmail: dependencies.send,
}));

import { POST } from "./route";

function request(email = "shanmukhsain@gmail.com") {
  return new NextRequest("http://localhost/api/admin/waitlist/approve", {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "content-type": "application/json",
      "idempotency-key": `waitlist_${crypto.randomUUID().replaceAll("-", "")}`,
      "x-test-auth": "user",
      "x-test-user-id": "admin-1",
      "x-test-user-org-id": "org-owner",
      "x-test-user-role": "Admin",
      "x-test-user-email": email,
    },
    body: JSON.stringify({ email: "person@example.com" }),
  });
}

describe("waitlist approval route", () => {
  beforeEach(() => {
    dependencies.approve.mockReset().mockResolvedValue({
      entry: { email: "person@example.com", displayName: "Person", status: "Approved" },
      organizationId: "org-person",
      organizationName: "Person's workspace",
    });
    dependencies.send.mockReset().mockResolvedValue({ configured: true, sent: true });
  });

  it("provisions access and immediately sends the approval email", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(dependencies.approve).toHaveBeenCalledWith("person@example.com");
    expect(dependencies.send).toHaveBeenCalledWith({ email: "person@example.com", displayName: "Person" });
  });

  it("rejects workspace admins who are not CloseSpan platform administrators", async () => {
    const response = await POST(request("another-admin@example.com"));
    expect(response.status).toBe(403);
    expect(dependencies.approve).not.toHaveBeenCalled();
  });
});
