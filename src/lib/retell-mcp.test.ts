import { beforeEach, describe, expect, it, vi } from "vitest";
const mcp = vi.hoisted(() => ({ connect: vi.fn(), close: vi.fn(), listTools: vi.fn(), callTool: vi.fn(), api: vi.fn() }));
vi.mock("@openai/agents", () => ({ MCPServerStreamableHttp: class { connect = mcp.connect; close = mcp.close; listTools = mcp.listTools; callTool = mcp.callTool; } }));
vi.mock("./retell-api", async (original) => ({ ...await original<typeof import("./retell-api")>(), getRetellCall: mcp.api }));
import { readRetellCall } from "./retell-mcp";
const call = { call_id: "call_123", call_status: "ended", transcript: "Export failed", call_analysis: { call_summary: "Export failed" } };
const readTool = { name: "get_call", inputSchema: { type: "object", properties: { call_id: { type: "string" } }, required: ["call_id"] } };
beforeEach(() => { vi.resetAllMocks(); mcp.connect.mockResolvedValue(undefined); mcp.close.mockResolvedValue(undefined); mcp.listTools.mockResolvedValue([readTool]); mcp.callTool.mockResolvedValue([{ type: "text", text: JSON.stringify(call) }]); mcp.api.mockResolvedValue(call); });
describe("Retell MCP read boundary", () => {
  it("discovers a known read tool and calls it with only the call ID", async () => {
    expect(await readRetellCall("key", call.call_id)).toEqual({ call, transport: "mcp" });
    expect(mcp.callTool).toHaveBeenCalledExactlyOnceWith("get_call", { call_id: call.call_id });
    expect(mcp.close).toHaveBeenCalled(); expect(mcp.api).not.toHaveBeenCalled();
  });
  it.each(["create_phone_call", "update_agent", "delete_call", "get_call_and_update_agent"])("never invokes %s, even if advertised as read-only", async (name) => {
    mcp.listTools.mockResolvedValue([{ ...readTool, name, annotations: { readOnlyHint: true } }]);
    expect((await readRetellCall("key", call.call_id)).transport).toBe("api"); expect(mcp.callTool).not.toHaveBeenCalled();
  });
  it("rejects unexpected required arguments", async () => {
    mcp.listTools.mockResolvedValue([{ ...readTool, inputSchema: { ...readTool.inputSchema, required: ["call_id", "action"] } }]);
    await readRetellCall("key", call.call_id); expect(mcp.callTool).not.toHaveBeenCalled();
  });
  it("falls back safely on malformed content or a different call", async () => {
    for (const text of ["not json", JSON.stringify({ ...call, call_id: "someone_else" })]) {
      mcp.callTool.mockResolvedValue([{ type: "text", text }]);
      expect((await readRetellCall("key", call.call_id)).transport).toBe("api");
    }
  });
  it("closes the session when connection fails", async () => {
    mcp.connect.mockRejectedValue(new Error("key must not leak"));
    expect((await readRetellCall("key", call.call_id)).transport).toBe("api"); expect(mcp.close).toHaveBeenCalled();
  });
  it("rejects invalid IDs without connecting", async () => {
    await expect(readRetellCall("key", "../write")).rejects.toMatchObject({ status: 400 }); expect(mcp.connect).not.toHaveBeenCalled();
  });
});
