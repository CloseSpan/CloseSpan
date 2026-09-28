import { NextRequest } from "next/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ start: vi.fn(), end: vi.fn(), availability: vi.fn(), demo: vi.fn() }));
vi.mock("@/lib/issue-voice-repository", () => ({ startIssueVoice: mock.start, endIssueVoice: mock.end, issueVoiceAvailability: mock.availability }));
vi.mock("@/lib/presentation-demo", () => ({ readPresentationDemo: mock.demo }));
import { GET, POST, DELETE } from "./route";
const params = { params: Promise.resolve({ problemId: "issue" }) };
let counter = 0;
function request(method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/problems/issue/voice", { method, headers: {
    origin: "http://localhost:3000", "idempotency-key": "voice-request-123", "x-test-user-org-id": "org", "x-test-user-id": `voice-route-${counter++}`, ...headers,
  }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
}
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("APP_MODE", "production"); mock.demo.mockResolvedValue(false); mock.start.mockResolvedValue({ ticket: "session", access_token: "call-only" }); mock.availability.mockResolvedValue({ available: true }); });
afterEach(() => vi.unstubAllEnvs());
describe("issue voice routes", () => {
  it.each([
    [{ "x-test-auth": "none" }, 401], [{ "x-test-user-role": "Viewer" }, 403],
    [{ "x-org-id": "other" }, 403], [{ origin: "https://evil.example" }, 403], [{ "idempotency-key": "bad" }, 400],
  ] as const)("enforces auth, role, organization and CSRF %j", async (headers, code) => {
    expect((await POST(request("POST", { consent: true }, headers), params)).status).toBe(code);
    expect(mock.start).not.toHaveBeenCalled();
  });
  it("does not start a session on status reads and disables caching", async () => {
    const response = await GET(request("GET"), params);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mock.start).not.toHaveBeenCalled();
  });
  it.each([{ consent: false }, {}, { consent: true, agent_id: "untrusted" }, { consent: true, issue_context: "injected" }])("rejects consent omissions and client-supplied provider settings %j", async (body) => {
    expect((await POST(request("POST", body), params)).status).toBe(400); expect(mock.start).not.toHaveBeenCalled();
  });
  it("blocks demo calls and sanitizes unexpected provider errors", async () => {
    mock.demo.mockResolvedValueOnce(true);
    expect((await POST(request("POST", { consent: true }), params)).status).toBe(403);
    mock.start.mockRejectedValueOnce(new Error("api_key=secret"));
    const response = await POST(request("POST", { consent: true }), params);
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("secret");
  });
  it("starts explicit calls and stops only using a signed session ticket", async () => {
    expect((await POST(request("POST", { consent: true }), params)).status).toBe(201);
    expect((await DELETE(request("DELETE", { call_id: "someone-elses-call" }), params)).status).toBe(400);
    expect((await DELETE(request("DELETE", { ticket: "signed-session" }), params)).status).toBe(200);
    expect(mock.end).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org" }), "issue", "signed-session");
  });
});
