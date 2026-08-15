import type { AgentRunExecutionContext } from "./engineering-workflow-repository";
import {
  executionProfileExecutor,
  sanitizeExecutionProfileConfig,
} from "./execution-profile";
import { githubActionsRunnerLabel } from "./github-actions-runner-label";
import { normalizeSwiftAcceptanceHarnessCommand } from "./swift-acceptance-harness";

/**
 * Produce the secret-free, approval-bound job consumed by the repository's
 * digest-pinned Tenki GitHub Actions workflow.
 */
export function buildTenkiGithubActionsJob(context: AgentRunExecutionContext) {
  const config = sanitizeExecutionProfileConfig(context.executionProfileSnapshot.config);
  const executor = executionProfileExecutor(config);
  if (executor.kind !== "tenki_github_actions") {
    throw new Error("Agent run is not bound to a Tenki GitHub Actions execution profile");
  }
  const generatedTests = (context.generatedTests ?? []).map((test) => ({
    ...test,
    command: normalizeSwiftAcceptanceHarnessCommand(test.command),
  }));
  const selectedRunnerLabel = githubActionsRunnerLabel(executor);
  return {
    schemaVersion: 1 as const,
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
    requiredCommands: [...new Set([
      ...context.promptSnapshot.ticket.requiredCommands.map(
        normalizeSwiftAcceptanceHarnessCommand,
      ),
      ...generatedTests.map((test) => test.command),
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
    runner: {
      label: selectedRunnerLabel,
      platform: executor.platform,
      architecture: executor.architecture,
      xcode: executor.xcode,
      androidEmulator: executor.androidEmulator,
    },
  };
}
