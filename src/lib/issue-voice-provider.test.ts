import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyIssueVoiceAgent, voiceProviderRequest } from "./issue-voice-provider";
import { ISSUE_VOICE_PROMPT } from "./issue-voice";

afterEach(() => vi.unstubAllGlobals());
const agent = { response_engine: { type: "retell-llm", llm_id: "llm_test" }, data_storage_setting: "basic_attributes_only", max_call_duration_ms: 300000, webhook_events: [] };
const llm = { general_prompt: ISSUE_VOICE_PROMPT, general_tools: [], states: [], knowledge_base_ids: [], mcp_servers: [] };
function provider(agentValue = agent, llmValue = llm) {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(agentValue)).mockResolvedValueOnce(Response.json(llmValue));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
describe("voice provider boundary", () => {
  it("checks a dedicated discussion-only agent without creating calls", async () => {
    const fetcher = provider();
    await verifyIssueVoiceAgent("private-key", "agent_test");
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["https://api.retellai.com/get-agent/agent_test", "https://api.retellai.com/get-retell-llm/llm_test"]);
    expect(fetcher.mock.calls.every(([, options]) => options.method === "GET" && options.redirect === "error")).toBe(true);
  });
  it.each(["general_tools", "states", "knowledge_base_ids", "mcp_servers"])("rejects agent changes to %s", async (key) => {
    provider(agent, { ...llm, [key]: ["unexpected-access"] });
    await expect(verifyIssueVoiceAgent("key", "agent_test")).rejects.toMatchObject({ status: 503 });
  });
  it.each([
    { ...agent, data_storage_setting: "everything" },
    { ...agent, max_call_duration_ms: 900000 },
    { ...agent, webhook_events: ["call_ended"] },
  ])("rejects recording, webhook or duration expansion", async (changed) => {
    provider(changed as typeof agent);
    await expect(verifyIssueVoiceAgent("key", "agent_test")).rejects.toMatchObject({ status: 503 });
  });
  it("does not expose raw provider errors or credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("api_key=private-key", { status: 402 })));
    await expect(voiceProviderRequest("private-key", "/v3/create-web-call", {})).rejects.toThrow("Voice minutes are unavailable");
  });
  it("sanitizes network errors and malformed responses without retrying a call", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("private-key")).mockResolvedValueOnce(new Response("not JSON"));
    vi.stubGlobal("fetch", fetcher);
    await expect(voiceProviderRequest("private-key", "/v3/create-web-call", {})).rejects.toThrow("Voice could not connect");
    await expect(voiceProviderRequest("private-key", "/v3/create-web-call", {})).rejects.toMatchObject({ status: 502 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
