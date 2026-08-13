import { randomUUID } from "node:crypto";
import type { Octokit } from "@octokit/rest";
import type { Pool, PoolClient } from "pg";
import { createGithubInstallationClient } from "./github-app-auth";
import { databasePool, transaction } from "./db";
import {
  assessReleaseVerificationScope,
  hashReleaseVerificationPlan,
  type ReleaseVerificationPlan,
  type ReleaseVerificationScopeAssessment,
  type UiVerificationBaseline,
} from "./release-verification-plan";
import { autonomyCapabilities } from "./autonomy-policy";
import { readAutonomyLevel } from "./workspace-settings-repository";

export type FinalExecutionApprovalStatus =
  | "Pending"
  | "Approved"
  | "Rejected"
  | "Superseded"
  | "Expired";

export type FinalExecutionAttemptStatus =
  | "Queued"
  | "Running"
  | "Succeeded"
  | "Failed";

export interface FinalExecutionApprovalView {
  id: string;
  status: FinalExecutionApprovalStatus;
  expiresAt: string;
  problemId: string;
  agentRunId: string;
  repository: string;
  baseBranch: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  headSha: string;
  targetEnvironment: string | null;
  executionAction: "merge_pull_request" | "deploy";
  autoDeployOnMerge: boolean;
  rollbackPlan: string | null;
  uiBaseline: { planHash: string; captureCount: number } | null;
  releaseVerification: {
    planHash: string;
    backendChecks: number;
    frontendJourneys: number;
    backendRequired: boolean;
    frontendRequired: boolean;
    scopeAssessment: ReleaseVerificationScopeAssessment;
  } | null;
  changedFiles: string[];
  testSummary: { passed: number; failed: number; skipped: number };
  acceptanceSummary: { passed: number; unresolved: number };
  remainingRisks: string[];
  attempt: {
    id: string;
    status: FinalExecutionAttemptStatus;
    resultSha: string | null;
    resultUrl: string | null;
    failureMessage: string | null;
  } | null;
}

export interface FinalExecutionActor {
  actorId: string;
  actorName: string;
  traceId: string;
}

export class FinalExecutionError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export function finalExecutionScopeAllowsApproval(evidenceSnapshot: unknown): boolean {
  if (!evidenceSnapshot || typeof evidenceSnapshot !== "object") return true;
  const snapshot = evidenceSnapshot as {
    releaseVerificationScope?: { compatible?: unknown };
    releaseVerificationPlan?: ReleaseVerificationPlan;
    changedFiles?: unknown;
  };
  if (snapshot.releaseVerificationScope?.compatible === false) return false;
  if (snapshot.releaseVerificationScope?.compatible === true) return true;
  if (!snapshot.releaseVerificationPlan) return true;
  try {
    return assessReleaseVerificationScope(
      snapshot.releaseVerificationPlan,
      Array.isArray(snapshot.changedFiles)
        ? snapshot.changedFiles.filter((path): path is string => typeof path === "string")
        : [],
    ).compatible;
  } catch {
    return false;
  }
}

interface CreateFinalExecutionApprovalInput {
  orgId: string;
  problemId: string;
  runId: string;
  promptRevisionId: string;
  repository: string;
  baseBranch: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  headSha: string;
  changedFiles?: string[];
  tests?: Array<{ status?: string; [key: string]: unknown }>;
  criteria?: Array<{ status?: string; [key: string]: unknown }>;
  remainingRisks?: string[];
  independentVerification?: unknown;
  promptHash?: string;
  targetEnvironment?: string | null;
  autoDeployOnMerge?: boolean;
  rollbackPlan?: string | null;
  uiBaseline?: UiVerificationBaseline | null;
  releaseVerificationPlan?: ReleaseVerificationPlan;
}

interface FinalApprovalRow {
  id: string;
  status: FinalExecutionApprovalStatus;
  expires_at: Date;
  problem_id: string;
  agent_run_id: string;
  repository: string;
  base_branch: string;
  pull_request_number: number;
  pull_request_url: string;
  head_sha: string;
  target_environment: string | null;
  execution_action: "merge_pull_request" | "deploy";
  auto_deploy_on_merge: boolean;
  rollback_plan: string | null;
  evidence_snapshot: {
    changedFiles?: string[];
    tests?: Array<{ status?: string }>;
    criteria?: Array<{ status?: string }>;
    remainingRisks?: string[];
    uiBaseline?: UiVerificationBaseline | null;
    releaseVerificationPlan?: ReleaseVerificationPlan;
    releaseVerificationScope?: ReleaseVerificationScopeAssessment;
  } | null;
  changed_files: string[];
  test_results: Array<{ status?: string }>;
  implementation_report: {
    remainingRisks?: string[];
  } | null;
  criteria_passed: number;
  criteria_unresolved: number;
  attempt_id: string | null;
  attempt_status: FinalExecutionAttemptStatus | null;
  result_sha: string | null;
  result_url: string | null;
  failure_message: string | null;
}

