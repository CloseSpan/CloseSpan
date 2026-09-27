import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({ status: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), load: vi.fn(), ingest: vi.fn(), list: vi.fn(), read: vi.fn(), analyze: vi.fn(), after: vi.fn(), demo: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: deps.after }));
vi.mock("./retell-repository", () => ({ retellStatus: deps.status, connectRetell: deps.connect, disconnectRetell: deps.disconnect, loadRetellConnection: deps.load, ingestRetellCalls: deps.ingest }));
vi.mock("./retell-api", async (original) => ({ ...await original<typeof import("./retell-api")>(), listRetellCalls: deps.list }));
vi.mock("./retell-mcp", () => ({ readRetellCall: deps.read }));
vi.mock("./retell-intake", () => ({ analyzeRetellFeedback: deps.analyze }));
vi.mock("./presentation-demo", () => ({ readPresentationDemo: deps.demo }));
vi.mock("./credential-crypto", () => ({ credentialVaultConfigured: () => true }));
vi.mock("./workspace-persistence", () => ({ workspacePersistenceMode: () => "postgres" }));
import { GET, POST, DELETE } from "@/app/api/integrations/retell/route";
import { POST as importCalls } from "@/app/api/integrations/retell/import/route";
import { POST as webhook } from "@/app/api/webhooks/retell/[endpointId]/route";
const endpoint = `retell_${"a".repeat(32)}`;
const call = { call_id: "call_123", call_status: "ended", transcript: "Export is broken", call_analysis: { call_summary: "Export fails" } };
const context = { params: Promise.resolve({ endpointId: endpoint }) };
function request(method = "POST", payload: unknown = {}, extra: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/integrations/retell", { method, ...(method === "GET" ? {} : { body: JSON.stringify(payload) }), headers: { "Content-Type": "application/json", "x-org-id": "org_one", "x-test-user-org-id": "org_one", "idempotency-key": "retell-test-123456", ...extra } });
}
function signed(payload: unknown, key = "test-key") {
  const body = JSON.stringify(payload); const timestamp = Date.now();
  return request("POST", payload, { "x-retell-signature": `v=${timestamp},d=${createHmac("sha256", key).update(body + timestamp).digest("hex")}` });
}
beforeEach(() => {
  vi.resetAllMocks(); deps.demo.mockResolvedValue(false);
  deps.status.mockResolvedValue({ configured: true, connected: false, keyHint: null, webhookUrl: null, lastImportAt: null });
  deps.load.mockResolvedValue({ orgId: "org_one", publicId: endpoint, apiKey: "test-key" });
  deps.ingest.mockResolvedValue({ imported: 1, existing: 0, skipped: 0, checked: 1 });
  deps.list.mockResolvedValue([call]); deps.read.mockResolvedValue({ call, transport: "mcp" }); deps.connect.mockResolvedValue({ configured: true, connected: true });
});
describe("Retell connection authorization", () => {
  it("requires a signed-in user for status", async () => { expect((await GET(request("GET", {}, { "x-test-auth": "none" }))).status).toBe(401); expect(deps.status).not.toHaveBeenCalled(); });
  it("rejects cross-tenant reads", async () => { expect((await GET(request("GET", {}, { "x-org-id": "other" }))).status).toBe(403); });
  it.each([POST, DELETE, importCalls])("requires administrator permission for mutations", async (handler) => {
    expect((await handler(request("POST", {}, { "x-test-user-role": "Contributor" }))).status).toBe(403);
    expect(deps.list).not.toHaveBeenCalled(); expect(deps.disconnect).not.toHaveBeenCalled(); expect(deps.ingest).not.toHaveBeenCalled();
  });
  it("rejects demo mutations", async () => { deps.demo.mockResolvedValue(true); expect((await POST(request("POST", { apiKey: "test-key" }))).status).toBe(403); expect(deps.connect).not.toHaveBeenCalled(); });
  it("checks API credentials before saving and never imports during connection", async () => {
    expect((await POST(request("POST", { apiKey: "test-key" }))).status).toBe(200);
    expect(deps.list).toHaveBeenCalledWith("test-key", 1); expect(deps.connect).toHaveBeenCalledWith("org_one", expect.any(String), "test-key"); expect(deps.ingest).not.toHaveBeenCalled();
  });
  it("rejects malformed connection data without sending it to Retell", async () => {
    expect((await POST(request("POST", { apiKey: "test-key", orgId: "other" }))).status).toBe(400); expect(deps.list).not.toHaveBeenCalled();
  });
  it("sanitizes unexpected errors", async () => {
    deps.connect.mockRejectedValue(new Error("postgres secret test-key"));
    const response = await POST(request("POST", { apiKey: "test-key" }));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("test-key");
  });
});
describe("Retell import routes", () => {
  it("imports recent calls for the authenticated workspace and schedules analysis", async () => {
    const response = await importCalls(request()); expect(response.status).toBe(200);
    expect(deps.load).toHaveBeenCalledWith({ orgId: "org_one" }); expect(deps.ingest).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org_one" }), [call]);
    expect(deps.after).toHaveBeenCalledTimes(1); expect(await response.text()).not.toContain("test-key");
  });
  it("uses the restricted MCP reader for a specific call", async () => {
    expect((await importCalls(request("POST", { callId: "call_123" }))).status).toBe(200); expect(deps.read).toHaveBeenCalledWith("test-key", "call_123"); expect(deps.list).not.toHaveBeenCalled();
  });
  it("does not import without a connection", async () => { deps.load.mockResolvedValue(null); expect((await importCalls(request())).status).toBe(409); expect(deps.list).not.toHaveBeenCalled(); });
});
describe("Retell webhook boundary", () => {
  it("resolves the tenant from the endpoint, ignoring request organization headers", async () => {
    const response = await webhook(signed({ event: "call_analyzed", call, orgId: "other" }), context);
    expect(response.status).toBe(200); expect(deps.load).toHaveBeenCalledWith({ publicId: endpoint }); expect(deps.ingest).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org_one" }), [call]);
  });
  it("rejects missing or invalid signatures before ingestion", async () => {
    for (const req of [request("POST", { event: "call_analyzed", call }), signed({ event: "call_analyzed", call }, "wrong-key")]) expect((await webhook(req, context)).status).toBe(401);
    expect(deps.ingest).not.toHaveBeenCalled(); expect(deps.after).not.toHaveBeenCalled();
  });
  it("ignores call_ended because analysis is not ready yet", async () => {
    expect(await (await webhook(signed({ event: "call_ended", call }), context)).json()).toEqual({ ignored: true }); expect(deps.ingest).not.toHaveBeenCalled();
  });
  it("rejects invalid calls and unknown endpoints", async () => {
    expect((await webhook(signed({ event: "call_analyzed", call: {} }), context)).status).toBe(400);
    deps.load.mockResolvedValue(null); expect((await webhook(signed({ event: "call_analyzed", call }), context)).status).toBe(404);
  });
  it("acknowledges duplicate delivery without rerunning analysis", async () => {
    deps.ingest.mockResolvedValue({ imported: 0, existing: 1, skipped: 0, checked: 1 });
    expect((await webhook(signed({ event: "call_analyzed", call }), context)).status).toBe(200); expect(deps.after).not.toHaveBeenCalled();
  });
});
