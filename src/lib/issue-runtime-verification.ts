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
import { runtimeVerificationFailureMessage } from "./runtime-verifier-errors";
import { assertTenkiRunnerWorkflowSetupInstalled } from "./tenki-runner-workflow-setup-repository";
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
  summary: string;
  started_at: Date | string | null;
}

export const issueRuntimeVerificationReportSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().uuid(),
  baseSha: z.string().regex(/^[a-f0-9]{40}$/),
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
 * Ambiguous repository evidence remains human-reviewed in PDD.
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

export async function reconcileStaleIssueRuntimeVerifications(
  orgId?: string,
  now = new Date(),
): Promise<{ queuedTimedOut: number; runningTimedOut: number }> {
  const queuedBefore = new Date(
    now.getTime() - ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MS,
  );
  const runningBefore = new Date(
    now.getTime() - ISSUE_RUNTIME_VERIFICATION_RUNNING_TIMEOUT_MS,
  );

  return transaction(async (client) => {
    const result = await client.query<StaleRuntimeRunRow>(
      `UPDATE issue_runtime_verification_runs
          SET status='Failed',outcome='Verification blocked',
              summary=CASE WHEN status='Queued' THEN $4 ELSE $5 END,
              failure_message=CASE WHEN status='Queued' THEN $4 ELSE $5 END,
              completed_at=now(),updated_at=now()
        WHERE ($1::text IS NULL OR org_id=$1)
          AND (
            (status='Queued' AND requested_at < $2::timestamptz)
            OR
            (status='Running' AND COALESCE(started_at,requested_at) < $3::timestamptz)
          )
        RETURNING id,org_id,investigation_id,summary,started_at`,
      [
        orgId ?? null,
        queuedBefore.toISOString(),
        runningBefore.toISOString(),
        ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MESSAGE,
        ISSUE_RUNTIME_VERIFICATION_RUNNING_TIMEOUT_MESSAGE,
      ],
    );

    for (const run of result.rows) {
      await client.query(
        `UPDATE investigations
            SET verification_status='Verification blocked',
                verification_method='Automated check',verification_summary=$3,
                verification_actor_id='system:tenki-runtime-verifier',
                verification_actor_name='CloseSpan timeout reconciler',
                verified_at=now(),updated_at=now()
          WHERE org_id=$1 AND id=$2`,
        [run.org_id, run.investigation_id, run.summary],
      );
      await client.query(
        `INSERT INTO audit_events(
           id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
         ) VALUES(
           $1,$2,'system:tenki-runtime-verifier','CloseSpan timeout reconciler',
           $3,'Investigation',$4,$5
         )`,
        [
          randomUUID(),
          run.org_id,
          `Timed out runtime verification. ${run.summary}`,
          run.investigation_id,
          run.id,
        ],
      );
    }

    const affectedOrganizations = [...new Set(result.rows.map((run) => run.org_id))];
    if (affectedOrganizations.length) {
      await client.query(
        `UPDATE workspaces
            SET version=version+1,updated_at=now()
          WHERE org_id=ANY($1::text[])`,
        [affectedOrganizations],
      );
    }

    return {
      queuedTimedOut: result.rows.filter((run) => run.started_at === null).length,
      runningTimedOut: result.rows.filter((run) => run.started_at !== null).length,
    };
  });
}

