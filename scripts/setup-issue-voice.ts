/** Operator-only setup. Never runs from a page, scheduler, or customer connection. */
import { databasePool } from "../src/lib/db";
import { loadRetellConnection } from "../src/lib/retell-repository";
import { ISSUE_VOICE_DURATION_MS, ISSUE_VOICE_GREETING, ISSUE_VOICE_PROMPT } from "../src/lib/issue-voice";
import { verifyIssueVoiceAgent, voiceProviderRequest } from "../src/lib/issue-voice-provider";

async function main() {
  const orgId = process.argv.find((arg) => arg.startsWith("--org="))?.slice(6);
  if (process.argv.includes("--list")) {
    const result = await databasePool().query(`SELECT organization.id,organization.name FROM organizations organization
      JOIN integrations integration ON integration.org_id=organization.id
      JOIN integration_webhook_secrets secret ON secret.org_id=integration.org_id AND secret.integration_id=integration.id
      WHERE integration.id='int_retell' AND integration.connection_state='Connected'`);
    console.log(JSON.stringify(result.rows));
    return;
  }
  if (!orgId || !process.argv.includes("--confirm-create-agent")) throw new Error("An exact --org and --confirm-create-agent are required after account-owner approval.");
  const connection = await loadRetellConnection({ orgId });
  if (!connection) throw new Error("No connected Retell account in this workspace.");
  const apiKey = connection.apiKey;
  const name = `CloseSpan issue voice · local test · ${orgId}`;
  const agents = await voiceProviderRequest(apiKey, "/list-agents") as unknown as Array<{ agent_id: string; agent_name: string }>;
  const existing = agents.find((agent) => agent.agent_name === name);
  if (existing) {
    await verifyIssueVoiceAgent(apiKey, existing.agent_id);
    console.log(JSON.stringify({ agentId: existing.agent_id, orgId, reused: true }));
    return;
  }
  const voices = await voiceProviderRequest(apiKey, "/list-voices") as unknown as Array<{ voice_id: string; language: string }>;
  const voice = voices.find((item) => item.voice_id === "retell-Cimo")
    ?? voices.find((item) => item.language === "English" && item.voice_id.startsWith("11labs-"));
  if (!voice) throw new Error("No suitable English voice was found. Choose a voice before creating an agent.");
  const llm = await voiceProviderRequest(apiKey, "/create-retell-llm", {
    model: "gpt-4.1-mini", model_temperature: 0.2,
    general_prompt: ISSUE_VOICE_PROMPT, begin_message: ISSUE_VOICE_GREETING,
    general_tools: [], states: [], knowledge_base_ids: [],
  });
  if (typeof llm.llm_id !== "string") throw new Error("The provider did not return an LLM ID.");
  // If agent creation fails, show only the created resource ID for recoverable cleanup. Never keys or call data.
  console.log(JSON.stringify({ createdLlmId: llm.llm_id }));
  const agent = await voiceProviderRequest(apiKey, "/create-agent", {
    agent_name: name, response_engine: { type: "retell-llm", llm_id: llm.llm_id },
    voice_id: voice.voice_id, language: "en-US", max_call_duration_ms: ISSUE_VOICE_DURATION_MS,
    end_call_after_silence_ms: 60_000, data_storage_setting: "basic_attributes_only",
    data_storage_retention_days: 1, webhook_events: [],
  });
  if (typeof agent.agent_id !== "string") throw new Error("The provider did not return an agent ID.");
  await verifyIssueVoiceAgent(apiKey, agent.agent_id);
  console.log(JSON.stringify({ agentId: agent.agent_id, orgId, verified: true, callsStarted: 0 }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Voice setup failed."); process.exitCode = 1; })
  .finally(async () => { if (process.env.DATABASE_URL) await databasePool().end(); });
