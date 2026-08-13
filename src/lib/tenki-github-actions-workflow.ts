import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Octokit } from "@octokit/rest";
import { createGithubInstallationClient } from "./github-app-auth";
import { HttpError } from "./request-security";

export const TENKI_RUNNER_WORKFLOW_PATH =
  ".github/workflows/closespan-agent-runner.yml";
export const TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH =
  ".github/workflows/closespan-runtime-verifier.yml";
export const TENKI_RUNNER_SIZING_WORKFLOW_PATH =
  ".github/workflows/closespan-runner-sizing.yml";
export const TENKI_RUNNER_SETUP_BRANCH = "closespan/setup-agent-runner";

const TEMPLATE_PATH = "templates/tenki-github-actions/closespan-agent-runner.yml";
const RUNTIME_TEMPLATE_PATH =
  "templates/tenki-github-actions/closespan-runtime-verifier.yml";
const SIZING_TEMPLATE_PATH =
  "templates/tenki-github-actions/closespan-runner-sizing.yml";

function repositoryParts(repository: string): { owner: string; repo: string } {
  const [owner, repo, extra] = repository.split("/");
  if (!owner || !repo || extra) {
    throw new HttpError(400, "Repository must use owner/name format");
  }
  return { owner, repo };
}

function githubStatus(error: unknown): number | null {
  return error && typeof error === "object" && "status" in error
    && typeof error.status === "number"
    ? error.status
    : null;
}

function decodedGithubFile(data: unknown): string {
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
    throw new HttpError(409, "The CloseSpan runner workflow is not a readable repository file");
  }
  return Buffer.from(data.content.replaceAll("\n", ""), "base64").toString("utf8");
}

async function repositoryFile(
  github: Octokit,
  repository: { owner: string; repo: string },
  ref: string,
  path = TENKI_RUNNER_WORKFLOW_PATH,
): Promise<string | null> {
  try {
    const response = await github.rest.repos.getContent({
      ...repository,
      path,
      ref,
    });
    return decodedGithubFile(response.data);
  } catch (error) {
    if (githubStatus(error) === 404) return null;
    throw error;
  }
}

async function setupBranch(
  github: Octokit,
  repository: { owner: string; repo: string },
  baseSha: string,
): Promise<void> {
  try {
    await github.rest.git.getRef({
      ...repository,
      ref: `heads/${TENKI_RUNNER_SETUP_BRANCH}`,
    });
  } catch (error) {
    if (githubStatus(error) !== 404) throw error;
    await github.rest.git.createRef({
      ...repository,
      ref: `refs/heads/${TENKI_RUNNER_SETUP_BRANCH}`,
      sha: baseSha,
    });
  }
}

async function setupPullRequest(
  github: Octokit,
  repository: { owner: string; repo: string },
  defaultBranch: string,
): Promise<{ number: number; url: string }> {
  const existing = await github.rest.pulls.list({
    ...repository,
    state: "open",
    head: `${repository.owner}:${TENKI_RUNNER_SETUP_BRANCH}`,
    base: defaultBranch,
    per_page: 10,
  });
  const pull = existing.data[0] ?? (await github.rest.pulls.create({
    ...repository,
    title: "chore(closespan): install approval-bound agent runner",
    head: TENKI_RUNNER_SETUP_BRANCH,
    base: defaultBranch,
    body: [
      "## CloseSpan runner setup",
      "",
      "Installs the reviewed GitHub Actions workflows used for CloseSpan implementation, current-issue runtime verification, and runner sizing on the repository's detected Tenki platform runner.",
      "",
      "- Lightweight bootstrap and callback jobs use Tenki's documented small Linux runner (`tenki-standard-small-2c-4g`).",
      "- iOS jobs remain on the configured Tenki macOS/Xcode label.",
      "- The workflow is hashed into the execution profile and checked again before every dispatch.",
      "- A bounded onboarding probe measures duration, CPU saturation, and memory pressure before execution is enabled.",
      "- The workflow cannot merge, deploy, or push implementation changes.",
    ].join("\n"),
  })).data;
  return { number: pull.number, url: pull.html_url };
}

export async function tenkiRunnerWorkflowTemplate(): Promise<string> {
  return readFile(resolve(process.cwd(), TEMPLATE_PATH), "utf8");
}

export async function tenkiRuntimeVerifierWorkflowTemplate(): Promise<string> {
  return readFile(resolve(process.cwd(), RUNTIME_TEMPLATE_PATH), "utf8");
}

export async function tenkiRunnerSizingWorkflowTemplate(): Promise<string> {
  return readFile(resolve(process.cwd(), SIZING_TEMPLATE_PATH), "utf8");
}

export interface TenkiRunnerWorkflowInstallation {
  status: "installed" | "pull_request";
  workflowPath: string;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
}

