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
import { issueResultChangesBlockExecution } from "./issue-result-review-repository";

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
  role?: string;
}

export class FinalExecutionError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export interface AgentMergeFollowUpInput {
  orgId: string;
  problemId: string;
  repository: string;
  pullRequestNumber: number;
  mergeSha: string | null;
}

/** Prepare affected-customer drafts after an approved agent PR merges. */
export async function prepareAgentMergeFollowUps(
  client: PoolClient,
  input: AgentMergeFollowUpInput,
): Promise<number> {
  const customers = await client.query<{ customer_name: string }>(
    `SELECT DISTINCT feedback.customer_name
       FROM feedback_cluster_memberships membership
       JOIN feedback_items feedback
         ON feedback.org_id=membership.org_id AND feedback.id=membership.feedback_id
      WHERE membership.org_id=$1 AND membership.problem_id=$2
        AND nullif(btrim(feedback.customer_name),'') IS NOT NULL
      ORDER BY feedback.customer_name`,
    [input.orgId, input.problemId],
  );
  let prepared = 0;
  for (const customer of customers.rows) {
    const inserted = await client.query(
      `INSERT INTO customer_notifications(
         id,org_id,problem_id,customer_name,status
       ) VALUES($1,$2,$3,$4,'Drafted')
       ON CONFLICT (org_id,problem_id,customer_name) DO NOTHING
       RETURNING id`,
      [randomUUID(), input.orgId, input.problemId, customer.customer_name],
    );
    prepared += inserted.rowCount ?? 0;
  }
  if (prepared > 0) {
    const action = `Prepared ${prepared} customer follow-up draft${prepared === 1 ? "" : "s"} after approved agent merge of ${input.repository}#${input.pullRequestNumber}`;
    await client.query(
      `INSERT INTO audit_events(
         id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
       ) VALUES($1,$2,'closespan_agent','CloseSpan agent',$3,'CustomerNotification',$4,$5)
       ON CONFLICT DO NOTHING`,
      [
        randomUUID(),
        input.orgId,
        action,
        input.problemId,
        `agent-merge-follow-up:${input.repository}:${input.pullRequestNumber}:${input.mergeSha ?? "pending-merge-sha"}`,
      ],
    );
    await client.query(
      "UPDATE workspaces SET version=version+1,updated_at=now() WHERE org_id=$1",
      [input.orgId],
    );
  }
  return prepared;
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
  tenki_review_required: boolean;
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
            run.implementation_commit_sha,run.tenki_review_required,
            run.implementation_report->'independentVerification'->>'status' AS verification_status,
            approval.evidence_snapshot,
            attempt.id AS attempt_id,attempt.status AS attempt_status
       FROM approval_requests approval
       JOIN agent_runs run
         ON run.org_id=approval.org_id AND run.id=approval.agent_run_id
       JOIN github_repository_allowlists allowlist
         ON allowlist.org_id=approval.org_id
        AND allowlist.repository=approval.repository
        AND allowlist.active=true AND allowlist.workspace_selected=true
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

async function assertExactHeadTenkiApproval(
  orgId: string,
  candidate: ApprovalCandidate,
): Promise<void> {
  if (!candidate.tenki_review_required) return;
  const approval = await databasePool().query(
    `SELECT 1
       FROM tenki_pr_review_cycles
      WHERE org_id=$1 AND repository=$2 AND pull_request_number=$3
        AND state='Approved' AND lower(head_sha_after)=lower($4)
      LIMIT 1`,
    [
      orgId,
      candidate.repository,
      candidate.pull_request_number,
      candidate.head_sha,
    ],
  );
  if (!approval.rowCount) {
    throw new FinalExecutionError(
      "Tenki has not approved the exact current pull request commit yet. Address the review or request Tenki review again before merging.",
      409,
    );
  }
}

export async function approveFinalExecution(
  orgId: string,
  approvalId: string,
  actor: FinalExecutionActor,
): Promise<FinalExecutionApprovalView> {
  if (actor.role !== "Admin" || !actor.actorId.trim() || actor.actorId.trim().toLowerCase().startsWith("system:")) {
    throw new FinalExecutionError("An authorized human administrator must approve every merge or deployment.", 403);
  }
  const level = await readAutonomyLevel(orgId);
  if (!autonomyCapabilities(level).requestAgentExecution) {
    throw new FinalExecutionError(
      `Final execution is disabled while Agent autonomy is set to ${level}.`,
      409,
    );
  }
  const candidate = await loadCandidate(orgId, approvalId);
  const reusingFailedAttempt = Boolean(candidate.attempt_id && candidate.attempt_status === "Failed");
  const retryingApprovedMerge = reusingFailedAttempt && ["Approved", "Expired"].includes(candidate.status);
  if (candidate.status !== "Pending" && !retryingApprovedMerge)
    throw new FinalExecutionError("Final execution approval is no longer pending", 409);
  if (candidate.expires_at.getTime() <= Date.now() && !reusingFailedAttempt) {
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
      "Final execution is locked because the PR changed a production surface outside the approved Prompt Testing verification contract",
      409,
    );
  }
  await assertExactHeadTenkiApproval(orgId, candidate);

  const attemptId = reusingFailedAttempt && candidate.attempt_id
    ? candidate.attempt_id
    : randomUUID();
  await transaction(async (client) => {
    // Share the result-review lock before consuming any final authority. A
    // concurrent changes request either wins first, or cancels the queued job.
    const lockedRun = await client.query<{ implementation_commit_sha: string; status: string }>(
      "SELECT implementation_commit_sha,status FROM agent_runs WHERE org_id=$1 AND problem_id=$2 AND id=$3 FOR UPDATE",
      [orgId, candidate.problem_id, candidate.agent_run_id],
    );
    if (lockedRun.rows[0]?.implementation_commit_sha !== candidate.head_sha || lockedRun.rows[0]?.status !== "Draft PR opened") {
      throw new FinalExecutionError("The implementation changed before final approval. Review it again.", 409);
    }
    if (await issueResultChangesBlockExecution(client, {
      orgId, problemId: candidate.problem_id, runId: candidate.agent_run_id, commitSha: candidate.head_sha,
    })) throw new FinalExecutionError("Human result review requested changes. Review the updated result before final execution.", 409);
    if (reusingFailedAttempt) {
      // This is a fresh human decision after failure or queue recovery. Expired
      // authority is renewed only after the immutable verification checks above.
      const consumed = await client.query(
        `UPDATE approval_requests approval
            SET status='Approved',consumed_at=now(),updated_at=now(),
                expires_at=CASE WHEN expires_at<=now() THEN now()+interval '24 hours' ELSE expires_at END
          WHERE approval.org_id=$1 AND approval.id=$2 AND approval.action_type='final_execution'
            AND approval.status IN ('Pending','Approved','Expired') AND approval.head_sha=$3
            AND EXISTS (SELECT 1 FROM final_execution_attempts attempt
              WHERE attempt.org_id=approval.org_id AND attempt.approval_id=approval.id
                AND attempt.id=$4 AND attempt.status='Failed' AND attempt.expected_head_sha=$3)
          RETURNING approval.id`,
        [orgId, approvalId, candidate.head_sha, attemptId],
      );
      if (!consumed.rowCount)
        throw new FinalExecutionError("The final execution changed before the fresh human approval; review it again", 409);
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
    }
    // Persist the human decision for both first approvals and retries. The worker
    // checks this receipt before executing, including for legacy queued attempts.
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
  problem_id: string;
  repository: string;
  base_branch: string;
  pull_request_number: number;
  expected_head_sha: string;
  installation_id: string;
}

interface QueuedExecutionCandidate extends Omit<QueuedExecution, "installation_id"> {
  installation_id: string | null;
  approval_status: FinalExecutionApprovalStatus;
  approval_expires_at: Date;
  approval_head_sha: string;
  has_current_human_approval: boolean;
}

type ClaimedFinalExecution =
  | { kind: "queued"; execution: QueuedExecution }
  | { kind: "blocked"; attemptId: string; message: string };

/** Claim or recover one row under the worker's existing bounded loop. */
async function claimFinalExecution(client: PoolClient): Promise<ClaimedFinalExecution | null> {
  const result = await client.query<QueuedExecutionCandidate>(
    `SELECT attempt.id,attempt.org_id,attempt.approval_id,attempt.agent_run_id,
            approval.problem_id,attempt.repository,approval.base_branch,attempt.pull_request_number,
            attempt.expected_head_sha,allowlist.installation_id::text,
            approval.status AS approval_status,approval.expires_at AS approval_expires_at,
            approval.head_sha AS approval_head_sha,
            EXISTS (
              SELECT 1 FROM audit_events decision
              JOIN workspace_members member
                ON member.org_id=decision.org_id AND member.id=decision.actor_id
               AND member.role='Admin'
              WHERE decision.org_id=attempt.org_id
                AND decision.entity_type='ApprovalRequest'
                AND decision.entity_id=attempt.approval_id
                AND lower(decision.actor_id) NOT LIKE 'system:%'
                AND decision.occurred_at>=approval.consumed_at
                AND decision.action='Approved and queued merge of ' || attempt.repository
                  || '#' || attempt.pull_request_number::text || ' at ' || attempt.expected_head_sha
            ) AS has_current_human_approval
       FROM final_execution_attempts attempt
       JOIN approval_requests approval
         ON approval.org_id=attempt.org_id AND approval.id=attempt.approval_id
       JOIN agent_runs run
         ON run.org_id=attempt.org_id AND run.id=attempt.agent_run_id AND run.problem_id=approval.problem_id
       LEFT JOIN github_repository_allowlists allowlist
         ON allowlist.org_id=attempt.org_id AND allowlist.repository=attempt.repository
        AND allowlist.active=true AND allowlist.workspace_selected=true
      WHERE attempt.status='Queued'
      ORDER BY attempt.created_at,attempt.id
      LIMIT 1 FOR UPDATE OF run,attempt SKIP LOCKED`,
  );
  const candidate = result.rows[0];
  if (!candidate) return null;
  // This runs after the row locks are acquired, with a fresh READ COMMITTED
  // snapshot, so a feedback transaction that won the run lock is visible.
  const changesRequested = await issueResultChangesBlockExecution(client, {
    orgId: candidate.org_id, problemId: candidate.problem_id,
    runId: candidate.agent_run_id, commitSha: candidate.expected_head_sha,
  });
  const headMatches = candidate.approval_head_sha === candidate.expected_head_sha;
  const message = changesRequested
    ? "Human result review requested changes. Scoped rework and a fresh final approval are required."
    : candidate.approval_status !== "Approved"
    ? "The final execution is not approved. A fresh human approval is required before merging."
    : !headMatches
      ? "The reviewed commit changed. A new verified approval is required before merging."
      : !candidate.has_current_human_approval
        ? "A fresh human approval is required: the queued merge has no matching decision from a current administrator."
        : candidate.approval_expires_at.getTime() <= Date.now()
          ? "A fresh human approval is required: the queued merge authorization expired."
          : !candidate.installation_id
            ? "Repository access changed. An administrator must restore access and provide a fresh human approval."
            : null;
  if (message) {
    await client.query(
      `UPDATE final_execution_attempts SET status='Failed',failure_message=$3,completed_at=now()
        WHERE org_id=$1 AND id=$2 AND status='Queued'`,
      [candidate.org_id, candidate.id, message],
    );
    // Reopen the decision, not the execution. Rejected/superseded approvals and
    // changed commits stay closed; old receipts cannot authorize the new window.
    if (!changesRequested && headMatches && ["Approved", "Pending", "Expired"].includes(candidate.approval_status)) {
      await client.query(
        `UPDATE approval_requests SET status='Pending',consumed_at=NULL,
            expires_at=now()+interval '24 hours',reason=$3,updated_at=now()
          WHERE org_id=$1 AND id=$2 AND action_type='final_execution'
            AND status IN ('Approved','Pending','Expired') AND head_sha=$4`,
        [candidate.org_id, candidate.approval_id, message, candidate.expected_head_sha],
      );
    }
    await client.query(
      `INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id)
       VALUES($1,$2,'system:final-execution-recovery','CloseSpan',$3,'ApprovalRequest',$4,$5)`,
      [randomUUID(), candidate.org_id, `Paused queued final execution: ${message}`,
        candidate.approval_id, `final-execution-recovery:${candidate.id}:${randomUUID()}`],
    );
    await client.query("UPDATE workspaces SET version=version+1,updated_at=now() WHERE org_id=$1", [candidate.org_id]);
    return { kind: "blocked", attemptId: candidate.id, message };
  }
  await client.query(
    `UPDATE final_execution_attempts SET status='Running',started_at=now()
      WHERE org_id=$1 AND id=$2 AND status='Queued'`,
    [candidate.org_id, candidate.id],
  );
  return { kind: "queued", execution: { ...candidate, installation_id: candidate.installation_id! } };
}

export async function processQueuedFinalExecutions(
  limit = 10,
  dependencies: GithubMergeDependencies = {},
): Promise<Array<{ attemptId: string; status: "Succeeded" | "Failed"; message?: string }>> {
  const results: Array<{ attemptId: string; status: "Succeeded" | "Failed"; message?: string }> = [];
  for (let index = 0; index < Math.max(0, Math.min(limit, 50)); index += 1) {
    const claimed = await transaction(claimFinalExecution);
    if (!claimed) break;
    if (claimed.kind === "blocked") {
      results.push({ attemptId: claimed.attemptId, status: "Failed", message: claimed.message });
      continue;
    }
    const queued = claimed.execution;

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
        await prepareAgentMergeFollowUps(client, {
          orgId: queued.org_id,
          problemId: queued.problem_id,
          repository: queued.repository,
          pullRequestNumber: queued.pull_request_number,
          mergeSha: merged.sha,
        });
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