function summary(row: FinalApprovalRow): FinalExecutionApprovalView {
  const snapshot = row.evidence_snapshot ?? {};
  const tests = Array.isArray(snapshot.tests) ? snapshot.tests : Array.isArray(row.test_results) ? row.test_results : [];
  const criteria = Array.isArray(snapshot.criteria) ? snapshot.criteria : [];
  return {
    id: row.id,
    status: row.status,
    expiresAt: row.expires_at.toISOString(),
    problemId: row.problem_id,
    agentRunId: row.agent_run_id,
    repository: row.repository,
    baseBranch: row.base_branch,
    pullRequestNumber: row.pull_request_number,
    pullRequestUrl: row.pull_request_url,
    headSha: row.head_sha,
    targetEnvironment: row.target_environment,
    executionAction: row.execution_action,
    autoDeployOnMerge: row.auto_deploy_on_merge,
    rollbackPlan: row.rollback_plan,
    uiBaseline: snapshot.uiBaseline
      ? { planHash: snapshot.uiBaseline.planHash, captureCount: snapshot.uiBaseline.captures.length }
      : null,
    releaseVerification: snapshot.releaseVerificationPlan
      ? {
          planHash: hashReleaseVerificationPlan(snapshot.releaseVerificationPlan),
          backendChecks: snapshot.releaseVerificationPlan.backend.checks.length,
          frontendJourneys: snapshot.releaseVerificationPlan.frontend.journeys.length,
          backendRequired: snapshot.releaseVerificationPlan.requirements.backend === "required",
          frontendRequired: snapshot.releaseVerificationPlan.requirements.frontend === "required",
          scopeAssessment: snapshot.releaseVerificationScope
            ?? assessReleaseVerificationScope(
              snapshot.releaseVerificationPlan,
              Array.isArray(snapshot.changedFiles) ? snapshot.changedFiles : [],
            ),
        }
      : null,
    changedFiles: Array.isArray(snapshot.changedFiles) ? snapshot.changedFiles : Array.isArray(row.changed_files) ? row.changed_files : [],
    testSummary: {
      passed: tests.filter((test) => test.status === "passed").length,
      failed: tests.filter((test) => test.status === "failed").length,
      skipped: tests.filter((test) => test.status === "skipped").length,
    },
    acceptanceSummary: {
      passed: criteria.length ? criteria.filter((criterion) => criterion.status === "Passed").length : Number(row.criteria_passed),
      unresolved: criteria.length ? criteria.filter((criterion) => criterion.status !== "Passed").length : Number(row.criteria_unresolved),
    },
    remainingRisks: snapshot.remainingRisks ?? row.implementation_report?.remainingRisks ?? [],
    attempt: row.attempt_id && row.attempt_status
      ? {
          id: row.attempt_id,
          status: row.attempt_status,
          resultSha: row.result_sha,
          resultUrl: row.result_url,
          failureMessage: row.failure_message,
        }
      : null,
  };
}