function verificationPrompt(input: {
  runId: string;
  baseSha: string;
  repository: string;
  workspaceRoot: string;
  problem: RuntimeProblemRow;
  repositoryEvidence: string;
}): string {
  return [
    "# CloseSpan current-issue runtime verification",
    "",
    `Run ID: ${input.runId}`,
    `Repository: ${input.repository}`,
    `Pinned commit: ${input.baseSha}`,
    `Working directory: ${input.workspaceRoot}`,
    "",
    "## Objective",
    `Determine whether this reported issue still exists in the executable product: ${input.problem.title}`,
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
    "## Rules",
    "- Inspect and execute the pinned checkout. A source-code reading or successful build alone is not verification.",
    "- Reproduce the user-visible path with the approved platform runtime, simulator/emulator, test framework, or local service.",
    "- Do not fix the issue. Do not push, commit, publish, or modify product source files.",
    "- Temporary tests and artifacts must stay under .closespan-run/.",
    "- Use ‘Confirmed current’ only when the reported failure is observed.",
    "- Use ‘Not reproduced’ only after the expected path runs successfully under the reported conditions.",
    "- Use ‘Verification blocked’ when credentials, permissions, fixtures, hardware, services, or runtime capabilities prevent a decisive test.",
    "- Never treat a missing capability or a test harness failure as evidence that the issue is resolved.",
    "",
    "## Required artifact",
    `Write .closespan-run/runtime-verification.json using schemaVersion 1, runId ${input.runId}, baseSha ${input.baseSha}, and these fields: outcome, summary, expectedBehavior, actualBehavior, reproductionSteps, commands, observations, artifacts.`,
    "Each command entry must contain command, status (passed|failed|blocked), output, and durationMs. Each artifact entry must contain name, path, and kind (screenshot|log|test-report).",
    "Do not include environment; the trusted runner appends its own attested environment.",
    "",
    "## Retrieved repository context",
    input.repositoryEvidence,
  ].join("\n").slice(0, 120_000);
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
      "Runtime verification needs a confirmed repository binding for this ticket. Step 1: Go to Settings → Execution and verify that the authorized repository root is Active. Step 2: Open this ticket in PDD → Repository execution context, select that active repository/root, and confirm it for this ticket. Step 3: Return here and retry runtime verification.",
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
  const [owner, repo] = match.repository.split("/");
  const ref = await github.rest.git.getRef({ owner, repo, ref: `heads/${authorization.defaultBranch}` });
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
      maxOutputLength: 50_000,
      excludePathPrefixes: CLOSESPAN_SYSTEM_PATH_PREFIXES,
    })).retrieval;
  } catch {
    // The runner has an exact GitHub checkout and must inspect it directly when the cached index is stale.
  }
  const runId = randomUUID();
  const prompt = verificationPrompt({
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
        authorization.installationId, match.workspaceRoot, authorization.defaultBranch,
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
    baseBranch: authorization.defaultBranch,
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
): Promise<void> {
  const summary = runtimeVerificationFailureMessage(message)?.slice(0, 2_000)
    || "The Tenki runtime verifier failed before it produced decisive evidence.";
  await transaction(async (client) => {
    const result = await client.query<{ investigation_id: string }>(
      `UPDATE issue_runtime_verification_runs
          SET status='Failed',outcome='Verification blocked',summary=$3,failure_message=$3,
              completed_at=now(),updated_at=now()
        WHERE org_id=$1 AND id=$2 AND status IN ('Queued','Running')
        RETURNING investigation_id`,
      [orgId, runId, summary],
    );
    const investigationId = result.rows[0]?.investigation_id;
    if (!investigationId) return;
    await client.query(
      `UPDATE investigations SET verification_status='Verification blocked',
              verification_method='Automated check',verification_summary=$3,
              verification_actor_id='system:tenki-runtime-verifier',
              verification_actor_name='Tenki runtime verifier',verified_at=now(),updated_at=now()
        WHERE org_id=$1 AND id=$2`,
      [orgId, investigationId, summary],
    );
  });
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
      `UPDATE investigations SET verification_status=$3,verification_method='Automated check',
              verification_summary=$4,verification_actor_id='system:tenki-runtime-verifier',
              verification_actor_name='Tenki runtime verifier',verified_at=now(),updated_at=now()
        WHERE org_id=$1 AND id=$2`,
      [context.orgId, investigationId, report.outcome, report.summary],
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
        `Completed runtime verification: ${report.outcome} at ${context.baseSha.slice(0, 12)}.`,
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
