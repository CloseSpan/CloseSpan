import { createHash } from "node:crypto";
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

const CLOSESPAN_MANAGED_WORKFLOW_MARKER =
  "# Managed by CloseSpan. Updates are proposed through an audited setup pull request.";
const LEGACY_MANAGED_WORKFLOW_HASHES: Record<string, ReadonlySet<string>> = {
  [TENKI_RUNNER_WORKFLOW_PATH]: new Set([
    "64df8335116608ec48d60cf2f78886e198e993438dfb4883eddf0eecdb4d1aee",
    "52a44d5eeb1c6e966afa68459c99664b7dcb0811c2bac2f6732a8fe541e6bb0c",
  ]),
  [TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH]: new Set([
    "5db57dabd86398c651979200be022bf57bc3c42e050d9713474f5f54cb820bdd",
    "4405e8ae76096d2b6ad760a1c7bff08f2f39f9ca001d0389c241ca48fbde865a",
    "c100263ea380781332e3a3484b6b0023d0778404d8db4885c6535f08480345da",
    "39db0fe149dfbea791b15385854b3731a213f198ffca1a8ef0048fe9a8d2ea1b",
    "b44a4974652ab00f2cd7f75682e3490ec9c310b26cbbfb4105953976d394f9c9",
    "5811fd935cc15266fddf5fa7f992022584943bd8af93e7c6051e1d554535bce2",
    "b5556ed9037bceb5d65b7b6f98367dfb72947f37672795a297150317a8c71e47",
  ]),
  [TENKI_RUNNER_SIZING_WORKFLOW_PATH]: new Set([
    "dfbef42dad3fd2dd16fb4211b661dd14af633764394513fde1062e5e834a9c5f",
  ]),
};

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

interface RepositoryFileState {
  content: string;
  sha: string;
}

async function repositoryFileState(
  github: Octokit,
  repository: { owner: string; repo: string },
  ref: string,
  path = TENKI_RUNNER_WORKFLOW_PATH,
): Promise<RepositoryFileState | null> {
  try {
    const response = await github.rest.repos.getContent({
      ...repository,
      path,
      ref,
    });
    if (
      !response.data
      || Array.isArray(response.data)
      || !("sha" in response.data)
      || typeof response.data.sha !== "string"
    ) {
      throw new HttpError(409, "The CloseSpan runner workflow is missing its GitHub blob identity");
    }
    return { content: decodedGithubFile(response.data), sha: response.data.sha };
  } catch (error) {
    if (githubStatus(error) === 404) return null;
    throw error;
  }
}

async function repositoryFile(
  github: Octokit,
  repository: { owner: string; repo: string },
  ref: string,
  path = TENKI_RUNNER_WORKFLOW_PATH,
): Promise<string | null> {
  return (await repositoryFileState(github, repository, ref, path))?.content ?? null;
}

function isCloseSpanManagedWorkflow(path: string, content: string): boolean {
  if (content.startsWith(`${CLOSESPAN_MANAGED_WORKFLOW_MARKER}\n`)) return true;
  const hash = createHash("sha256").update(content, "utf8").digest("hex");
  return LEGACY_MANAGED_WORKFLOW_HASHES[path]?.has(hash) ?? false;
}

async function setupBranch(
  github: Octokit,
  repository: { owner: string; repo: string },
  baseSha: string,
  resetExisting: boolean,
): Promise<void> {
  try {
    const current = await github.rest.git.getRef({
      ...repository,
      ref: `heads/${TENKI_RUNNER_SETUP_BRANCH}`,
    });
    if (resetExisting && current.data.object.sha !== baseSha) {
      await github.rest.git.updateRef({
        ...repository,
        ref: `heads/${TENKI_RUNNER_SETUP_BRANCH}`,
        sha: baseSha,
        force: true,
      });
    }
  } catch (error) {
    if (githubStatus(error) !== 404) throw error;
    await github.rest.git.createRef({
      ...repository,
      ref: `refs/heads/${TENKI_RUNNER_SETUP_BRANCH}`,
      sha: baseSha,
    });
  }
}