export async function readFinalExecutionApproval(
  database: Pool | PoolClient,
  orgId: string,
  problemId: string | null,
  approvalId: string | null = null,
): Promise<FinalExecutionApprovalView | null> {
  const result = await database.query<FinalApprovalRow>(
    `SELECT approval.id,approval.status,approval.expires_at,approval.problem_id,
            approval.agent_run_id,approval.repository,approval.base_branch,
            approval.pull_request_number,approval.pull_request_url,approval.head_sha,
            approval.target_environment,approval.execution_action,
            approval.auto_deploy_on_merge,approval.rollback_plan,approval.evidence_snapshot,
            run.changed_files,run.test_results,
            run.implementation_report,
            count(criteria.criterion_id) FILTER (WHERE criteria.status='Passed')::int AS criteria_passed,
            count(criteria.criterion_id) FILTER (WHERE criteria.status<>'Passed')::int AS criteria_unresolved,
            attempt.id AS attempt_id,attempt.status AS attempt_status,
            attempt.result_sha,attempt.result_url,attempt.failure_message
       FROM approval_requests approval
       JOIN agent_runs run
         ON run.org_id=approval.org_id AND run.id=approval.agent_run_id
       LEFT JOIN agent_run_criterion_results criteria
         ON criteria.org_id=run.org_id AND criteria.run_id=run.id
       LEFT JOIN final_execution_attempts attempt
         ON attempt.org_id=approval.org_id AND attempt.approval_id=approval.id
      WHERE approval.org_id=$1
        AND ($2::text IS NULL OR approval.problem_id=$2)
        AND ($3::text IS NULL OR approval.id=$3)
        AND approval.action_type='final_execution'
      GROUP BY approval.id,approval.status,approval.expires_at,approval.problem_id,
        approval.agent_run_id,approval.repository,approval.base_branch,
        approval.pull_request_number,approval.pull_request_url,approval.head_sha,
        approval.target_environment,approval.execution_action,
        approval.auto_deploy_on_merge,approval.rollback_plan,approval.evidence_snapshot,
        run.changed_files,run.test_results,
        run.implementation_report,attempt.id,attempt.status,attempt.result_sha,
        attempt.result_url,attempt.failure_message,approval.created_at
      ORDER BY approval.created_at DESC LIMIT 1`,
    [orgId, problemId, approvalId],
  );
  return result.rows[0] ? summary(result.rows[0]) : null;
}

export function getFinalExecutionApprovalById(
  orgId: string,
  approvalId: string,
): Promise<FinalExecutionApprovalView | null> {
  return readFinalExecutionApproval(databasePool(), orgId, null, approvalId);
}

export async function createFinalExecutionApproval(
  client: PoolClient,
  input: CreateFinalExecutionApprovalInput,
): Promise<string> {
  const approvalId = `apr_final_${randomUUID().replaceAll("-", "")}`;
  const changedFiles = input.changedFiles ?? [];
  const releaseVerificationScope = input.releaseVerificationPlan
    ? assessReleaseVerificationScope(input.releaseVerificationPlan, changedFiles)
    : null;
  const result = await client.query<{ id: string }>(
    `INSERT INTO approval_requests(
       id,org_id,problem_id,recommendation_id,action,reason,confidence,systems,
       data_shared,reversible,risk,status,action_type,prompt_revision_id,
       repository,base_branch,base_sha,allowed_capabilities,expires_at,
       agent_run_id,pull_request_number,pull_request_url,head_sha,target_environment,
       evidence_snapshot,execution_action,auto_deploy_on_merge,rollback_plan
     ) VALUES(
       $1,$2,$3,$4,$5,$6,1,$7,$8,false,'High','Pending','final_execution',$9,
       $10,$11,$12,$13,now()+interval '24 hours',$14,$15,$16,$17,$18,
       $19,'merge_pull_request',$20,$21
     )
     ON CONFLICT (org_id,agent_run_id) WHERE action_type='final_execution'
     DO UPDATE SET updated_at=approval_requests.updated_at
     RETURNING id`,
    [
      approvalId,
      input.orgId,
      input.problemId,
      input.runId,
      `Merge pull request #${input.pullRequestNumber} in ${input.repository}`,
      "Independent verification passed. Human approval is required before the exact reviewed commit can be merged.",
      JSON.stringify(["GitHub"]),
      JSON.stringify(["Pull request metadata", "Changed files", "Test and acceptance evidence"]),
      input.promptRevisionId,
      input.repository,
      input.baseBranch,
      input.headSha,
      JSON.stringify(["pull_requests:merge"]),
      input.runId,
      input.pullRequestNumber,
      input.pullRequestUrl,
      input.headSha,
      input.targetEnvironment ?? null,
      JSON.stringify({
        schemaVersion: 2,
        agentRunId: input.runId,
        promptRevisionId: input.promptRevisionId,
        promptHash: input.promptHash ?? null,
        repository: input.repository,
        baseBranch: input.baseBranch,
        pullRequestNumber: input.pullRequestNumber,
        pullRequestUrl: input.pullRequestUrl,
        headSha: input.headSha,
        changedFiles,
        tests: input.tests ?? [],
        criteria: input.criteria ?? [],
        remainingRisks: input.remainingRisks ?? [],
        independentVerification: input.independentVerification ?? null,
        uiBaseline: input.uiBaseline
          ? { ...input.uiBaseline, headSha: input.headSha }
          : null,
        releaseVerificationPlan: input.releaseVerificationPlan ?? null,
        releaseVerificationScope,
        targetEnvironment: input.targetEnvironment ?? null,
        rollbackPlan: input.rollbackPlan ?? null,
        capturedAt: new Date().toISOString(),
      }),
      input.autoDeployOnMerge ?? false,
      input.rollbackPlan ?? null,
    ],
  );
  return result.rows[0]?.id ?? approvalId;
}

