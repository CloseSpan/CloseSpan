import { createHmac } from "node:crypto";
import {
  createRepositoryArchiveUrl,
} from "./github-agent-publisher";
import type { AgentRunExecutionContext } from "./engineering-workflow-repository";
import {
  executionProfileExecutor,
  sanitizeExecutionProfileConfig,
} from "./execution-profile";
import { dispatchTenkiGithubActionsRun } from "./tenki-github-actions-executor";
import { normalizeSwiftAcceptanceHarnessCommand } from "./swift-acceptance-harness";

function callbackConfiguration(): { callbackBaseUrl: string } | null {
  const callbackBaseUrl = process.env.CLOSESPAN_INTERNAL_BASE_URL?.trim().replace(/\/$/, "");
  return callbackBaseUrl ? { callbackBaseUrl } : null;
}

function sandboxConfiguration(): { url: string; secret: string; callbackBaseUrl: string } | null {
  const url = process.env.AGENT_EXECUTOR_URL?.trim().replace(/\/$/, "");
  const secret = process.env.AGENT_EXECUTOR_SHARED_SECRET?.trim();
  const callback = callbackConfiguration();
  if (!url || !secret || !callback) return null;
  return { url, secret, ...callback };
}

export function assertAgentExecutorConfigured(): void {
  if (!callbackConfiguration()) {
    throw new Error("CLOSESPAN_INTERNAL_BASE_URL is required for live coding runs");
  }
  if (!sandboxConfiguration() && process.env.TENKI_GITHUB_ACTIONS_ENABLED !== "true") {
    throw new Error("Configure AGENT_EXECUTOR_URL or enable Tenki GitHub Actions execution");
  }
}

export function agentRunDispatchFailureCode(
  message: string,
  fallback: "dispatch_failed" | "autonomy_dispatch_failed",
): "stale_base" | "dispatch_failed" | "autonomy_dispatch_failed" {
  return message.startsWith("stale_base:") ? "stale_base" : fallback;
}

export async function dispatchAgentRun(context: AgentRunExecutionContext): Promise<void> {
  const callback = callbackConfiguration();
  const profile = sanitizeExecutionProfileConfig(context.executionProfileSnapshot.config);
  if (executionProfileExecutor(profile).kind === "tenki_github_actions") {
    if (!callback) assertAgentExecutorConfigured();
    await dispatchTenkiGithubActionsRun(
      context,
      callback!.callbackBaseUrl,
    );
    return;
  }
  const config = sandboxConfiguration();
  if (!config) {
    if (process.env.APP_MODE === "production") {
      throw new Error("AGENT_EXECUTOR_URL is required for Tenki Sandbox coding runs");
    }
    return;
  }
  const archiveUrl = await createRepositoryArchiveUrl(context);
  const generatedTests = (context.generatedTests ?? []).map((test) => ({
    ...test,
    command: normalizeSwiftAcceptanceHarnessCommand(test.command),
  }));
  const pddCommands = generatedTests.map((test) => test.command);
  const body = JSON.stringify({
    schemaVersion: 2,
    orgId: context.orgId,
    runId: context.runId,
    repository: context.repository,
    baseSha: context.baseSha.toLowerCase(),
    promptHash: context.promptHash,
    promptContent: context.promptContent,
    promptArtifactPath: context.promptArtifactPath,
    executionProfileId: context.executionProfileId,
    executionProfileHash: context.executionProfileHash,
    executionProfileSnapshot: context.executionProfileSnapshot,
    repositoryArchiveUrl: archiveUrl,
    requiredCommands: [...new Set([
      ...context.promptSnapshot.ticket.requiredCommands.map(
        normalizeSwiftAcceptanceHarnessCommand,
      ),
      ...pddCommands,
    ])],
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
    releaseVerification: context.promptSnapshot.ticket.releaseVerification,
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
