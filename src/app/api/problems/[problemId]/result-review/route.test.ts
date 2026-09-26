import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ record: vi.fn(), demo: vi.fn() }));
vi.mock("@/lib/issue-result-review-repository", () => ({ recordIssueResultReview: mocks.record }));
vi.mock("@/lib/presentation-demo", () => ({ readPresentationDemo: mocks.demo }));
import { POST } from "./route";

const params = { params: Promise.resolve({ problemId: "issue-a" }) };
function request(headers: Record<string, string> = {}, body = JSON.stringify({ decision: "accept", runId: "run-a", commitSha: "a".repeat(40), promptHash: "b".repeat(64), version: 0 })) {
  return new NextRequest("http://localhost/api/problems/issue-a/result-review", { method: "POST", body,
    headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": "result_review_test", ...headers } });
}
beforeEach(() => { vi.resetAllMocks(); mocks.demo.mockResolvedValue(false); mocks.record.mockResolvedValue({ version: 1 }); });

describe("implementation result review endpoint", () => {
  it("requires a signed-in contributor or administrator", async () => {
    expect((await POST(request({ "x-test-auth": "none" }), params)).status).toBe(401);
    expect((await POST(request({ "x-test-user-role": "Viewer" }), params)).status).toBe(403);
    expect(mocks.record).not.toHaveBeenCalled();
    expect((await POST(request({ "x-test-user-role": "Contributor" }), params)).status).toBe(200);
  });
  it("rejects foreign scope, cross-origin writes, missing idempotency and demo mutations", async () => {
    expect((await POST(request({ "x-org-id": "foreign-org" }), params)).status).toBe(403);
    expect((await POST(request({ origin: "https://attacker.test" }), params)).status).toBe(403);
    expect((await POST(request({ "idempotency-key": "" }), params)).status).toBe(400);
    mocks.demo.mockResolvedValue(true);
    expect((await POST(request(), params)).status).toBe(403);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("binds writes to the signed-in organization and disables response caching", async () => {
    const response = await POST(request({ "x-test-user-org-id": "org-a" }), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-a" }), "issue-a", expect.objectContaining({ decision: "accept" }));
  });
  it("rejects oversized and malformed requests before recording feedback", async () => {
    expect((await POST(request({}, "a".repeat(24_001)), params)).status).toBe(413);
    expect((await POST(request({}, "not-json"), params)).status).toBe(400);
    expect(mocks.record).not.toHaveBeenCalled();
  });
});
