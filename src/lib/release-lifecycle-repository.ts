import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { databasePool, transaction } from "./db";
import {
  parseReleaseVerificationPlan,
  type UiVerificationBaseline,
} from "./release-verification-plan";

export interface GithubDeploymentPayload {
  repository?: { full_name?: unknown };
  deployment?: {
    id?: unknown;
    sha?: unknown;
    environment?: unknown;
    description?: unknown;
  };
  deployment_status?: {
    id?: unknown;
    state?: unknown;
    target_url?: unknown;
    environment?: unknown;
    description?: unknown;
    created_at?: unknown;
  };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function releaseStatus(value: unknown): "Pending" | "Running" | "Succeeded" | "Failed" | null {
  if (value === "success") return "Succeeded";
  if (value === "failure" || value === "error" || value === "inactive") return "Failed";
  if (value === "in_progress") return "Running";
  if (value === "pending" || value === "queued") return "Pending";
  return null;
}

export async function recordGithubDeploymentStatus(
  client: PoolClient,
  orgId: string,
  deliveryId: string,
  payload: GithubDeploymentPayload,
): Promise<string> {
  const repository = text(payload.repository?.full_name);
  const sha = text(payload.deployment?.sha);
  const environment = text(payload.deployment_status?.environment)
    ?? text(payload.deployment?.environment);
  const status = releaseStatus(payload.deployment_status?.state);
  if (!repository || !sha || !environment || !status)
    return "ignored_malformed_deployment_status";

  const binding = await client.query<{
    agent_run_id: string;
    problem_id: string;
    release_verification: string;
    evidence_snapshot: { uiBaseline?: UiVerificationBaseline | null } | null;
  }>(
    `SELECT attempt.agent_run_id,run.problem_id,specification.release_verification,
            approval.evidence_snapshot
       FROM final_execution_attempts attempt
       JOIN approval_requests approval
         ON approval.org_id=attempt.org_id AND approval.id=attempt.approval_id
       JOIN agent_runs run
         ON run.org_id=attempt.org_id AND run.id=attempt.agent_run_id
       JOIN engineering_ticket_specifications specification
         ON specification.org_id=run.org_id AND specification.problem_id=run.problem_id
      WHERE attempt.org_id=$1 AND attempt.repository=$2
        AND attempt.status='Succeeded'
        AND (attempt.result_sha=$3 OR attempt.expected_head_sha=$3)
      ORDER BY attempt.completed_at DESC LIMIT 1`,
    [orgId, repository, sha],
  );
  const run = binding.rows[0];
  if (!run) return "ignored_untracked_deployment";

  const eventId = randomUUID();
  const occurredAt = text(payload.deployment_status?.created_at);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO release_events(
       id,org_id,delivery_id,provider,agent_run_id,problem_id,environment,status,
       deployment_sha,deployment_url,description,occurred_at
     ) VALUES($1,$2,$3,'github',$4,$5,$6,$7,$8,$9,$10,coalesce($11::timestamptz,now()))
     ON CONFLICT(org_id,provider,delivery_id) DO NOTHING RETURNING id`,
    [eventId, orgId, deliveryId, run.agent_run_id, run.problem_id, environment,
      status, sha, text(payload.deployment_status?.target_url),
      text(payload.deployment_status?.description) ?? text(payload.deployment?.description),
      occurredAt],
  );
  if (!inserted.rowCount) return "duplicate_deployment_status";

  if (status === "Succeeded") {
    const targetUrl = text(payload.deployment_status?.target_url);
    const verificationPlan = parseReleaseVerificationPlan(run.release_verification);
    await client.query(
      `UPDATE product_problems SET stage='Released',updated_at=now()
        WHERE org_id=$1 AND id=$2
          AND stage IN ('Approved','Planned','In progress')`,
      [orgId, run.problem_id],
    );
    await client.query(
      `UPDATE engineering_ticket_specifications
          SET implementation_state='Released',updated_at=now()
        WHERE org_id=$1 AND problem_id=$2
          AND implementation_state<>'Verified'`,
      [orgId, run.problem_id],
    );
    await client.query(
      `INSERT INTO post_release_verification_jobs(
         id,org_id,release_event_id,agent_run_id,problem_id,status,environment,
         deployment_sha,verification_instructions,target_url,verification_plan,ui_baseline
       ) VALUES($1,$2,$3,$4,$5,'Queued',$6,$7,$8,$9,$10,$11)
       ON CONFLICT(org_id,release_event_id) DO NOTHING`,
      [randomUUID(), orgId, eventId, run.agent_run_id, run.problem_id,
        environment, sha, run.release_verification,targetUrl,
        JSON.stringify(verificationPlan),
        JSON.stringify(run.evidence_snapshot?.uiBaseline ?? null)],
    );
  }
  await client.query(
    `INSERT INTO audit_events(
       id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
     ) VALUES($1,$2,'github','GitHub',$3,'ProductProblem',$4,$5)`,
    [randomUUID(), orgId,
      `Deployment to ${environment} ${status.toLowerCase()} at ${sha}`,
      run.problem_id, `github-deployment:${deliveryId}`],
  );
  return status === "Succeeded"
    ? "tracked_deployment_succeeded_verification_queued"
    : `tracked_deployment_${status.toLowerCase()}`;
}

export async function completePostReleaseVerification(
  orgId: string,
  jobId: string,
  input: { status: "Passed" | "Failed"; evidence: string; result?: unknown },
): Promise<void> {
  if (!input.evidence.trim()) throw new Error("Verification evidence is required");
  await transaction(async (client) => {
    const job = await client.query<{
      problem_id: string;
      environment: string;
      status: string;
    }>(
      `UPDATE post_release_verification_jobs
          SET status=$3,evidence=$4,verification_result=$5,
              failure_message=CASE WHEN $3='Failed' THEN $4 ELSE NULL END,
              completed_at=now()
        WHERE org_id=$1 AND id=$2 AND status IN ('Queued','Running')
        RETURNING problem_id,environment,status`,
      [orgId, jobId, input.status, input.evidence.trim().slice(0, 10_000),
        JSON.stringify(input.result ?? null)],
    );
    const row = job.rows[0];
    if (!row) throw new Error("Release verification job is no longer pending");
    const specification = await client.query<{ id: string; revision: number }>(
      `SELECT id,revision FROM engineering_ticket_specifications
        WHERE org_id=$1 AND problem_id=$2 FOR UPDATE`,
      [orgId, row.problem_id],
    );
    const spec = specification.rows[0];
    if (!spec) throw new Error("Engineering specification was not found");
    await client.query(
      `INSERT INTO engineering_release_verifications(
         id,org_id,problem_id,specification_id,specification_revision,status,
         environment,evidence,verified_by
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'automated_release_verifier')`,
      [randomUUID(), orgId, row.problem_id, spec.id, spec.revision,
        input.status, row.environment, input.evidence.trim().slice(0, 10_000)],
    );
    if (input.status === "Passed") {
      await client.query(
        `UPDATE product_problems SET stage='Verified',updated_at=now()
          WHERE org_id=$1 AND id=$2 AND stage='Released'`,
        [orgId, row.problem_id],
      );
      await client.query(
        `UPDATE engineering_ticket_specifications SET implementation_state='Verified',updated_at=now()
          WHERE org_id=$1 AND problem_id=$2`,
        [orgId, row.problem_id],
      );
    }
    await client.query(
      `INSERT INTO audit_events(
         id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
       ) VALUES($1,$2,'release_verifier','Release verifier',$3,'ProductProblem',$4,$5)`,
      [randomUUID(), orgId, `Post-release verification ${input.status.toLowerCase()} in ${row.environment}`,
        row.problem_id, `release-verification:${jobId}`],
    );
  });
}

export async function claimPostReleaseVerificationExecution(
  orgId: string,
  jobId: string,
): Promise<"claimed" | "active" | "exhausted" | "terminal"> {
  const claimed = await databasePool().query(
    `UPDATE post_release_verification_jobs
        SET attempt_count=attempt_count+1,started_at=now()
      WHERE org_id=$1 AND id=$2 AND status='Running' AND expires_at>now()
        AND attempt_count<3
        AND (attempt_count=0 OR started_at<now()-interval '45 seconds')
      RETURNING id`,
    [orgId, jobId],
  );
  if (claimed.rowCount) return "claimed";
  const state = await databasePool().query<{ status: string; attempt_count: number; expires_at: Date }>(
    `SELECT status,attempt_count,expires_at FROM post_release_verification_jobs
      WHERE org_id=$1 AND id=$2`,
    [orgId, jobId],
  );
  const row = state.rows[0];
  if (!row || !["Queued", "Running"].includes(row.status)) return "terminal";
  if (row.attempt_count >= 3 || row.expires_at.getTime() <= Date.now()) return "exhausted";
  return "active";
}

export async function dispatchQueuedReleaseVerifications(limit = 10): Promise<{
  dispatched: number;
  skipped: boolean;
}> {
  const endpoint = process.env.RELEASE_VERIFIER_URL?.trim();
  const secret = process.env.RELEASE_VERIFIER_SHARED_SECRET?.trim();
  if (!endpoint || !secret) return { dispatched: 0, skipped: true };
  const jobs = await databasePool().query<{
    id: string;
    org_id: string;
    problem_id: string;
    environment: string;
    deployment_sha: string | null;
    verification_instructions: string;
    target_url: string | null;
    verification_plan: unknown;
    ui_baseline: unknown;
    agent_run_id: string;
    repository: string;
    expires_at: Date;
  }>(
    `UPDATE post_release_verification_jobs job
        SET status='Running',started_at=now()
       FROM agent_runs run
      WHERE job.id IN (
        SELECT id FROM post_release_verification_jobs
         WHERE status='Queued' ORDER BY queued_at FOR UPDATE SKIP LOCKED LIMIT $1
      )
        AND run.org_id=job.org_id AND run.id=job.agent_run_id
      RETURNING job.id,job.org_id,job.problem_id,job.environment,job.deployment_sha,job.verification_instructions,
        job.target_url,job.verification_plan,job.ui_baseline,job.agent_run_id,job.expires_at,
        run.repository`,
    [Math.max(1, Math.min(limit, 50))],
  );
  let dispatched = 0;
  for (const job of jobs.rows) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
        body: JSON.stringify({
          schemaVersion: 1,
          jobId: job.id,
          orgId: job.org_id,
        }),
      });
      if (!response.ok) throw new Error(`Verifier returned HTTP ${response.status}`);
      dispatched += 1;
    } catch (error) {
      await databasePool().query(
        `UPDATE post_release_verification_jobs
            SET status='Queued',started_at=NULL,failure_message=$3
          WHERE org_id=$1 AND id=$2 AND status='Running'`,
        [job.org_id, job.id, error instanceof Error ? error.message.slice(0, 2_000) : "Dispatch failed"],
      );
    }
  }
  return { dispatched, skipped: false };
}

export async function getReleaseVerifierJob(orgId: string, jobId: string): Promise<unknown> {
  const result = await databasePool().query<{
    id: string; org_id: string; problem_id: string; agent_run_id: string;
    repository: string; environment: string; deployment_sha: string | null;
    approved_head_sha: string;
    target_url: string | null; verification_instructions: string;
    verification_plan: unknown; ui_baseline: unknown; expires_at: Date;
  }>(
    `SELECT job.id,job.org_id,job.problem_id,job.agent_run_id,run.repository,
            approval.head_sha AS approved_head_sha,
            job.environment,job.deployment_sha,job.target_url,
            job.verification_instructions,job.verification_plan,job.ui_baseline,
            job.expires_at
       FROM post_release_verification_jobs job
       JOIN agent_runs run ON run.org_id=job.org_id AND run.id=job.agent_run_id
       JOIN approval_requests approval
         ON approval.org_id=job.org_id AND approval.agent_run_id=job.agent_run_id
        AND approval.action_type='final_execution'
      WHERE job.org_id=$1 AND job.id=$2 AND job.status='Running'`,
    [orgId, jobId],
  );
  const job = result.rows[0];
  if (!job || !job.deployment_sha) throw new Error("Release verification job is not runnable");
  let environmentUrls: Record<string, string> = {};
  try {
    environmentUrls = JSON.parse(process.env.RELEASE_ENVIRONMENT_URLS ?? "{}") as Record<string, string>;
  } catch {
    throw new Error("RELEASE_ENVIRONMENT_URLS must be valid JSON");
  }
  const baseUrl = environmentUrls[job.environment] ?? job.target_url;
  const callbackBase = process.env.RELEASE_VERIFIER_CALLBACK_BASE_URL?.replace(/\/$/, "")
    ?? process.env.CLOSESPAN_INTERNAL_BASE_URL?.replace(/\/$/, "");
  if (!baseUrl) throw new Error(`No release verification URL is configured for ${job.environment}`);
  if (!callbackBase) throw new Error("Release verifier callback base URL is not configured");
  return {
    schemaVersion: 1,
    jobId: job.id,
    orgId: job.org_id,
    problemId: job.problem_id,
    agentRunId: job.agent_run_id,
    repository: job.repository,
    environment: job.environment,
    deploymentSha: job.deployment_sha,
    approvedHeadSha: job.approved_head_sha,
    baseUrl,
    verificationInstructions: job.verification_instructions,
    plan: job.verification_plan,
    baseline: job.ui_baseline,
    callbackUrl: `${callbackBase}/api/internal/release-verifications/${job.id}`,
    expiresAt: job.expires_at.toISOString(),
  };
}
