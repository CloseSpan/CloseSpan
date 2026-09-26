import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ decide: vi.fn(), retry: vi.fn() }));
vi.mock("@/lib/problem-prompt-review-repository", () => ({ recordProblemReviewDecision: calls.decide, retryProblemPromptReview: calls.retry }));
import { POST } from "./route";
import { POST as retry } from "./retry/route";

const params = { params: Promise.resolve({ problemId: "problem-1" }) };
function request(headers: Record<string, string> = {}, body = JSON.stringify({ version: 1, promptHash: "a".repeat(64), decision: "confirm" })) {
  return new NextRequest("http://localhost/api/problems/problem-1/prompt-review", { method: "POST", body,
    headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": "domain_review_test", ...headers } });
}
beforeEach(() => { vi.resetAllMocks(); calls.decide.mockResolvedValue({ status: "Confirmed" }); });
describe("domain review endpoint", () => {
  it("requires authentication and contributor permission", async () => {
    expect((await POST(request({ "x-test-auth": "none" }), params)).status).toBe(401);
    expect((await POST(request({ "x-test-user-role": "Viewer" }), params)).status).toBe(403);
    expect(calls.decide).not.toHaveBeenCalled();
  });
  it("rejects cross-tenant scope, cross-origin requests and missing idempotency keys", async () => {
    expect((await POST(request({ "x-org-id": "other-org" }), params)).status).toBe(403);
    expect((await POST(request({ origin: "https://attacker.example" }), params)).status).toBe(403);
    expect((await POST(request({ "idempotency-key": "" }), params)).status).toBe(400);
    expect(calls.decide).not.toHaveBeenCalled();
  });
  it("stores only the signed-in organization's decision and returns no-store", async () => {
    const response = await POST(request({ "x-test-user-org-id": "org-a" }), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(calls.decide).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-a" }), "problem-1", expect.objectContaining({ decision: "confirm" }));
  });
  it("rejects oversized and malformed messages without starting any work", async () => {
    expect((await POST(request({}, "a".repeat(9000)), params)).status).toBe(413);
    expect((await POST(request({}, "not json"), params)).status).toBe(400);
    expect(calls.decide).not.toHaveBeenCalled();
  });
  it("restricts recovery retries to administrators", async () => {
    expect((await retry(request({ "x-test-user-role": "Contributor" }, '{"version":1}'), params)).status).toBe(403);
    expect(calls.retry).not.toHaveBeenCalled();
    expect((await retry(request({}, '{"version":1}'), params)).status).toBe(202);
    expect(calls.retry).toHaveBeenCalledWith(expect.objectContaining({ role: "Admin" }), "problem-1", 1);
  });
});
