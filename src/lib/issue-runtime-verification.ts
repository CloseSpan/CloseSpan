import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { databasePool, transaction } from "./db";
import { getExecutionProfileVersion } from "./execution-profile-repository";
import {
  executionProfileExecutor,
  sanitizeExecutionProfileConfig,
  type ExecutionProfileSnapshot,
} from "./execution-profile";
import { createGithubInstallationClient } from "./github-app-auth";
import { listGithubRepositoryAuthorizations } from "./github-repository-allowlist";
import {
  confirmProblemRepositoryMatch,
  getActiveConfirmedProblemRepositoryMatch,
  ProblemRepositoryMatchError,
  refreshProblemRepositoryMatch,
} from "./problem-repository-match-repository";
import type { ProblemRepositoryMatchView } from "./execution-profile";
import {
  CLOSESPAN_SYSTEM_PATH_PREFIXES,
  searchRepositoryContext,
} from "./repository-context-repository";
import { HttpError } from "./request-security";
import {
  githubRuntimeVerificationFailureMessage,
  runtimeVerificationFailureMessage,
} from "./runtime-verifier-errors";
import { assertTenkiRunnerWorkflowSetupInstalled } from "./tenki-runner-workflow-setup-repository";
import { ensureCurrentTenkiRuntimeVerifierWorkflow } from "./tenki-github-actions-workflow";
import { workspacePersistenceMode } from "./workspace-persistence";
import {
  ISSUE_RUNTIME_VERIFICATION_JOB_TTL_MS,
  ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MESSAGE,
  ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MS,
  ISSUE_RUNTIME_VERIFICATION_RUNNING_TIMEOUT_MESSAGE,
  ISSUE_RUNTIME_VERIFICATION_RUNNING_TIMEOUT_MS,
} from "./issue-runtime-verification-policy";

export {
  ISSUE_RUNTIME_VERIFICATION_JOB_TTL_MS,
  ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MESSAGE,
  ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MS,
  ISSUE_RUNTIME_VERIFICATION_RUNNING_TIMEOUT_MESSAGE,
  ISSUE_RUNTIME_VERIFICATION_RUNNING_TIMEOUT_MS,
} from "./issue-runtime-verification-policy";

export type IssueRuntimeVerificationRunStatus = "Queued" | "Running" | "Completed" | "Failed";
export type IssueRuntimeVerificationOutcome = "Confirmed current" | "Not reproduced" | "Verification blocked";
export type IssueVerificationEvidenceMethod = "Repository analysis" | "Runtime execution";

export interface IssueRuntimeVerificationRunView {
  id: string;
  status: IssueRuntimeVerificationRunStatus;
  outcome: IssueRuntimeVerificationOutcome | null;
  repository: string;
  baseSha: string;
  summary: string | null;
  failureMessage: string | null;
  requestedByName: string;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  workflowRunId: number | null;
}

export interface IssueRuntimeVerificationContext {
  orgId: string;
  problemId: string;
  investigationId: string;
  runId: string;
  repository: string;
  installationId: string;
  workspaceRoot: string;
  baseBranch: string;
  baseSha: string;
  promptHash: string;
  verificationPrompt: string;
  executionProfileId: string;
  executionProfileHash: string;
  executionProfileSnapshot: ExecutionProfileSnapshot;
  workflowHash: string;
  expiresAt: string;
}

interface RuntimeRunRow {
  id: string;
  org_id: string;
  problem_id: string;
  investigation_id: string;
  repository: string;
  installation_id: string;
  workspace_root: string;
  base_branch: string;
  base_sha: string;
  prompt_hash: string;
  verification_prompt: string;
  execution_profile_id: string;
  execution_profile_hash: string;
  execution_profile_snapshot: ExecutionProfileSnapshot;
  workflow_hash: string;
  status: IssueRuntimeVerificationRunStatus;
  outcome: IssueRuntimeVerificationOutcome | null;
  summary: string | null;
  failure_message: string | null;
  workflow_run_id: string | number | null;
  requested_by_name: string;
  requested_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
}

interface RuntimeProblemRow {
  title: string;
  statement: string;
  summary: string;
  investigation_id: string;
  hypothesis: string;
  assumptions: unknown;
  missing_information: unknown;
  recommended_tests: unknown;
  suspected_files: unknown;
}

interface StaleRuntimeRunRow {
  id: string;
  org_id: string;
  investigation_id: string;
  repository: string;
  installation_id: string;
  workflow_run_id: string | number | null;
  status: "Queued" | "Running";
  summary: string;
  requested_at: Date | string;
  started_at: Date | string | null;
}

interface RuntimeVerificationReconciliationDependencies {
  createGithubClient: typeof createGithubInstallationClient;
}

const runtimeVerificationReconciliationDependencies: RuntimeVerificationReconciliationDependencies = {
  createGithubClient: createGithubInstallationClient,
};