export interface InstallTenkiRunnerWorkflowDependencies {
  createClient?: (installationId: string) => Promise<Octokit> | Octokit;
  template?: string;
  runtimeTemplate?: string;
  sizingTemplate?: string;
}

export interface ApproveTenkiRunnerWorkflowDependencies {
  createClient?: (installationId: string) => Promise<Octokit> | Octokit;
  template?: string;
  runtimeTemplate?: string;
  sizingTemplate?: string;
}

export interface TenkiRunnerWorkflowMergeResult {
  status: "merged" | "installed";
  workflowPath: string;
  pullRequestNumber: number;
  pullRequestUrl: string | null;
  mergedSha: string;
  githubActionsChecksPassed: number;
}

/**
 * Install the reviewed workflow without overwriting repository-owned content.
 *
 * An absent workflow is proposed on a stable CloseSpan setup branch. An exact
 * workflow already present on the default branch is accepted idempotently. Any
 * other content at the reserved path fails closed for manual review.
 */
export async function installTenkiRunnerWorkflow(
  input: {
    installationId: string;
    repository: string;
    defaultBranch: string;
  },
  dependencies: InstallTenkiRunnerWorkflowDependencies = {},
): Promise<TenkiRunnerWorkflowInstallation> {
  const repository = repositoryParts(input.repository);
  const github = dependencies.createClient
    ? await dependencies.createClient(input.installationId)
    : await createGithubInstallationClient(input.installationId);
  const template = dependencies.template ?? await tenkiRunnerWorkflowTemplate();
  const runtimeTemplate = dependencies.runtimeTemplate
    ?? await tenkiRuntimeVerifierWorkflowTemplate();
  const sizingTemplate = dependencies.sizingTemplate
    ?? await tenkiRunnerSizingWorkflowTemplate();
  const baseRef = await github.rest.git.getRef({
    ...repository,
    ref: `heads/${input.defaultBranch}`,
  });
  const defaultWorkflow = await repositoryFile(
    github,
    repository,
    baseRef.data.object.sha,
  );
  const defaultRuntimeWorkflow = await repositoryFile(
    github,
    repository,
    baseRef.data.object.sha,
    TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH,
  );
  const defaultSizingWorkflow = await repositoryFile(
    github,
    repository,
    baseRef.data.object.sha,
    TENKI_RUNNER_SIZING_WORKFLOW_PATH,
  );
  for (const [path, actual, expected] of [
    [TENKI_RUNNER_WORKFLOW_PATH, defaultWorkflow, template],
    [TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH, defaultRuntimeWorkflow, runtimeTemplate],
    [TENKI_RUNNER_SIZING_WORKFLOW_PATH, defaultSizingWorkflow, sizingTemplate],
  ] as const) {
    if (actual !== null && actual !== expected) {
      throw new HttpError(
        409,
        `A different workflow already exists at ${path}; review it manually before enabling Tenki execution`,
      );
    }
  }
  if (
    defaultWorkflow === template
    && defaultRuntimeWorkflow === runtimeTemplate
    && defaultSizingWorkflow === sizingTemplate
  ) {
    return {
      status: "installed",
      workflowPath: TENKI_RUNNER_WORKFLOW_PATH,
      pullRequestNumber: null,
      pullRequestUrl: null,
    };
  }

  await setupBranch(github, repository, baseRef.data.object.sha);
  const proposedWorkflow = await repositoryFile(
    github,
    repository,
    TENKI_RUNNER_SETUP_BRANCH,
  );
  const proposedRuntimeWorkflow = await repositoryFile(
    github,
    repository,
    TENKI_RUNNER_SETUP_BRANCH,
    TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH,
  );
  const proposedSizingWorkflow = await repositoryFile(
    github,
    repository,
    TENKI_RUNNER_SETUP_BRANCH,
    TENKI_RUNNER_SIZING_WORKFLOW_PATH,
  );
  if (proposedWorkflow !== null && proposedWorkflow !== template) {
    throw new HttpError(
      409,
      `The ${TENKI_RUNNER_SETUP_BRANCH} branch contains a different runner workflow; review it manually before retrying`,
    );
  }
  if (proposedWorkflow === null) {
    await github.rest.repos.createOrUpdateFileContents({
      ...repository,
      path: TENKI_RUNNER_WORKFLOW_PATH,
      message: "chore(closespan): install approval-bound agent runner",
      content: Buffer.from(template, "utf8").toString("base64"),
      branch: TENKI_RUNNER_SETUP_BRANCH,
    });
  }
  if (proposedRuntimeWorkflow !== null && proposedRuntimeWorkflow !== runtimeTemplate) {
    throw new HttpError(
      409,
      `The ${TENKI_RUNNER_SETUP_BRANCH} branch contains a different runtime verifier; review it manually before retrying`,
    );
  }
  if (proposedRuntimeWorkflow === null) {
    await github.rest.repos.createOrUpdateFileContents({
      ...repository,
      path: TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH,
      message: "chore(closespan): install current-issue runtime verifier",
      content: Buffer.from(runtimeTemplate, "utf8").toString("base64"),
      branch: TENKI_RUNNER_SETUP_BRANCH,
    });
  }
  if (proposedSizingWorkflow !== null && proposedSizingWorkflow !== sizingTemplate) {
    throw new HttpError(
      409,
      `The ${TENKI_RUNNER_SETUP_BRANCH} branch contains a different runner sizing workflow; review it manually before retrying`,
    );
  }
  if (proposedSizingWorkflow === null) {
    await github.rest.repos.createOrUpdateFileContents({
      ...repository,
      path: TENKI_RUNNER_SIZING_WORKFLOW_PATH,
      message: "chore(closespan): install adaptive runner sizing probe",
      content: Buffer.from(sizingTemplate, "utf8").toString("base64"),
      branch: TENKI_RUNNER_SETUP_BRANCH,
    });
  }
  const pullRequest = await setupPullRequest(github, repository, input.defaultBranch);
  return {
    status: "pull_request",
    workflowPath: TENKI_RUNNER_WORKFLOW_PATH,
    pullRequestNumber: pullRequest.number,
    pullRequestUrl: pullRequest.url,
  };
}

