import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendWaitlistApprovalEmail } from "./waitlist-approval-email";

describe("waitlist approval email", () => {
  beforeEach(() => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "account-1";
    process.env.CLOUDFLARE_EMAIL_API_TOKEN = "token-1";
    process.env.WAITLIST_APPROVAL_EMAIL_FROM = "hello@closespan.com";
    process.env.AUTH_URL = "https://www.closespan.com";
  });
  afterEach(() => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_EMAIL_API_TOKEN;
    delete process.env.WAITLIST_APPROVAL_EMAIL_FROM;
    delete process.env.AUTH_URL;
  });

  it("sends a transactional welcome email with the production sign-in link", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: { queued: ["person@example.com"] },
    }), { status: 200 }));

    await expect(sendWaitlistApprovalEmail({
      email: "person@example.com",
      displayName: "Person",
    }, fetcher)).resolves.toEqual({ configured: true, sent: true });
    const request = JSON.parse(fetcher.mock.calls[0][1].body as string);
    expect(request).toMatchObject({
      to: "person@example.com",
      from: { address: "hello@closespan.com", name: "CloseSpan" },
      subject: "Your CloseSpan access is approved",
    });
    expect(request.text).toContain("https://www.closespan.com/login?callbackUrl=/overview");
  });

  it("fails honestly when transactional email is not configured", async () => {
    delete process.env.CLOUDFLARE_EMAIL_API_TOKEN;
    await expect(sendWaitlistApprovalEmail({
      email: "person@example.com",
      displayName: null,
    })).resolves.toMatchObject({ configured: false, sent: false });
  });
});
