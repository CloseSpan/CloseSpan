import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/request-security";

const mock = vi.hoisted(() => ({ read: vi.fn(), post: vi.fn(), demo: vi.fn() }));
vi.mock("@/lib/issue-scenario-check-repository", () => ({ readIssueScenarioCheck: mock.read, postIssueScenarioCheck: mock.post }));
vi.mock("@/lib/presentation-demo", () => ({ readPresentationDemo: mock.demo }));
import { GET, POST } from "./route";

const params = { params: Promise.resolve({ problemId: "issue" }) };
const body = { userStory: "Export every row", currentPromptHash: "a".repeat(64) };
let counter = 0;
function request(method = "GET", content?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/problems/issue/scenario-check", { method,
    headers: { origin: "http://localhost:3000", "idempotency-key": "scenario-key-123", "x-test-user-org-id": "org", "x-test-user-id": `scenario-route-${counter++}`, ...headers },
    ...(method === "POST" ? { body: typeof content === "string" ? content : JSON.stringify(content) } : {}) });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("APP_MODE", "production"); mock.demo.mockResolvedValue(false);
  mock.read.mockResolvedValue({ check: null, currentPromptHash: body.currentPromptHash, storageReady: true });
  mock.post.mockResolvedValue({ status: "completed", replayed: false, promptHash: body.currentPromptHash });
});
afterEach(() => vi.unstubAllEnvs());

describe("issue scenario check API", () => {
  it("allows a viewer to read their tenant's current check without caching", async () => {
    const response = await GET(request("GET", undefined, { "x-test-user-role": "Viewer" }), params);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mock.read).toHaveBeenCalledWith("org", "issue");
  });
  it.each<Record<string, string>>([{ "x-test-auth": "none" }, { "x-org-id": "other-org" }])("protects reads %j", async (headers) => {
    expect((await GET(request("GET", undefined, headers), params)).status).toBe(headers["x-test-auth"] ? 401 : 403);
    expect(mock.read).not.toHaveBeenCalled();
  });
  it.each([
    [{ "x-test-auth": "none" }, 401], [{ "x-test-user-role": "Viewer" }, 403],
    [{ "x-org-id": "other-org" }, 403], [{ "idempotency-key": "bad" }, 400], [{ origin: "https://other.example" }, 403],
  ] as const)("protects mutations %j", async (headers, status) => {
    expect((await POST(request("POST", body, headers), params)).status).toBe(status); expect(mock.post).not.toHaveBeenCalled();
  });
  it("returns 202 for the same in-flight reservation and 200 for saved failures", async () => {
    mock.post.mockResolvedValueOnce({ status: "processing", replayed: true, promptHash: body.currentPromptHash });
    expect((await POST(request("POST", body), params)).status).toBe(202);
    mock.post.mockResolvedValueOnce({ status: "failed", replayed: true, notice: "Check failed", promptHash: body.currentPromptHash });
    expect((await POST(request("POST", body), params)).status).toBe(200);
    expect(mock.post).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org" }), "issue", body);
  });
  it("rejects demo writes and malformed or oversized JSON", async () => {
    mock.demo.mockResolvedValueOnce(true);
    expect((await POST(request("POST", body), params)).status).toBe(403);
    expect((await POST(request("POST", "{"), params)).status).toBe(400);
    expect((await POST(request("POST", "a".repeat(12001)), params)).status).toBe(413);
    expect(mock.post).not.toHaveBeenCalled();
  });
  it("keeps internal errors private and preserves actionable safe errors", async () => {
    mock.read.mockRejectedValueOnce(new Error("password=secret db=private"));
    const response = await GET(request(), params); expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/secret|private|password/);
    mock.post.mockRejectedValueOnce(new HttpError(409, "The requirement changed"));
    expect((await POST(request("POST", body), params)).status).toBe(409);
  });
});