function latestWorkflowRuns<T extends {
  id: number;
  workflow_id: number;
  status: string | null;
  conclusion: string | null;
  name?: string | null;
}>(runs: T[]): T[] {
  const latest = new Map<number, T>();
  for (const run of runs) {
    const current = latest.get(run.workflow_id);
    if (!current || run.id > current.id) latest.set(run.workflow_id, run);
  }
  return [...latest.values()];
}

/**
 * Merge only the setup PR created by installTenkiRunnerWorkflow.
 *
 * The exact head commit is revalidated immediately before merge. The PR may
 * add only CloseSpan's immutable runner workflow, and every GitHub Actions run
 * reported for that head commit must be complete and successful. Repositories
 * without Actions runs still receive the same deterministic content, scope,
 * branch, and head-SHA checks before GitHub enforces its branch protections.
 */
export async function approveAndMergeTenkiRunnerWorkflow(
  input: {
    installationId: string;
    repository: string;
    defaultBranch: string;
    pullRequestNumber: number;
  },
  dependencies: ApproveTenkiRunnerWorkflowDependencies = {},
): Promise<TenkiRunnerWorkflowMergeResult> {
  const repository = repositoryParts(input.repository);
  const github = dependencies.createClient
    ? await dependencies.createClient(input.installationId)
    : await createGithubInstallationClient(input.installationId);
  const template = dependencies.template ?? await tenkiRunnerWorkflowTemplate();
  const runtimeTemplate = dependencies.runtimeTemplate
    ?? await tenkiRuntimeVerifierWorkflowTemplate();
  const sizingTemplate = dependencies.sizingTemplate
    ?? await tenkiRunnerSizingWorkflowTemplate();
  const baseRef = await github.rest.git.getRef({
    ...repository,
    ref: `heads/${input.defaultBranch}`,
  });
  const defaultWorkflow = await repositoryFile(
    github,
    repository,
    baseRef.data.object.sha,
  );
  const defaultRuntimeWorkflow = await repositoryFile(
    github,
    repository,
    baseRef.data.object.sha,
    TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH,
  );
  const defaultSizingWorkflow = await repositoryFile(
    github,
    repository,
    baseRef.data.object.sha,
    TENKI_RUNNER_SIZING_WORKFLOW_PATH,
  );
  for (const [path, actual, expected] of [
    [TENKI_RUNNER_WORKFLOW_PATH, defaultWorkflow, template],
    [TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH, defaultRuntimeWorkflow, runtimeTemplate],
    [TENKI_RUNNER_SIZING_WORKFLOW_PATH, defaultSizingWorkflow, sizingTemplate],
  ] as const) {
    if (actual !== null && actual !== expected) {
      throw new HttpError(
        409,
        `A different workflow already exists at ${path}; CloseSpan will not overwrite it`,
      );
    }
  }
  if (
    defaultWorkflow === template
    && defaultRuntimeWorkflow === runtimeTemplate
    && defaultSizingWorkflow === sizingTemplate
  ) {
    const installedPull = await github.rest.pulls.get({
      ...repository,
      pull_number: input.pullRequestNumber,
    });
    if (
      installedPull.data.base.ref !== input.defaultBranch
      || installedPull.data.head.ref !== TENKI_RUNNER_SETUP_BRANCH
      || installedPull.data.head.repo?.full_name !== input.repository
    ) {
      throw new HttpError(409, "The approved runner setup pull request does not match the installed workflow");
    }
    return {
      status: "installed",
      workflowPath: TENKI_RUNNER_WORKFLOW_PATH,
      pullRequestNumber: input.pullRequestNumber,
      pullRequestUrl: installedPull.data.html_url,
      mergedSha: installedPull.data.merged && installedPull.data.merge_commit_sha
        ? installedPull.data.merge_commit_sha
        : baseRef.data.object.sha,
      githubActionsChecksPassed: 0,
    };
  }

  const pull = await github.rest.pulls.get({
    ...repository,
    pull_number: input.pullRequestNumber,
  });
  if (pull.data.state !== "open") {
    throw new HttpError(409, "The runner setup pull request is no longer open");
  }
  if (pull.data.draft) {
    throw new HttpError(409, "The runner setup pull request is still a draft; prepare it again");
  }
  if (pull.data.base.ref !== input.defaultBranch) {
    throw new HttpError(409, "The runner setup pull request target branch changed; prepare it again");
  }
  if (
    pull.data.head.ref !== TENKI_RUNNER_SETUP_BRANCH
    || pull.data.head.repo?.full_name !== input.repository
  ) {
    throw new HttpError(409, "The runner setup pull request source changed; review it in GitHub");
  }
  const expectedFiles = [
    ...(defaultWorkflow === null ? [TENKI_RUNNER_WORKFLOW_PATH] : []),
    ...(defaultRuntimeWorkflow === null ? [TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH] : []),
    ...(defaultSizingWorkflow === null ? [TENKI_RUNNER_SIZING_WORKFLOW_PATH] : []),
  ];
  if (pull.data.changed_files !== expectedFiles.length) {
    throw new HttpError(409, "The runner setup pull request contains unexpected file changes");
  }
  const files = await github.rest.pulls.listFiles({
    ...repository,
    pull_number: input.pullRequestNumber,
    per_page: 100,
  });
  if (
    files.data.length !== expectedFiles.length
    || files.data.some((file) => !expectedFiles.includes(file.filename) || file.status !== "added")
  ) {
    throw new HttpError(409, "The runner setup pull request may only add CloseSpan's reviewed workflows");
  }
  const headSha = pull.data.head.sha;
  const proposedWorkflow = await repositoryFile(github, repository, headSha);
  if (proposedWorkflow !== template) {
    throw new HttpError(409, "The runner setup workflow changed after CloseSpan prepared it");
  }
  const proposedRuntimeWorkflow = await repositoryFile(
    github,
    repository,
    headSha,
    TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH,
  );
  if (proposedRuntimeWorkflow !== runtimeTemplate) {
    throw new HttpError(409, "The runtime verifier changed after CloseSpan prepared it");
  }
  const proposedSizingWorkflow = await repositoryFile(
    github,
    repository,
    headSha,
    TENKI_RUNNER_SIZING_WORKFLOW_PATH,
  );
  if (proposedSizingWorkflow !== sizingTemplate) {
    throw new HttpError(409, "The runner sizing workflow changed after CloseSpan prepared it");
  }

  const runsResponse = await github.rest.actions.listWorkflowRunsForRepo({
    ...repository,
    head_sha: headSha,
    per_page: 100,
  });
  const runs = latestWorkflowRuns(runsResponse.data.workflow_runs);
  const pending = runs.filter((run) => run.status !== "completed");
  if (pending.length > 0) {
    throw new HttpError(
      409,
      `Wait for GitHub Actions to finish: ${pending.map((run) => run.name).join(", ")}`,
    );
  }
  const acceptedConclusions = new Set(["success", "neutral", "skipped"]);
  const failed = runs.filter(
    (run) => !run.conclusion || !acceptedConclusions.has(run.conclusion),
  );
  if (failed.length > 0) {
    throw new HttpError(
      409,
      `Resolve the failing GitHub Actions checks first: ${failed.map((run) => run.name).join(", ")}`,
    );
  }

  const merged = await github.rest.pulls.merge({
    ...repository,
    pull_number: input.pullRequestNumber,
    sha: headSha,
    merge_method: "squash",
  });
  if (!merged.data.merged || !merged.data.sha) {
    throw new HttpError(
      409,
      merged.data.message || "GitHub did not merge the runner setup pull request",
    );
  }
  return {
    status: "merged",
    workflowPath: TENKI_RUNNER_WORKFLOW_PATH,
    pullRequestNumber: input.pullRequestNumber,
    pullRequestUrl: pull.data.html_url,
    mergedSha: merged.data.sha,
    githubActionsChecksPassed: runs.length,
  };
}
