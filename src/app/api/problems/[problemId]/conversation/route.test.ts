import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/request-security";

const mock = vi.hoisted(() => ({ read: vi.fn(), post: vi.fn(), demo: vi.fn() }));
vi.mock("@/lib/issue-conversation-repository", () => ({ readIssueConversation: mock.read, postIssueConversation: mock.post }));
vi.mock("@/lib/presentation-demo", () => ({ readPresentationDemo: mock.demo }));
import { GET, POST } from "./route";

const params = { params: Promise.resolve({ problemId: "issue" }) };
let counter = 0;
function request(method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/problems/issue/conversation", { method,
    headers: { origin: "http://localhost:3000", "idempotency-key": "issue-send-123", "x-test-user-org-id": "org", "x-test-user-id": `route-test-${counter++}`, ...headers },
    ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("APP_MODE", "production");
  mock.demo.mockResolvedValue(false);
  mock.read.mockResolvedValue({ messages: [], storageReady: true, pending: false });
  mock.post.mockResolvedValue({ messages: [], storageReady: true, pending: false, status: "completed", replayed: false });
});
afterEach(() => vi.unstubAllEnvs());

describe("issue discussion API", () => {
  it("allows authenticated viewer reads scoped to their organization with no cache", async () => {
    const response = await GET(request("GET", undefined, { "x-test-user-role": "Viewer" }), params);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mock.read).toHaveBeenCalledWith("org", "issue");
  });
  it.each<Record<string, string>>([{ "x-test-auth": "none" }, { "x-org-id": "other-org" }])("rejects unauthorized reads %j", async (headers) => {
    expect((await GET(request("GET", undefined, headers), params)).status).toBe(headers["x-test-auth"] ? 401 : 403);
    expect(mock.read).not.toHaveBeenCalled();
  });
  it.each([
    [{ "x-test-auth": "none" }, 401], [{ "x-test-user-role": "Viewer" }, 403],
    [{ "x-org-id": "other-org" }, 403], [{ "idempotency-key": "bad" }, 400], [{ origin: "https://evil.example" }, 403],
  ] as const)("retains authorization and idempotency protections %j", async (headers, status) => {
    expect((await POST(request("POST", { message: "Why?" }, headers), params)).status).toBe(status);
    expect(mock.post).not.toHaveBeenCalled();
  });
  it("blocks presentation writes", async () => {
    mock.demo.mockResolvedValue(true);
    expect((await POST(request("POST", { message: "Why?" }), params)).status).toBe(403);
    expect(mock.post).not.toHaveBeenCalled();
  });
  it("accepts contributor sends and returns processing replays with 202", async () => {
    mock.post.mockResolvedValue({ messages: [], storageReady: true, pending: true, status: "processing", replayed: true });
    const response = await POST(request("POST", { message: "Why?" }, { "x-test-user-role": "Contributor" }), params);
    expect(response.status).toBe(202);
    expect(mock.post).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org", role: "Contributor", idempotencyKey: "issue-send-123" }), "issue", { message: "Why?" });
  });
  it("rejects oversized and malformed payloads before posting", async () => {
    expect((await POST(request("POST", "{"), params)).status).toBe(400);
    expect((await POST(request("POST", "a".repeat(12001)), params)).status).toBe(413);
    expect(mock.post).not.toHaveBeenCalled();
  });
  it("keeps unknown errors generic and preserves safe setup errors", async () => {
    mock.read.mockRejectedValueOnce(new Error("postgres password=secret host=private"));
    const response = await GET(request(), params);
    expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/password|secret|private/);
    mock.post.mockRejectedValueOnce(new HttpError(503, "Issue discussion needs database setup"));
    expect((await POST(request("POST", { message: "Why?" }), params)).status).toBe(503);
  });
});