function repositoryParts(repository: string): { owner: string; repo: string } {
  const [owner, repo, extra] = repository.split("/");
  if (!owner || !repo || extra)
    throw new FinalExecutionError("Repository must use owner/name format", 409);
  return { owner, repo };
}

interface GithubMergeInput {
  repository: string;
  baseBranch: string;
  pullRequestNumber: number;
  expectedHeadSha: string;
}

interface GithubMergeDependencies {
  createClient?: (installationId: string) => Promise<Octokit> | Octokit;
}

export async function mergeApprovedPullRequest(
  installationId: string,
  input: GithubMergeInput,
  dependencies: GithubMergeDependencies = {},
): Promise<{ sha: string; url: string }> {
  const octokit = dependencies.createClient
    ? await dependencies.createClient(installationId)
    : await createGithubInstallationClient(installationId);
  const repository = repositoryParts(input.repository);
  const current = await octokit.rest.pulls.get({
    ...repository,
    pull_number: input.pullRequestNumber,
  });
  if (current.data.state !== "open")
    throw new FinalExecutionError("The pull request is no longer open", 409);
  if (current.data.base.ref !== input.baseBranch)
    throw new FinalExecutionError("The pull request target branch changed; review it again", 409);
  if (current.data.head.sha !== input.expectedHeadSha)
    throw new FinalExecutionError("The pull request changed; a new verified agent run is required", 409);
  if (current.data.draft) {
    await octokit.graphql(
      `mutation MarkPullRequestReady($id: ID!) {
        markPullRequestReadyForReview(input: { pullRequestId: $id }) {
          pullRequest { id }
        }
      }`,
      { id: current.data.node_id },
    );
  }
  const merged = await octokit.rest.pulls.merge({
    ...repository,
    pull_number: input.pullRequestNumber,
    sha: input.expectedHeadSha,
    merge_method: "squash",
  });
  if (!merged.data.merged || !merged.data.sha)
    throw new FinalExecutionError(
      merged.data.message || "GitHub did not merge the pull request",
      409,
    );
  return { sha: merged.data.sha, url: current.data.html_url };
}

interface ApprovalCandidate {
  id: string;
  problem_id: string;
  status: FinalExecutionApprovalStatus;
  expires_at: Date;
  agent_run_id: string;
  repository: string;
  base_branch: string;
  pull_request_number: number;
  pull_request_url: string;
  head_sha: string;
  installation_id: string;
  run_status: string;
  implementation_commit_sha: string;
  verification_status: string | null;
  evidence_snapshot: {
    releaseVerificationScope?: ReleaseVerificationScopeAssessment;
  } | null;
  attempt_id: string | null;
  attempt_status: FinalExecutionAttemptStatus | null;
}

async function loadCandidate(orgId: string, approvalId: string): Promise<ApprovalCandidate> {
  const result = await databasePool().query<ApprovalCandidate>(
    `SELECT approval.id,approval.problem_id,approval.status,approval.expires_at,
            approval.agent_run_id,approval.repository,approval.base_branch,
            approval.pull_request_number,approval.pull_request_url,approval.head_sha,
            allowlist.installation_id::text,run.status AS run_status,
            run.implementation_commit_sha,
            run.implementation_report->'independentVerification'->>'status' AS verification_status,
            approval.evidence_snapshot,
            attempt.id AS attempt_id,attempt.status AS attempt_status
       FROM approval_requests approval
       JOIN agent_runs run
         ON run.org_id=approval.org_id AND run.id=approval.agent_run_id
       JOIN github_repository_allowlists allowlist
         ON allowlist.org_id=approval.org_id
        AND allowlist.repository=approval.repository AND allowlist.active=true
       LEFT JOIN final_execution_attempts attempt
         ON attempt.org_id=approval.org_id AND attempt.approval_id=approval.id
      WHERE approval.org_id=$1 AND approval.id=$2
        AND approval.action_type='final_execution'`,
    [orgId, approvalId],
  );
  const row = result.rows[0];
  if (!row) throw new FinalExecutionError("Final execution approval was not found", 404);
  return row;
}