async function openSetupPullRequest(
  github: Octokit,
  repository: { owner: string; repo: string },
  defaultBranch: string,
): Promise<{ number: number; html_url: string } | null> {
  const existing = await github.rest.pulls.list({
    ...repository,
    state: "open",
    head: `${repository.owner}:${TENKI_RUNNER_SETUP_BRANCH}`,
    base: defaultBranch,
    per_page: 10,
  });
  return existing.data[0] ?? null;
}

async function setupPullRequest(
  github: Octokit,
  repository: { owner: string; repo: string },
  defaultBranch: string,
  existing: { number: number; html_url: string } | null,
): Promise<{ number: number; url: string }> {
  const pull = existing ?? (await github.rest.pulls.create({
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

export interface CurrentTenkiRuntimeVerifierWorkflow {
  status: "current" | "updated";
  baseSha: string;
  workflowHash: string;
}

/**
 * Keep CloseSpan's runtime verifier current before pinning a verification run.
 *
 * Runtime verification must not dispatch an older validation contract after
 * CloseSpan deploys a reviewed verifier update. The update is intentionally
 * limited to the marked CloseSpan-managed runtime workflow; repository-owned
 * workflow content continues to fail closed for manual review.
 */
export async function ensureCurrentTenkiRuntimeVerifierWorkflow(
  input: {
    installationId: string;
    repository: string;
    defaultBranch: string;
    expectedWorkflowHash: string;
  },
  dependencies: {
    createClient?: (installationId: string) => Promise<Octokit> | Octokit;
    runtimeTemplate?: string;
  } = {},
): Promise<CurrentTenkiRuntimeVerifierWorkflow> {
  const repository = repositoryParts(input.repository);
  const github = dependencies.createClient
    ? await dependencies.createClient(input.installationId)
    : await createGithubInstallationClient(input.installationId);
  const runtimeTemplate = dependencies.runtimeTemplate
    ?? await tenkiRuntimeVerifierWorkflowTemplate();
  const workflowHash = createHash("sha256")
    .update(runtimeTemplate, "utf8")
    .digest("hex");
  if (workflowHash !== input.expectedWorkflowHash) {
    throw new HttpError(409, "CloseSpan's runtime verifier identity changed before repository synchronization");
  }

  const currentState = async () => {
    const ref = await github.rest.git.getRef({
      ...repository,
      ref: `heads/${input.defaultBranch}`,
    });
    const workflow = await repositoryFileState(
      github,
      repository,
      ref.data.object.sha,
      TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH,
    );
    return { baseSha: ref.data.object.sha, workflow };
  };

  let current = await currentState();
  if (!current.workflow) {
    throw new HttpError(409, "The CloseSpan runtime verifier workflow is not installed");
  }
  if (current.workflow.content === runtimeTemplate) {
    return { status: "current", baseSha: current.baseSha, workflowHash };
  }
  if (!isCloseSpanManagedWorkflow(
    TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH,
    current.workflow.content,
  )) {
    throw new HttpError(
      409,
      `A repository-owned workflow exists at ${TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH}; review it manually before running verification`,
    );
  }

  try {
    await github.rest.repos.createOrUpdateFileContents({
      ...repository,
      path: TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH,
      message: "chore(closespan): update current-issue runtime verifier",
      content: Buffer.from(runtimeTemplate, "utf8").toString("base64"),
      branch: input.defaultBranch,
      sha: current.workflow.sha,
    });
  } catch (error) {
    // A concurrent retry may have completed the same managed update. Accept
    // that exact reviewed result, but preserve every other GitHub failure.
    if (githubStatus(error) !== 409 && githubStatus(error) !== 422) throw error;
    current = await currentState();
    if (current.workflow?.content !== runtimeTemplate) throw error;
    return { status: "current", baseSha: current.baseSha, workflowHash };
  }

  current = await currentState();
  if (current.workflow?.content !== runtimeTemplate) {
    throw new HttpError(409, "GitHub did not install CloseSpan's reviewed runtime verifier");
  }
  return { status: "updated", baseSha: current.baseSha, workflowHash };
}

/**
 * Install or update the reviewed workflow without overwriting repository-owned content.
 *
 * An absent workflow is proposed on a stable CloseSpan setup branch. An exact
 * workflow already present on the default branch is accepted idempotently. A
 * marked or exact legacy CloseSpan-managed revision is upgraded through the
 * same audited PR flow. Any other content fails closed for manual review.
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
    if (actual !== null && actual !== expected && !isCloseSpanManagedWorkflow(path, actual)) {
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

  const existingPullRequest = await openSetupPullRequest(
    github,
    repository,
    input.defaultBranch,
  );
  await setupBranch(
    github,
    repository,
    baseRef.data.object.sha,
    existingPullRequest === null,
  );
  const proposedWorkflowState = await repositoryFileState(
    github,
    repository,
    TENKI_RUNNER_SETUP_BRANCH,
  );
  const proposedRuntimeWorkflowState = await repositoryFileState(
    github,
    repository,
    TENKI_RUNNER_SETUP_BRANCH,
    TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH,
  );
  const proposedSizingWorkflowState = await repositoryFileState(
    github,
    repository,
    TENKI_RUNNER_SETUP_BRANCH,
    TENKI_RUNNER_SIZING_WORKFLOW_PATH,
  );
  const updates = [
    [TENKI_RUNNER_WORKFLOW_PATH, proposedWorkflowState, template, "chore(closespan): update approval-bound agent runner"],
    [TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH, proposedRuntimeWorkflowState, runtimeTemplate, "chore(closespan): update current-issue runtime verifier"],
    [TENKI_RUNNER_SIZING_WORKFLOW_PATH, proposedSizingWorkflowState, sizingTemplate, "chore(closespan): update adaptive runner sizing probe"],
  ] as const;
  for (const [path, state, expected, message] of updates) {
    if (state?.content === expected) continue;
    if (state && !isCloseSpanManagedWorkflow(path, state.content)) {
      throw new HttpError(
        409,
        `The ${TENKI_RUNNER_SETUP_BRANCH} branch contains a different workflow at ${path}; review it manually before retrying`,
      );
    }
    await github.rest.repos.createOrUpdateFileContents({
      ...repository,
      path,
      message,
      content: Buffer.from(expected, "utf8").toString("base64"),
      branch: TENKI_RUNNER_SETUP_BRANCH,
      ...(state ? { sha: state.sha } : {}),
    });
  }
  const pullRequest = await setupPullRequest(
    github,
    repository,
    input.defaultBranch,
    existingPullRequest,
  );
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
    if (actual !== null && actual !== expected && !isCloseSpanManagedWorkflow(path, actual)) {
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
    ...(defaultWorkflow !== template ? [TENKI_RUNNER_WORKFLOW_PATH] : []),
    ...(defaultRuntimeWorkflow !== runtimeTemplate ? [TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH] : []),
    ...(defaultSizingWorkflow !== sizingTemplate ? [TENKI_RUNNER_SIZING_WORKFLOW_PATH] : []),
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
    || files.data.some((file) => {
      if (!expectedFiles.includes(file.filename)) return true;
      const existing = file.filename === TENKI_RUNNER_WORKFLOW_PATH
        ? defaultWorkflow
        : file.filename === TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH
          ? defaultRuntimeWorkflow
          : defaultSizingWorkflow;
      return file.status !== (existing === null ? "added" : "modified");
    })
  ) {
    throw new HttpError(409, "The runner setup pull request may only install or update CloseSpan's reviewed workflows");
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
