import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Octokit } from "@octokit/rest";
import {
  executionProfileExecutor,
  sanitizeExecutionProfileConfig,
  type ExecutionProfileExecutor,
} from "./execution-profile";
import { createGithubInstallationClient } from "./github-app-auth";
import type { IssueRuntimeVerificationContext } from "./issue-runtime-verification";
import { RUNTIME_VERIFIER_WORKFLOW_NOT_INSTALLED_MESSAGE } from "./runtime-verifier-errors";

const RUN_REF_PREFIX = "closespan/runs";
const DEFAULT_CONTROL_RUNNER_LABEL = "tenki-standard-small-2c-4g";
const RUNNER_LABEL_PATTERN = /^[A-Za-z0-9_.-]{1,120}$/;
export const TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH =
  ".github/workflows/closespan-runtime-verifier.yml";
const TEMPLATE_PATH =
  "templates/tenki-github-actions/closespan-runtime-verifier.yml";

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

export function runtimeVerificationRunnerLabel(
  executor: Extract<ExecutionProfileExecutor, { kind: "tenki_github_actions" }>,
): string {
  const override = executor.platform === "macos"
    ? process.env.RUNTIME_VERIFICATION_MACOS_RUNNER_LABEL?.trim()
    : undefined;
  const requiredXcodeMajor = executor.xcode
    ? Number.parseInt(executor.xcode.version.split(".")[0] || "", 10)
    : Number.NaN;
  const compatibleGithubRunner = executor.platform === "macos"
    && Number.isFinite(requiredXcodeMajor)
    && requiredXcodeMajor >= 26
    ? `macos-${requiredXcodeMajor}`
    : undefined;
  const label = override || compatibleGithubRunner || executor.runnerLabel;
  if (!RUNNER_LABEL_PATTERN.test(label)) {
    throw new Error(
      "RUNTIME_VERIFICATION_MACOS_RUNNER_LABEL must be a valid GitHub Actions runner label",
    );
  }
  return label;
}

function repositoryParts(repository: string): { owner: string; repo: string } {
  const [owner, repo, extra] = repository.split("/");
  if (!owner || !repo || extra) throw new Error("Repository must use owner/name format");
  return { owner, repo };
}

function githubStatus(error: unknown): number | null {
  return error && typeof error === "object" && "status" in error
    && typeof error.status === "number"
    ? error.status
    : null;
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
    throw new Error("The CloseSpan runtime verifier is not a readable repository file");
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
      throw new Error("Existing runtime verification ref does not match the pinned commit");
    }
  } catch (error) {
    if (!(error instanceof Error && "status" in error && error.status === 404)) {
      throw error;
    }
    await github.rest.git.createRef({
      ...repository,
      ref: `refs/heads/${branch}`,
      sha: baseSha,
    });
  }
  return branch;
}

export async function runtimeVerifierWorkflowTemplate(): Promise<string> {
  return readFile(resolve(process.cwd(), TEMPLATE_PATH), "utf8");
}

export async function runtimeVerifierWorkflowHash(): Promise<string> {
  return createHash("sha256")
    .update(await runtimeVerifierWorkflowTemplate())
    .digest("hex");
}

export function buildIssueRuntimeVerificationJob(
  context: IssueRuntimeVerificationContext,
) {
  const config = sanitizeExecutionProfileConfig(
    context.executionProfileSnapshot.config,
  );
  const executor = executionProfileExecutor(config);
  if (executor.kind !== "tenki_github_actions") {
    throw new Error("Runtime verification is not bound to a Tenki GitHub Actions profile");
  }
  const runnerLabel = runtimeVerificationRunnerLabel(executor);
  return {
    schemaVersion: 1 as const,
    kind: "issue_runtime_verification" as const,
    orgId: context.orgId,
    problemId: context.problemId,
    investigationId: context.investigationId,
    runId: context.runId,
    repository: context.repository,
    workspaceRoot: context.workspaceRoot,
    baseSha: context.baseSha.toLowerCase(),
    promptHash: context.promptHash,
    verificationPrompt: context.verificationPrompt,
    executionProfileId: context.executionProfileId,
    executionProfileHash: context.executionProfileHash,
    executionProfileSnapshot: {
      ...context.executionProfileSnapshot,
      config,
    },
    workflowHash: context.workflowHash,
    expiresAt: context.expiresAt,
    runner: {
      label: runnerLabel,
      platform: executor.platform,
      architecture: executor.architecture,
      xcode: executor.xcode,
      androidEmulator: executor.androidEmulator,
    },
  };
}

export interface RuntimeVerificationDispatchDependencies {
  createClient?: (installationId: string) => Promise<Octokit> | Octokit;
  template?: string;
}

export async function dispatchIssueRuntimeVerification(
  context: IssueRuntimeVerificationContext,
  callbackBaseUrl: string,
  dependencies: RuntimeVerificationDispatchDependencies = {},
): Promise<void> {
  if (process.env.TENKI_GITHUB_ACTIONS_ENABLED !== "true") {
    throw new Error("TENKI_GITHUB_ACTIONS_ENABLED=true is required for runtime verification");
  }
  const config = sanitizeExecutionProfileConfig(
    context.executionProfileSnapshot.config,
  );
  const executor = executionProfileExecutor(config);
  if (executor.kind !== "tenki_github_actions") {
    throw new Error("Runtime verification is not bound to a Tenki GitHub Actions profile");
  }
  const runnerLabel = runtimeVerificationRunnerLabel(executor);
  const repository = repositoryParts(context.repository);
  const github = dependencies.createClient
    ? await dependencies.createClient(context.installationId)
    : await createGithubInstallationClient(context.installationId);
  const baseRef = await github.rest.git.getRef({
    ...repository,
    ref: `heads/${context.baseBranch}`,
  });
  if (baseRef.data.object.sha.toLowerCase() !== context.baseSha.toLowerCase()) {
    throw new Error("stale_base: repository branch moved before runtime verification dispatch");
  }
  const workflow = await github.rest.repos.getContent({
    ...repository,
    path: TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH,
    ref: context.baseSha,
  }).catch((error: unknown) => {
    if (githubStatus(error) === 404) {
      throw new Error(RUNTIME_VERIFIER_WORKFLOW_NOT_INSTALLED_MESSAGE);
    }
    throw error;
  });
  const repositoryWorkflowHash = createHash("sha256")
    .update(decodedGithubFile(workflow.data))
    .digest("hex");
  const localTemplateHash = createHash("sha256")
    .update(dependencies.template ?? await runtimeVerifierWorkflowTemplate())
    .digest("hex");
  if (
    repositoryWorkflowHash !== context.workflowHash
    || localTemplateHash !== context.workflowHash
  ) {
    throw new Error(
      "The repository runtime verifier does not match CloseSpan's reviewed workflow",
    );
  }
  const runRef = await ensureImmutableRunRef(
    github,
    repository,
    context.runId,
    context.baseSha,
  );
  await github.rest.actions.createWorkflowDispatch({
    ...repository,
    workflow_id: TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH,
    ref: runRef,
    inputs: {
      closespan_run_id: context.runId,
      closespan_org_id: context.orgId,
      closespan_callback_url: `${callbackBaseUrl}/api/internal/issue-runtime-verifications/${context.runId}`,
      closespan_profile_hash: context.executionProfileHash,
      closespan_workflow_hash: context.workflowHash,
      closespan_control_runner_label: controlRunnerLabel(),
      closespan_runner_label: runnerLabel,
    },
  });
}
