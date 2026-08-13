import { createHash } from "node:crypto";
import type { Octokit } from "@octokit/rest";
import type { AgentRunExecutionContext } from "./engineering-workflow-repository";
import {
  assertExecutionProfileReadyForActivation,
  sanitizeExecutionProfileConfig,
} from "./execution-profile";
import { createGithubInstallationClient } from "./github-app-auth";

const RUN_REF_PREFIX = "closespan/runs";
const DEFAULT_CONTROL_RUNNER_LABEL = "tenki-standard-small-2c-4g";
const RUNNER_LABEL_PATTERN = /^[A-Za-z0-9_.-]{1,120}$/;

function controlRunnerLabel(): string {
  const label = process.env.TENKI_CONTROL_RUNNER_LABEL?.trim()
    || DEFAULT_CONTROL_RUNNER_LABEL;
  if (!RUNNER_LABEL_PATTERN.test(label)) {
    throw new Error(
      "TENKI_CONTROL_RUNNER_LABEL must be a valid GitHub Actions runner label",
    );
  }
  return label;
}

function repositoryParts(repository: string): { owner: string; repo: string } {
  const [owner, repo, extra] = repository.split("/");
  if (!owner || !repo || extra) throw new Error("Repository must use owner/name format");
  return { owner, repo };
}

function decodedGithubFile(data: unknown): Buffer {
  if (
    !data
    || typeof data !== "object"
    || Array.isArray(data)
    || !("type" in data)
    || data.type !== "file"
    || !("encoding" in data)
    || data.encoding !== "base64"
    || !("content" in data)
    || typeof data.content !== "string"
  ) {
    throw new Error("The configured Tenki runner workflow is not a readable repository file");
  }
  return Buffer.from(data.content.replaceAll("\n", ""), "base64");
}

async function ensureImmutableRunRef(
  github: Octokit,
  repository: { owner: string; repo: string },
  runId: string,
  baseSha: string,
): Promise<string> {
  const branch = `${RUN_REF_PREFIX}/${runId}`;
  try {
    const existing = await github.rest.git.getRef({
      ...repository,
      ref: `heads/${branch}`,
    });
    if (existing.data.object.sha.toLowerCase() !== baseSha.toLowerCase()) {
      throw new Error("Existing Tenki runner ref does not match the approval-bound commit");
    }
  } catch (error) {
    if (!(error instanceof Error && "status" in error && error.status === 404)) throw error;
    await github.rest.git.createRef({
      ...repository,
      ref: `refs/heads/${branch}`,
      sha: baseSha,
    });
  }
  return branch;
}

export interface TenkiGithubActionsDispatchDependencies {
  createClient?: (installationId: string) => Promise<Octokit> | Octokit;
}

/**
 * Dispatch an approval-bound job onto a Tenki GitHub Actions runner.
 *
 * The repository workflow is hashed into the immutable execution profile.
 * Dispatch uses a dedicated ref fixed to the approved base SHA so neither the
 * workflow definition nor repository contents can move between approval and
 * runner startup.
 */
export async function dispatchTenkiGithubActionsRun(
  context: AgentRunExecutionContext,
  callbackBaseUrl: string,
  dependencies: TenkiGithubActionsDispatchDependencies = {},
): Promise<void> {
  const config = sanitizeExecutionProfileConfig(context.executionProfileSnapshot.config);
  assertExecutionProfileReadyForActivation(config);
  if (
    config.schemaVersion !== 3
    || config.executor.kind !== "tenki_github_actions"
    || !config.executor.workflowSha256
  ) {
    throw new Error("Agent run is not bound to an active Tenki GitHub Actions execution profile");
  }
  if (process.env.TENKI_GITHUB_ACTIONS_ENABLED !== "true") {
    throw new Error("TENKI_GITHUB_ACTIONS_ENABLED=true is required for Tenki runner execution");
  }
  const selectedControlRunnerLabel = controlRunnerLabel();
  const repository = repositoryParts(context.repository);
  const github = dependencies.createClient
    ? await dependencies.createClient(context.installationId)
    : await createGithubInstallationClient(context.installationId);
  const baseRef = await github.rest.git.getRef({
    ...repository,
    ref: `heads/${context.baseBranch}`,
  });
  if (baseRef.data.object.sha.toLowerCase() !== context.baseSha.toLowerCase()) {
    throw new Error("stale_base: repository branch moved after approval");
  }
  const workflow = await github.rest.repos.getContent({
    ...repository,
    path: config.executor.workflowPath,
    ref: context.baseSha,
  });
  const workflowHash = createHash("sha256")
    .update(decodedGithubFile(workflow.data))
    .digest("hex");
  if (workflowHash !== config.executor.workflowSha256) {
    throw new Error("Tenki runner workflow no longer matches the immutable execution profile");
  }
  const runRef = await ensureImmutableRunRef(
    github,
    repository,
    context.runId,
    context.baseSha,
  );
  await github.rest.actions.createWorkflowDispatch({
    ...repository,
    workflow_id: config.executor.workflowPath,
    ref: runRef,
    inputs: {
      closespan_run_id: context.runId,
      closespan_org_id: context.orgId,
      closespan_callback_url: `${callbackBaseUrl}/api/internal/agent-runs/${context.runId}`,
      closespan_profile_hash: context.executionProfileHash,
      closespan_control_runner_label: selectedControlRunnerLabel,
      closespan_runner_label: config.executor.runnerLabel,
    },
  });
}
