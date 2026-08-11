import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const dependencies = vi.hoisted(() => ({ authorize: vi.fn(), send: vi.fn() }));

vi.mock("@/lib/request-security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/request-security")>();
  return { ...actual, authorizeMutation: dependencies.authorize };
});
vi.mock("@/lib/onboarding-support-email", () => ({
  sendOnboardingSupportEmail: dependencies.send,
}));

import { POST } from "./route";

function request(body: unknown) {
  return new NextRequest("https://closespan.com/api/onboarding/support", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("onboarding support route", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    dependencies.authorize.mockReset().mockResolvedValue({
      orgId: "org-1",
      organizationName: "Northstar",
      actorId: "user-1",
      actorName: "Avery Chen",
      actorEmail: "avery@example.com",
      role: "Admin",
      idempotencyKey: "support-1",
      traceId: "trace-1",
    });
    dependencies.send.mockReset().mockResolvedValue({
      configured: true,
      sent: true,
    });
  });

  it("delivers a validated support request", async () => {
    const response = await POST(
      request({
        replyEmail: "customer@example.com",
        subject: "Connector help",
        message: "Please help me connect Slack.",
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sent: true,
      recipient: "support@closespan.com",
    });
    expect(dependencies.send).toHaveBeenCalledWith({
      replyEmail: "customer@example.com",
      subject: "Connector help",
      message: "Please help me connect Slack.",
      organizationName: "Northstar",
      actorName: "Avery Chen",
      actorEmail: "avery@example.com",
    });
  });

  it("rejects invalid email and empty messages", async () => {
    const response = await POST(
      request({ replyEmail: "not-an-email", subject: "", message: "" }),
    );
    expect(response.status).toBe(400);
    expect(dependencies.send).not.toHaveBeenCalled();
  });

  it("returns a recoverable error when delivery is unavailable", async () => {
    dependencies.send.mockResolvedValue({
      configured: true,
      sent: false,
      error: "Unauthorized",
    });
    const response = await POST(
      request({
        replyEmail: "customer@example.com",
        subject: "",
        message: "Please help.",
      }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Support email is temporarily unavailable.",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[onboarding-support] delivery failed",
      {
        configured: true,
        error: "Unauthorized",
        orgId: "org-1",
      },
    );
  });
});