export async function approveFinalExecution(
  orgId: string,
  approvalId: string,
  actor: FinalExecutionActor,
): Promise<FinalExecutionApprovalView> {
  const level = await readAutonomyLevel(orgId);
  if (!autonomyCapabilities(level).requestAgentExecution) {
    throw new FinalExecutionError(
      `Final execution is disabled while Agent autonomy is set to ${level}.`,
      409,
    );
  }
  const candidate = await loadCandidate(orgId, approvalId);
  const retryingApprovedMerge =
    candidate.status === "Approved" && candidate.attempt_status === "Failed";
  if (candidate.status !== "Pending" && !retryingApprovedMerge)
    throw new FinalExecutionError("Final execution approval is no longer pending", 409);
  if (candidate.expires_at.getTime() <= Date.now()) {
    await databasePool().query(
      "UPDATE approval_requests SET status='Expired',updated_at=now() WHERE org_id=$1 AND id=$2 AND status='Pending'",
      [orgId, approvalId],
    );
    throw new FinalExecutionError("Final execution approval expired; review the current pull request again", 409);
  }
  if (
    candidate.run_status !== "Draft PR opened"
    || candidate.implementation_commit_sha !== candidate.head_sha
    || candidate.verification_status !== "passed"
  ) {
    throw new FinalExecutionError("The agent run is no longer ready for final execution", 409);
  }
  if (!finalExecutionScopeAllowsApproval(candidate.evidence_snapshot)) {
    throw new FinalExecutionError(
      "Final execution is locked because the PR changed a production surface outside the approved PDD verification contract",
      409,
    );
  }

  const attemptId = retryingApprovedMerge && candidate.attempt_id
    ? candidate.attempt_id
    : randomUUID();
  await transaction(async (client) => {
    if (retryingApprovedMerge) {
      const retried = await client.query(
        `UPDATE final_execution_attempts
            SET status='Queued',failure_message=NULL,started_at=NULL,completed_at=NULL
          WHERE org_id=$1 AND id=$2 AND status='Failed' RETURNING id`,
        [orgId, attemptId],
      );
      if (!retried.rowCount)
        throw new FinalExecutionError("The approved merge is already being retried", 409);
    } else {
      const consumed = await client.query(
        `UPDATE approval_requests
            SET status='Approved',consumed_at=now(),updated_at=now()
          WHERE org_id=$1 AND id=$2 AND action_type='final_execution'
            AND status='Pending' AND expires_at>now()
          RETURNING id`,
        [orgId, approvalId],
      );
      if (!consumed.rowCount)
        throw new FinalExecutionError("Final execution approval is no longer pending", 409);
      await client.query(
        `INSERT INTO final_execution_attempts(
           id,org_id,approval_id,agent_run_id,status,repository,
           pull_request_number,expected_head_sha
         ) VALUES($1,$2,$3,$4,'Queued',$5,$6,$7)`,
        [
          attemptId,
          orgId,
          approvalId,
          candidate.agent_run_id,
          candidate.repository,
          candidate.pull_request_number,
          candidate.head_sha,
        ],
      );
      await client.query(
        `INSERT INTO audit_events(
           id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
         ) VALUES($1,$2,$3,$4,$5,'ApprovalRequest',$6,$7)`,
        [
          randomUUID(),
          orgId,
          actor.actorId,
          actor.actorName,
          `Approved and queued merge of ${candidate.repository}#${candidate.pull_request_number} at ${candidate.head_sha}`,
          approvalId,
          `${actor.traceId}:final-execution-approved`,
        ],
      );
    }
  });

  const approval = await readFinalExecutionApproval(databasePool(), orgId, candidate.problem_id);
  if (!approval) throw new FinalExecutionError("Final execution approval could not be reloaded", 500);
  return approval;
}

interface QueuedExecution {
  id: string;
  org_id: string;
  approval_id: string;
  agent_run_id: string;
  repository: string;
  base_branch: string;
  pull_request_number: number;
  expected_head_sha: string;
  installation_id: string;
}