interface ActiveRuntimeRunReference {
  id: string;
  orgId: string;
  repository: string;
  installationId: string;
  status: "Queued" | "Running";
  workflowRunId: number | null;
  requestedAt: string;
  startedAt: string | null;
}

type RuntimeReconciliationResult =
  | "none"
  | "runner-assigned"
  | "queued-timeout"
  | "running-timeout";

export const issueRuntimeVerificationReportSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().uuid(),
  baseSha: z.string().regex(/^[a-f0-9]{40}$/),
  verificationMethod: z.enum(["Repository analysis", "Runtime execution"])
    .default("Runtime execution"),
  runtimeRequiredReason: z.string().trim().min(1).max(2_000).nullable().default(null),
  outcome: z.enum(["Confirmed current", "Not reproduced", "Verification blocked"]),
  summary: z.string().trim().min(20).max(4_000),
  expectedBehavior: z.string().trim().min(1).max(4_000),
  actualBehavior: z.string().trim().min(1).max(4_000),
  reproductionSteps: z.array(z.string().trim().min(1).max(2_000)).min(1).max(30),
  commands: z.array(z.object({
    command: z.string().trim().min(1).max(2_000),
    status: z.enum(["passed", "failed", "blocked"]),
    output: z.string().max(20_000),
    durationMs: z.number().int().min(0).max(3_600_000),
  })).max(30),
  observations: z.array(z.string().trim().min(1).max(4_000)).max(50),
  artifacts: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    path: z.string().trim().min(1).max(500),
    kind: z.enum(["screenshot", "log", "test-report"]),
  })).max(30),
  environment: z.object({
    platform: z.string().trim().min(1).max(120),
    runnerLabel: z.string().trim().min(1).max(120),
    xcodeVersion: z.string().trim().min(1).max(120).nullable(),
    simulator: z.string().trim().min(1).max(200).nullable(),
    workflowRunId: z.number().int().positive(),
  }),
});

export type IssueRuntimeVerificationReport = z.infer<typeof issueRuntimeVerificationReportSchema>;

interface RuntimeRepositoryBindingDependencies {
  getActiveMatch: typeof getActiveConfirmedProblemRepositoryMatch;
  refreshMatch: typeof refreshProblemRepositoryMatch;
  confirmMatch: typeof confirmProblemRepositoryMatch;
}

const runtimeRepositoryBindingDependencies: RuntimeRepositoryBindingDependencies = {
  getActiveMatch: getActiveConfirmedProblemRepositoryMatch,
  refreshMatch: refreshProblemRepositoryMatch,
  confirmMatch: confirmProblemRepositoryMatch,
};

/**
 * Reuses an active ticket binding, or confirms a deterministic repository
 * suggestion as part of the user's explicit request to run verification.
 * Ambiguous repository evidence remains human-reviewed in Prompt Testing.
 */
export async function resolveRuntimeVerificationRepositoryBinding(
  input: {
    orgId: string;
    problemId: string;
    actor: { actorId: string; actorName: string; traceId: string };
  },
  dependencies: RuntimeRepositoryBindingDependencies = runtimeRepositoryBindingDependencies,
): Promise<ProblemRepositoryMatchView | null> {
  const active = await dependencies.getActiveMatch(input.orgId, input.problemId);
  if (active) return active;

  const refreshed = await dependencies.refreshMatch(input.orgId, input.problemId);
  if (
    refreshed.resolution.needsReview
    || !refreshed.resolution.selected
    || !refreshed.persistedProfileId
  ) {
    return null;
  }

  try {
    const confirmation = await dependencies.confirmMatch({
      orgId: input.orgId,
      problemId: input.problemId,
      profileId: refreshed.persistedProfileId,
      repository: refreshed.resolution.selected.repository,
      actor: input.actor,
    });
    return confirmation.match;
  } catch (error) {
    if (error instanceof ProblemRepositoryMatchError && error.status === 409) {
      return null;
    }
    throw error;
  }
}

