import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  client: { query: vi.fn() },
  pool: { query: vi.fn() },
  transaction: vi.fn(),
}));

vi.mock("./db", () => ({
  databasePool: () => database.pool,
  transaction: database.transaction,
}));
vi.mock("./workspace-persistence", () => ({ workspacePersistenceMode: () => "postgres" }));

import { cloudflarePromptEmailConfiguration, deliverPromptReviewEmails } from "./prompt-review-email";

const row = {
  id: "email-1",
  org_id: "org-1",
  prompt_id: "prompt-1",
  problem_id: "problem-1",
  reviewer_id: "reviewer-1",
  to_email: "reviewer@example.com",
  attempts: 1,
  title: "Large exports are empty",
  artifact_path: ".prompt/tickets/problem-1.prompt.md",
  reviewer_name: "Avery Chen",
};

describe("prompt review email delivery", () => {
  beforeEach(() => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "account-1";
    process.env.CLOUDFLARE_EMAIL_API_TOKEN = "email-token";
    process.env.PROMPT_REVIEW_EMAIL_FROM = "notifications@closespan.com";
    process.env.AUTH_URL = "https://closespan.com";
    database.pool.query.mockReset().mockResolvedValue({ rows: [], rowCount: 1 });
    database.client.query.mockReset()
      .mockResolvedValueOnce({ rows: [row], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    database.transaction.mockReset().mockImplementation(async (work) => work(database.client));
  });
  afterEach(() => vi.restoreAllMocks());

  it("requires explicit Cloudflare REST credentials and a sender", () => {
    expect(cloudflarePromptEmailConfiguration()).toMatchObject({
      accountId: "account-1",
      from: "notifications@closespan.com",
      appOrigin: "https://closespan.com",
    });
    delete process.env.CLOUDFLARE_EMAIL_API_TOKEN;
    expect(cloudflarePromptEmailConfiguration()).toBeNull();
  });

  it("sends both HTML and text and records accepted delivery", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      errors: [],
      result: { delivered: [row.to_email], queued: [], permanent_bounces: [], message_id: "message-1" },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await deliverPromptReviewEmails("org-1", { fetcher, limit: 2 });
    expect(result).toEqual({ configured: true, sent: 1, retried: 0, failed: 0 });
    const request = fetcher.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload).toMatchObject({ to: row.to_email, subject: expect.stringContaining(row.title) });
    expect(payload.text).toContain("PDD testing and Tenki execution still require explicit approval");
    expect(payload.html).toContain("Review implementation prompt");
    expect(database.pool.query).toHaveBeenCalledWith(expect.stringContaining("status=$2"), expect.arrayContaining(["email-1", "Sent"]));
  });

  it("retries Cloudflare rate limits without losing the outbox record", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      errors: [{ code: 1000, message: "Rate limited" }],
      result: null,
    }), { status: 429 }));
    const result = await deliverPromptReviewEmails("org-1", { fetcher, limit: 1 });
    expect(result.retried).toBe(1);
    expect(database.pool.query).toHaveBeenCalledWith(expect.stringContaining("status=$2"), expect.arrayContaining(["email-1", "Pending"]));
  });
});
