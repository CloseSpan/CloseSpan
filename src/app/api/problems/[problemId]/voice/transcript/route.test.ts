import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/request-security";
const mock = vi.hoisted(() => ({ authorize: vi.fn(), stream: vi.fn(), demo: vi.fn() }));
vi.mock("@/lib/issue-voice-repository", () => ({ authorizeVoiceSession: mock.authorize }));
vi.mock("@/lib/issue-voice-transcript", () => ({ voiceTranscriptStream: mock.stream }));
vi.mock("@/lib/presentation-demo", () => ({ readPresentationDemo: mock.demo }));
import { POST } from "./route";
let counter = 0;
const params = { params: Promise.resolve({ problemId: "issue" }) };
function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/problems/issue/voice/transcript", {
    method: "POST", headers: { origin: "http://localhost:3000", "idempotency-key": "caption-request-123",
      "x-test-user-org-id": "org", "x-test-user-id": `caption-${counter++}`, ...headers }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("APP_MODE", "production"); mock.demo.mockResolvedValue(false);
  mock.authorize.mockResolvedValue({ ticket: { callId: "call_scoped" }, apiKey: "server-only-key" });
  mock.stream.mockImplementation(() => new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('{"type":"heartbeat"}\n')); controller.close();
  } }));
});
afterEach(() => vi.unstubAllEnvs());
describe("authenticated captions", () => {
  it.each([
    [{ "x-test-auth": "none" }, 401], [{ "x-test-user-role": "Viewer" }, 403],
    [{ "x-org-id": "foreign" }, 403], [{ origin: "https://evil.example" }, 403],
  ] as const)("requires authenticated workspace access %j", async (headers, code) => {
    expect((await POST(request({ ticket: "signed" }, headers), params)).status).toBe(code);
    expect(mock.stream).not.toHaveBeenCalled();
  });
  it("only monitors the server-authorized call and never returns the API key", async () => {
    const response = await POST(request({ ticket: "signed" }), params);
    expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe("application/x-ndjson");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mock.authorize).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org" }), "issue", "signed");
    expect(mock.stream).toHaveBeenCalledWith("call_scoped", "server-only-key", expect.any(AbortSignal));
    expect(await response.text()).not.toContain("server-only-key");
  });
  it("rejects arbitrary call IDs and invalid or expired tickets before monitoring", async () => {
    expect((await POST(request({ ticket: "signed", call_id: "foreign" }), params)).status).toBe(400);
    mock.authorize.mockRejectedValueOnce(new HttpError(403, "Expired session"));
    expect((await POST(request({ ticket: "expired" }), params)).status).toBe(403);
    expect(mock.stream).not.toHaveBeenCalled();
  });
});
