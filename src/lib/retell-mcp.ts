import { MCPServerStreamableHttp } from "@openai/agents";
import { getRetellCall, retellCallIdSchema, retellCallSchema, type RetellCall } from "./retell-api";
import { HttpError } from "./request-security";

// Closed allowlist: never hand Retell's full tool catalog to an agent.
const READ_CALL_TOOLS = new Set(["get_call", "getCall", "retrieve_call"]);

export async function readRetellCall(apiKey: string, callId: string): Promise<{ call: RetellCall; transport: "mcp" | "api" }> {
  if (!retellCallIdSchema.safeParse(callId).success) throw new HttpError(400, "Enter a valid Retell call ID.");
  const server = new MCPServerStreamableHttp({
    name: "Retell call reader", url: "https://mcp.retellai.com",
    clientSessionTimeoutSeconds: 10, timeout: 15_000,
    requestInit: { headers: { Authorization: `Bearer ${apiKey}` }, redirect: "error" },
    // MCP SDK logs can include provider content. Keep credentials and conversations out of logs.
    logger: { namespace: "retell", dontLogModelData: true, dontLogToolData: true, debug() {}, error() {}, warn() {} },
  });
  try {
    await server.connect();
    const tools = await server.listTools();
    const tool = tools.find((candidate) => {
      if (!READ_CALL_TOOLS.has(candidate.name)) return false;
      const schema = candidate.inputSchema;
      const properties = schema.properties as Record<string, { type?: string }> | undefined;
      const required = schema.required as string[] | undefined;
      return properties?.call_id?.type === "string" && (!required || required.every((key) => key === "call_id"));
    });
    if (tool) {
      const content = await server.callTool(tool.name, { call_id: callId });
      for (const block of content) {
        if (block.type !== "text" || typeof block.text !== "string" || block.text.length > 1_500_000) continue;
        const parsed = retellCallSchema.safeParse(JSON.parse(block.text));
        if (parsed.success && parsed.data.call_id === callId) return { call: parsed.data, transport: "mcp" };
      }
    }
  } catch {
    // Fail closed on unknown tools/schemas and use the fixed read-only API, never a guessed mutation.
  } finally { await server.close().catch(() => undefined); }
  return { call: await getRetellCall(apiKey, callId), transport: "api" };
}