function iso(value: Date | string | null): string | null {
  return value ? (value instanceof Date ? value : new Date(value)).toISOString() : null;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

function runView(row: RuntimeRunRow): IssueRuntimeVerificationRunView {
  const failureMessage = runtimeVerificationFailureMessage(row.failure_message);
  return {
    id: row.id,
    status: row.status,
    outcome: row.outcome,
    repository: row.repository,
    baseSha: row.base_sha,
    summary: row.status === "Failed"
      ? runtimeVerificationFailureMessage(row.summary)
      : row.summary,
    failureMessage,
    requestedByName: row.requested_by_name,
    requestedAt: iso(row.requested_at)!,
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    workflowRunId: row.workflow_run_id === null ? null : Number(row.workflow_run_id),
  };
}

async function findRuntimeVerificationWorkflowRun(
  run: ActiveRuntimeRunReference,
  dependencies: RuntimeVerificationReconciliationDependencies,
) {
  const [owner, repo] = run.repository.split("/");
  if (!owner || !repo) return null;
  const github = await dependencies.createGithubClient(run.installationId);
  if (run.workflowRunId) {
    const response = await github.rest.actions.getWorkflowRun({
      owner,
      repo,
      run_id: run.workflowRunId,
    });
    return { github, owner, repo, workflowRun: response.data };
  }
  const response = await github.rest.actions.listWorkflowRuns({
    owner,
    repo,
    workflow_id: ".github/workflows/closespan-runtime-verifier.yml",
    event: "workflow_dispatch",
    per_page: 30,
  });
  const workflowRun = response.data.workflow_runs.find(
    (candidate) => candidate.display_title === `CloseSpan verification ${run.id}`,
  );
  return workflowRun ? { github, owner, repo, workflowRun } : null;
}

async function requestGithubWorkflowCancellation(input: {
  github: Awaited<ReturnType<typeof createGithubInstallationClient>>;
  owner: string;
  repo: string;
  workflowRunId: number;
  runId: string;
}): Promise<void> {
  try {
    await input.github.rest.actions.cancelWorkflowRun({
      owner: input.owner,
      repo: input.repo,
      run_id: input.workflowRunId,
    });
  } catch (error) {
    console.error("Runtime verification GitHub cancellation failed", {
      runId: input.runId,
      workflowRunId: input.workflowRunId,
      message: error instanceof Error ? error.message : "Unknown cancellation failure",
    });
  }
}

function githubJobHasAssignedRunner(job: {
  runner_id?: number | null;
  runner_name?: string | null;
  status?: string | null;
  steps?: unknown[] | null;
}): boolean {
  return Boolean(
    job.runner_id
    || job.runner_name?.trim()
    || job.status === "in_progress"
    || (job.steps?.length ?? 0) > 0,
  );
}

async function reconcileActiveRuntimeVerification(
  run: ActiveRuntimeRunReference,
  now: Date,
  dependencies: RuntimeVerificationReconciliationDependencies,
): Promise<RuntimeReconciliationResult> {
  const resolved = await findRuntimeVerificationWorkflowRun(run, dependencies);
  const runningSince = new Date(run.startedAt ?? run.requestedAt).getTime();
  const runningTimedOut = run.status === "Running"
    && now.getTime() - runningSince >= ISSUE_RUNTIME_VERIFICATION_RUNNING_TIMEOUT_MS;

  if (runningTimedOut) {
    const workflowRunId = resolved?.workflowRun.id ?? run.workflowRunId ?? undefined;
    const failed = await failIssueRuntimeVerification(
      run.orgId,
      run.id,
      ISSUE_RUNTIME_VERIFICATION_RUNNING_TIMEOUT_MESSAGE,
      workflowRunId,
    );
    if (failed && resolved && resolved.workflowRun.status !== "completed") {
      await requestGithubWorkflowCancellation({
        github: resolved.github,
        owner: resolved.owner,
        repo: resolved.repo,
        workflowRunId: resolved.workflowRun.id,
        runId: run.id,
      });
    }
    return failed ? "running-timeout" : "none";
  }

  if (!resolved) {
    if (
      run.status === "Queued"
      && now.getTime() - new Date(run.requestedAt).getTime()
        >= ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MS
    ) {
      const failed = await failIssueRuntimeVerification(
        run.orgId,
        run.id,
        ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MESSAGE,
      );
      return failed ? "queued-timeout" : "none";
    }
    return "none";
  }

  const { github, owner, repo, workflowRun } = resolved;
  if (workflowRun.status === "completed") {
    const conclusion = workflowRun.conclusion?.replaceAll("_", " ") ?? "without a result";
    const diagnostic = workflowRun.conclusion === "success"
      ? null
      : await githubRuntimeVerificationFailureMessage(github, owner, repo, workflowRun.id);
    await failIssueRuntimeVerification(
      run.orgId,
      run.id,
      diagnostic ?? (workflowRun.conclusion === "success"
        ? "GitHub Actions completed, but CloseSpan did not receive the runtime verification result. Review the GitHub run, then retry."
        : `GitHub Actions ${conclusion} before CloseSpan received a runtime verification result. Review the GitHub run, correct the failure, then retry.`),
      workflowRun.id,
    );
    return "none";
  }

  const jobsResponse = await github.rest.actions.listJobsForWorkflowRun({
    owner,
    repo,
    run_id: workflowRun.id,
    per_page: 100,
  });
  const verificationJob = jobsResponse.data.jobs.find(
    (job) => job.name === "Reproduce reported issue",
  );
  const verificationRunnerAssigned = verificationJob
    ? githubJobHasAssignedRunner(verificationJob)
    : false;

  if (verificationRunnerAssigned) {
    await databasePool().query(
      `UPDATE issue_runtime_verification_runs
          SET workflow_run_id=coalesce(workflow_run_id,$3),status='Running',
              started_at=coalesce(started_at,now()),updated_at=now()
        WHERE org_id=$1 AND id=$2 AND status IN ('Queued','Running')`,
      [run.orgId, run.id, workflowRun.id],
    );
    return "runner-assigned";
  }

  await databasePool().query(
    `UPDATE issue_runtime_verification_runs
        SET workflow_run_id=coalesce(workflow_run_id,$3),updated_at=now()
      WHERE org_id=$1 AND id=$2 AND status IN ('Queued','Running')`,
    [run.orgId, run.id, workflowRun.id],
  );

  const queueTimedOut = run.status === "Queued"
    && now.getTime() - new Date(run.requestedAt).getTime()
      >= ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MS;
  if (!queueTimedOut) return "none";

  const bootstrapJob = jobsResponse.data.jobs.find(
    (job) => job.name === "Fetch immutable verification job",
  );
  const bootstrapStillRunning = bootstrapJob?.status === "in_progress"
    && githubJobHasAssignedRunner(bootstrapJob);
  if (!verificationJob && bootstrapStillRunning) return "none";

  const failed = await failIssueRuntimeVerification(
    run.orgId,
    run.id,
    ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MESSAGE,
    workflowRun.id,
  );
  if (failed) {
    await requestGithubWorkflowCancellation({
      github,
      owner,
      repo,
      workflowRunId: workflowRun.id,
      runId: run.id,
    });
  }
  return failed ? "queued-timeout" : "none";
}

export async function reconcileStaleIssueRuntimeVerifications(
  orgId?: string,
  now = new Date(),
  dependencies: RuntimeVerificationReconciliationDependencies = runtimeVerificationReconciliationDependencies,
): Promise<{ queuedTimedOut: number; runningTimedOut: number }> {
  const queuedBefore = new Date(
    now.getTime() - ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MS,
  );
  const runningBefore = new Date(
    now.getTime() - ISSUE_RUNTIME_VERIFICATION_RUNNING_TIMEOUT_MS,
  );
  const candidates = await databasePool().query<StaleRuntimeRunRow>(
    `SELECT id,org_id,investigation_id,repository,installation_id::text,
            workflow_run_id,status,coalesce(summary,'') AS summary,
            requested_at,started_at
       FROM issue_runtime_verification_runs
      WHERE ($1::text IS NULL OR org_id=$1)
        AND (
          (status='Queued' AND requested_at < $2::timestamptz)
          OR
          (status='Running' AND COALESCE(started_at,requested_at) < $3::timestamptz)
        )
      ORDER BY requested_at
      LIMIT 100`,
    [orgId ?? null, queuedBefore.toISOString(), runningBefore.toISOString()],
  );

  let queuedTimedOut = 0;
  let runningTimedOut = 0;
  for (const run of candidates.rows) {
    try {
      const result = await reconcileActiveRuntimeVerification({
        id: run.id,
        orgId: run.org_id,
        repository: run.repository,
        installationId: run.installation_id,
        status: run.status,
        workflowRunId: run.workflow_run_id === null ? null : Number(run.workflow_run_id),
        requestedAt: iso(run.requested_at)!,
        startedAt: iso(run.started_at),
      }, now, dependencies);
      if (result === "queued-timeout") queuedTimedOut += 1;
      if (result === "running-timeout") runningTimedOut += 1;
    } catch (error) {
      console.error("Runtime verification timeout reconciliation failed", {
        runId: run.id,
        message: error instanceof Error ? error.message : "Unknown reconciliation failure",
      });
    }
  }

  return { queuedTimedOut, runningTimedOut };
}

export function buildIssueVerificationPrompt(input: {
  runId: string;
  baseSha: string;
  repository: string;
  workspaceRoot: string;
  problem: RuntimeProblemRow;
  repositoryEvidence: string;
}): string {
  return [
    "# CloseSpan current-issue verification",
    "",
    `Run ID: ${input.runId}`,
    `Repository: ${input.repository}`,
    `Pinned commit: ${input.baseSha}`,
    `Working directory: ${input.workspaceRoot}`,
    "",
    "## Objective",
    `Determine whether the reported current behavior or product gap is supported by decisive evidence: ${input.problem.title}`,
    input.problem.statement,
    input.problem.summary,
    "",
    "## Investigation boundary",
    `Working hypothesis: ${input.problem.hypothesis}`,
    ...stringArray(input.problem.assumptions).map((item) => `- Assumption: ${item}`),
    ...stringArray(input.problem.missing_information).map((item) => `- Evidence gap: ${item}`),
    ...stringArray(input.problem.recommended_tests).map((item) => `- Recommended check: ${item}`),
    ...stringArray(input.problem.suspected_files).map((item) => `- Suspected path: ${item}`),
    "",
    "## Evidence strategy",
    "- Start with targeted repository analysis at the exact pinned commit. Choose the least expensive evidence path that can still produce a decisive conclusion.",
    "- Repository analysis is sufficient when deterministic application source directly establishes the relevant route, action wiring, condition, default, state transition, or absence of the requested capability, and no runtime-only factor could reasonably change that conclusion.",
    "- For a feature request, verify the current product baseline or capability gap. Do not try to reproduce a feature that has not been implemented yet.",
    "- When repository evidence is decisive, set verificationMethod to Repository analysis, runtimeRequiredReason to null, record the inspected paths and bounded commands, and finish without launching a product runtime.",
    "- Escalate to Runtime execution only when the conclusion depends on rendering, layout, gesture handling, timing, animation, permissions, device or OS behavior, network responses, backend state, customer data, or when the relevant source paths remain ambiguous.",
    "- When runtime execution is required, set verificationMethod to Runtime execution and explain the specific reason in runtimeRequiredReason before starting the runtime check.",
    "- A UI report does not automatically require a UI test. Use a UI test only when static repository evidence cannot decisively establish the reported behavior or current feature gap.",
    "- After product code is changed, implementation verification is a separate phase and must run the strongest relevant automated tests, including UI tests when the changed behavior is user-interface dependent.",
    "",
    "## Runtime escalation rules",
    "- If runtime execution is required, reproduce the user-visible path with the approved platform runtime, simulator/emulator, test framework, or local service.",
    "- On macOS, the runner has already booted an approved iOS Simulator. Use CLOSESPAN_IOS_SIMULATOR_UDID and the CLOSESPAN_IOS_SIMULATOR_HARNESS helper to inspect, install, launch, terminate, open URLs, and capture screenshots.",
    "- Capture simulator screenshots only through CLOSESPAN_IOS_SIMULATOR_HARNESS; it produces model-safe evidence. Do not inline image bytes, base64 data, full process listings, or other bulky artifacts into model messages. Record artifact paths in the report instead.",
    "- Keep every inspection bounded: use targeted rg/find queries, read at most 200 relevant lines from a file at a time, and redirect verbose build/test output to CLOSESPAN_RUNTIME_ARTIFACT_DIR before summarizing only the decisive tail.",
    "- Never print entire source files, project trees, simulator inventories, build logs, or generated files into the model conversation.",
    "- Create the required verification report immediately after the initial evidence pass, then update it as checks complete. Do not postpone the report until after broad repository exploration.",
    "- Never clear required report arrays while updating the report. Keep reproductionSteps nonempty and preserve previously recorded commands, observations, and artifacts.",
    "- If runtime verification cannot finish, finalize the report as Verification blocked with the attempted reproduction steps and the specific blocker. Do not leave pending or in-progress report text.",
    "- Stop investigating once the available repository or runtime evidence supports one allowed outcome.",
    "- Prefer an existing XCTest or UI-test target. If the repository has no test target, build and launch the app on the prepared simulator and create only an ephemeral repository-specific harness under .closespan-run/; never add a test target to the product project during verification.",
    "- A missing repository test target alone is not a blocker when the user-visible path can be exercised through the prepared simulator harness.",
    "- Do not fix the issue. Do not push, commit, publish, or modify product source files.",
    "- Temporary tests and artifacts must stay under CLOSESPAN_RUNTIME_ARTIFACT_DIR.",
    "- Use ‘Confirmed current’ when decisive repository or runtime evidence supports the reported current behavior or feature gap.",
    "- Use ‘Not reproduced’ only after an appropriate runtime check runs successfully under the reported conditions; source reading alone cannot prove a negative runtime result.",
    "- Use ‘Verification blocked’ when neither repository evidence nor an available required runtime check can support a decisive conclusion.",
    "- Never treat a missing capability or a test harness failure as evidence that the issue is resolved.",
    "",
    "## Required artifact",
    `Write the report to the exact path in CLOSESPAN_RUNTIME_REPORT_PATH using schemaVersion 1, runId ${input.runId}, baseSha ${input.baseSha}, and these fields: verificationMethod, runtimeRequiredReason, outcome, summary, expectedBehavior, actualBehavior, reproductionSteps, commands, observations, artifacts.`,
    "Store screenshots, logs, and test reports under CLOSESPAN_RUNTIME_ARTIFACT_DIR. Do not create a second relative .closespan-run directory inside the product workspace.",
    "Each command entry must contain command, status (passed|failed|blocked), output, and durationMs. Each artifact entry must contain name, path, and kind (screenshot|log|test-report).",
    "Do not include environment; the trusted runner appends its own attested environment.",
    "",
    "## Retrieved repository context",
    input.repositoryEvidence,
  ].join("\n").slice(0, 48_000);
}

export async function startIssueRuntimeVerification(input: {
  orgId: string;
  problemId: string;
  actor: { actorId: string; actorName: string; traceId: string };
  workflowHash: string;
}): Promise<IssueRuntimeVerificationContext> {
  if (workspacePersistenceMode(input.orgId) !== "postgres") {
    throw new HttpError(409, "Runtime verification requires a persistent workspace");
  }
  await reconcileStaleIssueRuntimeVerifications(input.orgId);
  const match = await resolveRuntimeVerificationRepositoryBinding(input);
  if (!match) {
    throw new HttpError(
      409,
      "Runtime verification needs a confirmed repository binding for this ticket. Step 1: Go to Settings → Execution and verify that the authorized repository root is Active. Step 2: Open this ticket in Prompt Testing → Repository execution context, select that active repository/root, and confirm it for this ticket. Step 3: Return here and retry runtime verification.",
    );
  }
  const profile = await getExecutionProfileVersion(input.orgId, match.profileId);
  if (!profile || profile.contentHash !== match.profileHash) {
    throw new HttpError(409, "The confirmed execution profile is no longer available");
  }
  const config = sanitizeExecutionProfileConfig(profile.config);
  const executor = executionProfileExecutor(config);
  if (executor.kind !== "tenki_github_actions") {
    throw new HttpError(409, "This repository needs a Tenki GitHub Actions execution profile for runtime verification");
  }
  try {
    await assertTenkiRunnerWorkflowSetupInstalled(input.orgId, match.repository);
  } catch (error) {
    throw new HttpError(
      409,
      error instanceof Error
        ? error.message
        : "The Tenki runtime verifier workflow is not ready",
    );
  }
  const authorization = (await listGithubRepositoryAuthorizations(input.orgId)).find(
    (candidate) => candidate.active && candidate.workspaceSelected && candidate.repository === match.repository,
  );
  if (!authorization) throw new HttpError(409, "The confirmed repository is no longer authorized");
  const github = await createGithubInstallationClient(authorization.installationId);
  await ensureCurrentTenkiRuntimeVerifierWorkflow({
    installationId: authorization.installationId,
    repository: match.repository,
    defaultBranch: authorization.executionBranch,
    expectedWorkflowHash: input.workflowHash,
  }, {
    createClient: async () => github,
  });
  const [owner, repo] = match.repository.split("/");
  const ref = await github.rest.git.getRef({ owner, repo, ref: `heads/${authorization.executionBranch}` });
  const baseSha = ref.data.object.sha.toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(baseSha)) throw new Error("GitHub returned an invalid commit SHA");
  const problemResult = await databasePool().query<RuntimeProblemRow>(
    `SELECT problem.title,problem.statement,problem.summary,
            investigation.id AS investigation_id,investigation.hypothesis,
            investigation.assumptions,investigation.missing_information,
            investigation.recommended_tests,investigation.suspected_files
       FROM product_problems problem
       JOIN LATERAL (
         SELECT candidate.* FROM investigations candidate
          WHERE candidate.org_id=problem.org_id AND candidate.problem_id=problem.id
          ORDER BY candidate.updated_at DESC,candidate.id LIMIT 1
       ) investigation ON true
      WHERE problem.org_id=$1 AND problem.id=$2`,
    [input.orgId, input.problemId],
  );
  const problem = problemResult.rows[0];
  if (!problem) throw new HttpError(404, "Investigation was not found");
  let repositoryEvidence = "No exact-commit repository context was available. Inspect the pinned checkout directly.";
  try {
    repositoryEvidence = (await searchRepositoryContext({
      orgId: input.orgId,
      repository: match.repository,
      expectedCommitSha: baseSha,
      query: `${problem.title}\n${problem.statement}\n${problem.hypothesis}`,
      maxOutputLength: 18_000,
      excludePathPrefixes: CLOSESPAN_SYSTEM_PATH_PREFIXES,
    })).retrieval;
  } catch {
    // The runner has an exact GitHub checkout and must inspect it directly when the cached index is stale.
  }
  const runId = randomUUID();
  const prompt = buildIssueVerificationPrompt({
    runId,
    baseSha,
    repository: match.repository,
    workspaceRoot: match.workspaceRoot,
    problem,
    repositoryEvidence,
  });
  const promptHash = createHash("sha256").update(prompt).digest("hex");
  const snapshot: ExecutionProfileSnapshot = {
    profileId: profile.id,
    version: profile.version,
    source: profile.source,
    repository: profile.repository,
    workspaceRoot: profile.workspaceRoot,
    contentHash: profile.contentHash,
    config: profile.config,
  };
  await transaction(async (client) => {
    const active = await client.query(
      `SELECT 1 FROM issue_runtime_verification_runs
        WHERE org_id=$1 AND problem_id=$2 AND status IN ('Queued','Running')`,
      [input.orgId, input.problemId],
    );
    if (active.rowCount) throw new HttpError(409, "Runtime verification is already running for this issue");
    await client.query(
      `INSERT INTO issue_runtime_verification_runs(
         id,org_id,problem_id,investigation_id,repository,installation_id,
         workspace_root,base_branch,base_sha,prompt_hash,verification_prompt,
         execution_profile_id,execution_profile_hash,execution_profile_snapshot,
         workflow_hash,requested_by,requested_by_name
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [runId, input.orgId, input.problemId, problem.investigation_id, match.repository,
        authorization.installationId, match.workspaceRoot, authorization.executionBranch,
        baseSha, promptHash, prompt, profile.id, profile.contentHash,
        JSON.stringify(snapshot), input.workflowHash, input.actor.actorId, input.actor.actorName],
    );
    await client.query(
      `UPDATE investigations SET verification_status='Unverified',verification_method=NULL,
              verification_summary=NULL,verification_actor_id=NULL,verification_actor_name=NULL,
              verified_at=NULL,updated_at=now()
        WHERE org_id=$1 AND id=$2`,
      [input.orgId, problem.investigation_id],
    );
    await client.query(
      `INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id)
       VALUES($1,$2,$3,$4,$5,'Investigation',$6,$7)`,
      [randomUUID(), input.orgId, input.actor.actorId, input.actor.actorName,
        `Queued Tenki runtime verification at ${baseSha.slice(0, 12)}.`,
        problem.investigation_id, input.actor.traceId],
    );
  });
  return {
    orgId: input.orgId,
    problemId: input.problemId,
    investigationId: problem.investigation_id,
    runId,
    repository: match.repository,
    installationId: authorization.installationId,
    workspaceRoot: match.workspaceRoot,
    baseBranch: authorization.executionBranch,
    baseSha,
    promptHash,
    verificationPrompt: prompt,
    executionProfileId: profile.id,
    executionProfileHash: profile.contentHash,
    executionProfileSnapshot: snapshot,
    workflowHash: input.workflowHash,
    expiresAt: new Date(Date.now() + ISSUE_RUNTIME_VERIFICATION_JOB_TTL_MS).toISOString(),
  };
}

export async function getIssueRuntimeVerificationContext(
  orgId: string,
  runId: string,
): Promise<IssueRuntimeVerificationContext> {
  const result = await databasePool().query<RuntimeRunRow>(
    `SELECT id,org_id,problem_id,investigation_id,repository,installation_id::text,
            workspace_root,base_branch,base_sha,prompt_hash,verification_prompt,
            execution_profile_id,execution_profile_hash,execution_profile_snapshot,
            workflow_hash,status,outcome,summary,failure_message,workflow_run_id,
            requested_by_name,requested_at,started_at,completed_at
       FROM issue_runtime_verification_runs WHERE org_id=$1 AND id=$2`,
    [orgId, runId],
  );
  const row = result.rows[0];
  if (!row) throw new HttpError(404, "Runtime verification run was not found");
  return {
    orgId: row.org_id,
    problemId: row.problem_id,
    investigationId: row.investigation_id,
    runId: row.id,
    repository: row.repository,
    installationId: row.installation_id,
    workspaceRoot: row.workspace_root,
    baseBranch: row.base_branch,
    baseSha: row.base_sha,
    promptHash: row.prompt_hash,
    verificationPrompt: row.verification_prompt,
    executionProfileId: row.execution_profile_id,
    executionProfileHash: row.execution_profile_hash,
    executionProfileSnapshot: row.execution_profile_snapshot,
    workflowHash: row.workflow_hash,
    expiresAt: new Date(
      new Date(row.requested_at).getTime() + ISSUE_RUNTIME_VERIFICATION_JOB_TTL_MS,
    ).toISOString(),
  };
}

export async function markIssueRuntimeVerificationRunning(orgId: string, runId: string): Promise<void> {
  await databasePool().query(
    `UPDATE issue_runtime_verification_runs SET status='Running',started_at=coalesce(started_at,now()),updated_at=now()
      WHERE org_id=$1 AND id=$2 AND status='Queued'`,
    [orgId, runId],
  );
}

export async function failIssueRuntimeVerification(
  orgId: string,
  runId: string,
  message: string,
  workflowRunId?: number,
): Promise<boolean> {
  const summary = runtimeVerificationFailureMessage(message)?.slice(0, 2_000)
    || "The Tenki runtime verifier failed before it produced decisive evidence.";
  return transaction(async (client) => {
    const result = await client.query<{ investigation_id: string }>(
      `UPDATE issue_runtime_verification_runs
          SET status='Failed',outcome='Verification blocked',summary=$3,failure_message=$3,
              workflow_run_id=coalesce($4,workflow_run_id),completed_at=now(),updated_at=now()
        WHERE org_id=$1 AND id=$2 AND status IN ('Queued','Running')
        RETURNING investigation_id`,
      [orgId, runId, summary, workflowRunId ?? null],
    );
    const investigationId = result.rows[0]?.investigation_id;
    if (!investigationId) return false;
    await client.query(
      `UPDATE investigations SET verification_status='Verification blocked',
              verification_method='Automated check',verification_summary=$3,
              verification_actor_id='system:tenki-runtime-verifier',
              verification_actor_name='Tenki runtime verifier',verified_at=now(),updated_at=now()
        WHERE org_id=$1 AND id=$2`,
      [orgId, investigationId, summary],
    );
    await client.query(
      `INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id)
       VALUES($1,$2,'system:tenki-runtime-verifier','Tenki runtime verifier',$3,'Investigation',$4,$5)`,
      [randomUUID(), orgId, summary, investigationId, runId],
    );
    await client.query(
      "UPDATE workspaces SET version=version+1,updated_at=now() WHERE org_id=$1",
      [orgId],
    );
    return true;
  });
}

export async function reconcileIssueRuntimeVerificationFromGithub(
  context: IssueRuntimeVerificationContext,
  current: IssueRuntimeVerificationRunView,
  now = new Date(),
  dependencies: RuntimeVerificationReconciliationDependencies = runtimeVerificationReconciliationDependencies,
): Promise<void> {
  if (current.status !== "Queued" && current.status !== "Running") return;
  await reconcileActiveRuntimeVerification({
    id: context.runId,
    orgId: context.orgId,
    repository: context.repository,
    installationId: context.installationId,
    status: current.status,
    workflowRunId: current.workflowRunId,
    requestedAt: current.requestedAt,
    startedAt: current.startedAt,
  }, now, dependencies);
}

export async function completeIssueRuntimeVerification(
  context: IssueRuntimeVerificationContext,
  report: IssueRuntimeVerificationReport,
): Promise<void> {
  if (report.runId !== context.runId || report.baseSha !== context.baseSha) {
    throw new Error("Runtime verification report does not match its immutable run");
  }
  await transaction(async (client) => {
    const result = await client.query<{ investigation_id: string }>(
      `UPDATE issue_runtime_verification_runs
          SET status='Completed',outcome=$3,summary=$4,report=$5::jsonb,
              workflow_run_id=$6,completed_at=now(),updated_at=now()
        WHERE org_id=$1 AND id=$2 AND status IN ('Queued','Running')
        RETURNING investigation_id`,
      [context.orgId, context.runId, report.outcome, report.summary,
        JSON.stringify(report), report.environment.workflowRunId],
    );
    const investigationId = result.rows[0]?.investigation_id;
    if (!investigationId) throw new HttpError(409, "Runtime verification run is no longer active");
    await client.query(
      `UPDATE investigations SET verification_status=$3,verification_method=$4,
              verification_summary=$5,verification_actor_id='system:tenki-runtime-verifier',
              verification_actor_name='Tenki runtime verifier',verified_at=now(),updated_at=now()
        WHERE org_id=$1 AND id=$2`,
      [context.orgId, investigationId, report.outcome,
        report.verificationMethod === "Repository analysis" ? "Repository analysis" : "Automated check",
        report.summary],
    );
    if (report.outcome === "Confirmed current") {
      await client.query(
        `UPDATE implementation_prompts
            SET status='Superseded'
          WHERE org_id=$1 AND problem_id=$2 AND status IN ('Draft','Ready')`,
        [context.orgId, context.problemId],
      );
    }
    await client.query(
      `INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id)
       VALUES($1,$2,'system:tenki-runtime-verifier','Tenki runtime verifier',$3,'Investigation',$4,$5)`,
      [randomUUID(), context.orgId,
        `Completed issue verification using ${report.verificationMethod}: ${report.outcome} at ${context.baseSha.slice(0, 12)}.`,
        investigationId, context.runId],
    );
    await client.query("UPDATE workspaces SET version=version+1,updated_at=now() WHERE org_id=$1", [context.orgId]);
  });
}

export async function latestIssueRuntimeVerification(
  orgId: string,
  problemId: string,
): Promise<IssueRuntimeVerificationRunView | null> {
  await reconcileStaleIssueRuntimeVerifications(orgId);
  const result = await databasePool().query<RuntimeRunRow>(
    `SELECT id,org_id,problem_id,investigation_id,repository,installation_id::text,
            workspace_root,base_branch,base_sha,prompt_hash,verification_prompt,
            execution_profile_id,execution_profile_hash,execution_profile_snapshot,
            workflow_hash,status,outcome,summary,failure_message,workflow_run_id,
            requested_by_name,requested_at,started_at,completed_at
       FROM issue_runtime_verification_runs
      WHERE org_id=$1 AND problem_id=$2 ORDER BY requested_at DESC LIMIT 1`,
    [orgId, problemId],
  );
  return result.rows[0] ? runView(result.rows[0]) : null;
}
