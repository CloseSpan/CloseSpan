import { createHmac } from "node:crypto";
import {
  createRepositoryArchiveUrl,
} from "./github-agent-publisher";
import type { AgentRunExecutionContext } from "./engineering-workflow-repository";

function configuration(): { url: string; secret: string; callbackBaseUrl: string } | null {
  const url = process.env.AGENT_EXECUTOR_URL?.trim().replace(/\/$/, "");
  const secret = process.env.AGENT_EXECUTOR_SHARED_SECRET?.trim();
  const callbackBaseUrl = process.env.CLOSESPAN_INTERNAL_BASE_URL?.trim().replace(/\/$/, "");
  if (!url || !secret || !callbackBaseUrl) return null;
  return { url, secret, callbackBaseUrl };
}

export function assertAgentExecutorConfigured(): void {
  if (!configuration())
    throw new Error("AGENT_EXECUTOR_URL, AGENT_EXECUTOR_SHARED_SECRET, and CLOSESPAN_INTERNAL_BASE_URL are required for live coding runs");
}

export async function dispatchAgentRun(context: AgentRunExecutionContext): Promise<void> {
  const config = configuration();
  if (!config) {
    if (process.env.APP_MODE === "production") assertAgentExecutorConfigured();
    return;
  }
  const archiveUrl = await createRepositoryArchiveUrl(context);
  const generatedTests = context.generatedTests ?? [];
  const pddCommands = generatedTests.map((test) => test.command);
  const body = JSON.stringify({
    schemaVersion: 1,
    orgId: context.orgId,
    runId: context.runId,
    repository: context.repository,
    baseSha: context.baseSha.toLowerCase(),
    promptHash: context.promptHash,
    promptContent: context.promptContent,
    promptArtifactPath: context.promptArtifactPath,
    repositoryArchiveUrl: archiveUrl,
    requiredCommands: [...new Set([...context.promptSnapshot.ticket.requiredCommands, ...pddCommands])],
    permittedPaths: context.promptSnapshot.ticket.permittedPaths,
    generatedTests,
    acceptanceCriteria: context.promptSnapshot.ticket.acceptanceCriteria.map((criterion) => ({
      id: criterion.id,
      scenarioIds: context.promptSnapshot.ticket.testScenarios
        .filter((scenario) => scenario.criterionIds.includes(criterion.id))
        .map((scenario) => scenario.id),
    })),
    testScenarios: context.promptSnapshot.ticket.testScenarios.map((scenario) => ({
      id: scenario.id,
      testLevel: scenario.testLevel,
      criterionIds: scenario.criterionIds,
    })),
    expiresAt: context.expiresAt,
    capabilities: context.allowedCapabilities,
    callbackUrl: `${config.callbackBaseUrl}/api/internal/agent-runs/${context.runId}`,
  });
  const signature = createHmac("sha256", config.secret).update(body).digest("hex");
  const response = await fetch(`${config.url}/runs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-closespan-signature": signature,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Agent executor rejected the run with HTTP ${response.status}`);
}
