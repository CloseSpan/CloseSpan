import { HttpError } from "./request-security";
import { ISSUE_VOICE_DURATION_MS, ISSUE_VOICE_GREETING, ISSUE_VOICE_PROMPT } from "./issue-voice";

/** Fixed provider host; never accept an arbitrary URL or return a provider error body. */
export async function voiceProviderRequest(apiKey: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`https://api.retellai.com${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000), cache: "no-store", redirect: "error",
    });
  } catch { throw new HttpError(503, "Voice could not connect. You can continue in text."); }
  if (!response.ok) {
    const message = response.status === 402 ? "Voice minutes are unavailable. Ask your administrator to check the Retell account."
      : response.status === 429 ? "Voice is busy. Try again in a moment, or continue in text."
      : "Voice is temporarily unavailable. You can continue in text.";
    throw new HttpError(response.status === 429 ? 429 : 503, message);
  }
  const text = await response.text();
  if (text.length > 250_000) throw new HttpError(502, "The voice service returned an invalid response.");
  try { return text ? JSON.parse(text) : {}; }
  catch { throw new HttpError(502, "The voice service returned an invalid response."); }
}

/** Fail closed if someone adds operational tools or shared knowledge to the service agent. */
export async function verifyIssueVoiceAgent(apiKey: string, agentId: string): Promise<void> {
  const agent = await voiceProviderRequest(apiKey, `/get-agent/${encodeURIComponent(agentId)}`);
  const engine = agent.response_engine as { type?: string; llm_id?: string } | undefined;
  if (engine?.type !== "retell-llm" || !engine.llm_id) throw new HttpError(503, "The CloseSpan voice agent needs administrator setup.");
  const llm = await voiceProviderRequest(apiKey, `/get-retell-llm/${encodeURIComponent(engine.llm_id)}`);
  const empty = (value: unknown) => value == null || (Array.isArray(value) && value.length === 0);
  if (llm.general_prompt !== ISSUE_VOICE_PROMPT || !empty(llm.general_tools) || !empty(llm.states)
    || !empty(llm.knowledge_base_ids) || !empty(llm.mcp_servers)
    || agent.data_storage_setting !== "basic_attributes_only"
    || Number(agent.max_call_duration_ms) > ISSUE_VOICE_DURATION_MS || !Number(agent.max_call_duration_ms)
    || !Array.isArray(agent.webhook_events) || agent.webhook_events.length > 0) {
    throw new HttpError(503, "The CloseSpan voice agent's safety settings have changed. Ask your administrator to check setup.");
  }
}

export function issueVoiceCallBody(agentId: string, evidence: string) {
  return {
    agent_id: agentId,
    retell_llm_dynamic_variables: { issue_context: evidence },
    agent_override: {
      agent: {
        max_call_duration_ms: ISSUE_VOICE_DURATION_MS, end_call_after_silence_ms: 60_000,
        data_storage_setting: "basic_attributes_only", data_storage_retention_days: 1,
        webhook_events: [],
      },
      retell_llm: { begin_message: ISSUE_VOICE_GREETING },
    },
  };
}
