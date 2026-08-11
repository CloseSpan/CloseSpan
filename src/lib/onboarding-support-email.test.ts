import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendOnboardingSupportEmail } from "./onboarding-support-email";

describe("onboarding support email", () => {
  beforeEach(() => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "account-1";
    process.env.CLOUDFLARE_EMAIL_API_TOKEN = "token-1";
    process.env.SUPPORT_EMAIL_FROM = "hello@closespan.com";
  });

  afterEach(() => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_EMAIL_API_TOKEN;
    delete process.env.SUPPORT_EMAIL_FROM;
  });

  it("sends the support request with a safe reply-to address", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: { queued: ["support@closespan.com"] },
        }),
        { status: 200 },
      ),
    );

    await expect(
      sendOnboardingSupportEmail(
        {
          replyEmail: "customer@example.com",
          subject: "Connector help",
          message: "Please help me connect our support source.",
          organizationName: "Northstar",
          actorName: "Avery Chen",
          actorEmail: "avery@example.com",
        },
        fetcher,
      ),
    ).resolves.toEqual({ configured: true, sent: true });

    const request = JSON.parse(fetcher.mock.calls[0][1].body as string);
    expect(request).toMatchObject({
      to: "support@closespan.com",
      from: { address: "hello@closespan.com", name: "CloseSpan Onboarding" },
      reply_to: "customer@example.com",
      subject: "[CloseSpan onboarding] Connector help",
    });
    expect(request.text).toContain("Workspace: Northstar");
    expect(request.text).toContain("Please help me connect our support source.");
  });

  it("reports unavailable configuration without attempting delivery", async () => {
    delete process.env.CLOUDFLARE_EMAIL_API_TOKEN;
    const fetcher = vi.fn();
    await expect(
      sendOnboardingSupportEmail(
        {
          replyEmail: "customer@example.com",
          subject: null,
          message: "Please help.",
          organizationName: "Northstar",
          actorName: "Avery Chen",
          actorEmail: "avery@example.com",
        },
        fetcher,
      ),
    ).resolves.toMatchObject({ configured: false, sent: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