export async function processQueuedFinalExecutions(
  limit = 10,
  dependencies: GithubMergeDependencies = {},
): Promise<Array<{ attemptId: string; status: "Succeeded" | "Failed"; message?: string }>> {
  const results: Array<{ attemptId: string; status: "Succeeded" | "Failed"; message?: string }> = [];
  for (let index = 0; index < Math.max(0, Math.min(limit, 50)); index += 1) {
    const queued = await transaction(async (client) => {
      const claimed = await client.query<QueuedExecution>(
        `WITH candidate AS (
           SELECT attempt.id
             FROM final_execution_attempts attempt
            WHERE attempt.status='Queued'
            ORDER BY attempt.created_at,attempt.id
            FOR UPDATE SKIP LOCKED LIMIT 1
         )
         UPDATE final_execution_attempts attempt
            SET status='Running',started_at=now()
           FROM candidate,
                approval_requests approval,
                github_repository_allowlists allowlist
          WHERE attempt.id=candidate.id
            AND approval.org_id=attempt.org_id AND approval.id=attempt.approval_id
            AND allowlist.org_id=attempt.org_id
            AND allowlist.repository=attempt.repository
            AND allowlist.active=true
          RETURNING attempt.id,attempt.org_id,attempt.approval_id,attempt.agent_run_id,
                    attempt.repository,approval.base_branch,attempt.pull_request_number,
                    attempt.expected_head_sha,allowlist.installation_id::text`,
      );
      return claimed.rows[0] ?? null;
    });
    if (!queued) break;

    try {
      const merged = await mergeApprovedPullRequest(
        queued.installation_id,
        {
          repository: queued.repository,
          baseBranch: queued.base_branch,
          pullRequestNumber: queued.pull_request_number,
          expectedHeadSha: queued.expected_head_sha,
        },
        dependencies,
      );
      await transaction(async (client) => {
        await client.query(
          `UPDATE final_execution_attempts
              SET status='Succeeded',result_sha=$3,result_url=$4,completed_at=now()
            WHERE org_id=$1 AND id=$2 AND status='Running'`,
          [queued.org_id, queued.id, merged.sha, merged.url],
        );
        await client.query(
          `INSERT INTO audit_events(
             id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
           ) VALUES($1,$2,'github','GitHub',$3,'AgentRun',$4,$5)`,
          [randomUUID(), queued.org_id,
            `Merged ${queued.repository}#${queued.pull_request_number} as ${merged.sha}`,
            queued.agent_run_id, `release-execution:${queued.id}:succeeded`],
        );
      });
      results.push({ attemptId: queued.id, status: "Succeeded" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "GitHub merge failed";
      const invalidated = error instanceof FinalExecutionError
        && error.status === 409
        && /changed|target branch|no longer open/.test(message);
      await transaction(async (client) => {
        await client.query(
          `UPDATE final_execution_attempts
              SET status='Failed',failure_message=$3,completed_at=now()
            WHERE org_id=$1 AND id=$2 AND status='Running'`,
          [queued.org_id, queued.id, message.slice(0, 2_000)],
        );
        if (invalidated) {
          await client.query(
            `UPDATE approval_requests SET status='Superseded',updated_at=now()
              WHERE org_id=$1 AND id=$2 AND action_type='final_execution'`,
            [queued.org_id, queued.approval_id],
          );
        }
      });
      results.push({ attemptId: queued.id, status: "Failed", message });
    }
  }
  return results;
}

export async function rejectFinalExecution(
  orgId: string,
  approvalId: string,
  actor: FinalExecutionActor,
): Promise<FinalExecutionApprovalView> {
  const result = await transaction(async (client) => {
    const rejected = await client.query<{ problem_id: string }>(
      `UPDATE approval_requests SET status='Rejected',updated_at=now()
        WHERE org_id=$1 AND id=$2 AND action_type='final_execution' AND status='Pending'
        RETURNING problem_id`,
      [orgId, approvalId],
    );
    if (!rejected.rows[0])
      throw new FinalExecutionError("Final execution approval is no longer pending", 409);
    await client.query(
      `INSERT INTO audit_events(
         id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
       ) VALUES($1,$2,$3,$4,'Rejected final pull request execution','ApprovalRequest',$5,$6)`,
      [randomUUID(), orgId, actor.actorId, actor.actorName, approvalId, `${actor.traceId}:final-execution-rejected`],
    );
    return rejected.rows[0].problem_id;
  });
  const approval = await readFinalExecutionApproval(databasePool(), orgId, result);
  if (!approval) throw new FinalExecutionError("Final execution approval could not be reloaded", 500);
  return approval;
}
