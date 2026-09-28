/** Read-only preflight: no microphone, call creation, inference, or workflow execution. */
import { databasePool } from "../src/lib/db";
import { issueVoiceCredentials, prepareVoiceEvidence } from "../src/lib/issue-voice-repository";
import { verifyIssueVoiceAgent } from "../src/lib/issue-voice-provider";
import { readIssueConversation } from "../src/lib/issue-conversation-repository";
import { getAiRuntimeConfiguration } from "../src/lib/ai-config";

async function main() {
  const orgId = process.argv.find((arg) => arg.startsWith("--org="))?.slice(6);
  const problemId = process.argv.find((arg) => arg.startsWith("--issue="))?.slice(8);
  if (!orgId || !problemId) throw new Error("An exact --org and --issue are required.");
  const credentials = await issueVoiceCredentials(orgId);
  await verifyIssueVoiceAgent(credentials.apiKey, credentials.agentId);
  const [context, chat, ai] = await Promise.all([
    prepareVoiceEvidence(orgId, problemId), readIssueConversation(orgId, problemId), getAiRuntimeConfiguration(orgId),
  ]);
  console.log(JSON.stringify({ agentSafetyVerified: true, chatStorageReady: chat.storageReady,
    textProviderConfigured: Boolean(ai.apiKey), evidenceCharacters: context.evidence.length,
    availableLinks: context.links.length, callsStarted: 0 }));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Voice preflight failed."); process.exitCode = 1; })
  .finally(async () => { if (process.env.DATABASE_URL) await databasePool().end(); });
