import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

export interface TenkiReviewComment {
  id: number;
  body: string;
  path: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
}

export interface TenkiPullRequestReview {
  repository: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  pullRequestBaseBranch: string;
  headRef: string;
  headSha: string;
  reviewId: number;
  reviewerLogin: string;
  state: "approved" | "changes_requested";
  body: string;
  comments: TenkiReviewComment[];
}

export interface QueuedTenkiRemediation {
  orgId: string;
  runId: string;
}

export interface TenkiReviewAutomationResult {
  outcome: string;
  queuedRun?: QueuedTenkiRemediation;
}

interface TrackedRunRow {
  id: string;
  problem_id: string;
  prompt_revision_id: string;
  approval_id: string;
  repository: string;
  branch_name: string;
  prompt_hash: string;
  pdd_verification_id: string;
  execution_profile_id: string;
  execution_profile_hash: string;
  execution_profile_snapshot: unknown;
  prompt_commit_sha: string | null;
  implementation_commit_sha: string;
  parent_run_id: string | null;
  allowed_capabilities: unknown;
}

const DEFAULT_REVIEWER_LOGIN = "tenki-reviewer";
const DEFAULT_MAX_CYCLES = 3;

export function trustedTenkiReviewerLogin(): string {
  return process.env.TENKI_REVIEWER_LOGIN?.trim() || DEFAULT_REVIEWER_LOGIN;
}

export function isTrustedTenkiReviewer(login: string): boolean {
  return login.trim().toLowerCase() === trustedTenkiReviewerLogin().toLowerCase();
}

function maximumReviewCycles(): number {
  const configured = Number(process.env.TENKI_REVIEW_MAX_CYCLES ?? DEFAULT_MAX_CYCLES);
  return Number.isSafeInteger(configured) && configured >= 1 && configured <= 10
    ? configured
    : DEFAULT_MAX_CYCLES;
}

function text(value: string, max: number): string {
  return value.trim().slice(0, max);
}

export function reviewInstructions(review: TenkiPullRequestReview): string {
  const findings = review.comments.slice(0, 100).map((comment, index) => {
    const location = `${text(comment.path, 500)}${comment.line ? `:${comment.line}` : ""}`;
    return [
      `Finding ${index + 1} (GitHub comment ${comment.id})`,
      `Location: ${location}`,
      text(comment.body, 4_000),
    ].join("\n");
  });
  const summary = text(review.body, 8_000);
  return [
    `Tenki review ${review.reviewId} requested changes on PR #${review.pullRequestNumber}.`,
    summary ? `Review summary:\n${summary}` : "Review summary: no separate summary was provided.",
    findings.length ? findings.join("\n\n") : "No inline comments were returned; address the review summary only.",
  ].join("\n\n").slice(0, 50_000);
}

function normalizedCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

async function audit(
  client: PoolClient,
  orgId: string,
  action: string,
  entityId: string,
  reviewId: number,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id)
     VALUES($1,$2,$3,$4,$5,'TenkiPrReview',$6,$7)
     ON CONFLICT(org_id,trace_id,action) DO NOTHING`,
    [
      randomUUID(),
      orgId,
      trustedTenkiReviewerLogin(),
      "Tenki reviewer",
      action,
      entityId,
      `tenki_review_${reviewId}`,
    ],
  );
}

export async function processTenkiPullRequestReview(
  client: PoolClient,
  orgId: string,
  review: TenkiPullRequestReview,
): Promise<TenkiReviewAutomationResult> {
  if (!isTrustedTenkiReviewer(review.reviewerLogin)) {
    return { outcome: "ignored_untrusted_pr_reviewer" };
  }

  const duplicate = await client.query(
    `SELECT state FROM tenki_pr_review_cycles
      WHERE org_id=$1 AND repository=$2 AND pull_request_number=$3 AND review_id=$4`,
    [orgId, review.repository, review.pullRequestNumber, review.reviewId],
  );
  if (duplicate.rowCount) return { outcome: "duplicate_tenki_pr_review" };

  const tracked = await client.query<TrackedRunRow>(
    `SELECT run.id,run.problem_id,run.prompt_revision_id,run.approval_id,
            run.repository,run.branch_name,run.prompt_hash,run.pdd_verification_id,
            run.execution_profile_id,run.execution_profile_hash,run.execution_profile_snapshot,
            run.prompt_commit_sha,run.implementation_commit_sha,run.parent_run_id,
            approval.allowed_capabilities
       FROM agent_runs run
       JOIN approval_requests approval
         ON approval.org_id=run.org_id AND approval.id=run.approval_id
      WHERE run.org_id=$1 AND run.repository=$2 AND run.pull_request_number=$3
        AND run.status='Draft PR opened'
      ORDER BY run.review_cycle DESC NULLS LAST,run.queued_at DESC
      LIMIT 1 FOR UPDATE OF run`,
    [orgId, review.repository, review.pullRequestNumber],
  );
  const source = tracked.rows[0];
  if (!source) return { outcome: "ignored_untracked_tenki_pr_review" };
  if (source.branch_name !== review.headRef) {
    return { outcome: "ignored_tenki_review_for_untracked_head" };
  }
  if (!source.implementation_commit_sha || source.implementation_commit_sha.toLowerCase() !== review.headSha.toLowerCase()) {
    return { outcome: "ignored_stale_tenki_pr_review" };
  }

  const prior = await client.query<{ cycles: string; active: boolean }>(
    `SELECT count(*) FILTER (WHERE remediation_run_id IS NOT NULL)::text AS cycles,
            bool_or(state IN ('Correction queued','Correction running','Correction published')) AS active
       FROM tenki_pr_review_cycles
      WHERE org_id=$1 AND repository=$2 AND pull_request_number=$3`,
    [orgId, review.repository, review.pullRequestNumber],
  );
  const cycle = Number(prior.rows[0]?.cycles ?? 0) + 1;
  const rootRunId = source.parent_run_id ?? source.id;
  const cycleId = randomUUID();
  const commentIds = review.comments.map((comment) => comment.id);

  if (review.state === "approved") {
    await client.query(
      `INSERT INTO tenki_pr_review_cycles(
         id,org_id,problem_id,root_run_id,repository,pull_request_number,review_id,cycle,
         state,reviewer_login,review_body,comment_ids,head_sha_before,head_sha_after,completed_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'Approved',$9,$10,$11,$12,$12,now())`,
      [cycleId, orgId, source.problem_id, rootRunId, review.repository, review.pullRequestNumber,
        review.reviewId, Math.min(cycle, 20), review.reviewerLogin, text(review.body, 50_000),
        JSON.stringify(commentIds), review.headSha],
    );
    await audit(client, orgId, `Tenki approved PR #${review.pullRequestNumber}`, cycleId, review.reviewId);
    return { outcome: "tenki_pr_review_approved" };
  }

  if (prior.rows[0]?.active) return { outcome: "ignored_tenki_review_while_correction_active" };
  if (cycle > maximumReviewCycles()) {
    await client.query(
      `INSERT INTO tenki_pr_review_cycles(
         id,org_id,problem_id,root_run_id,repository,pull_request_number,review_id,cycle,
         state,reviewer_login,review_body,comment_ids,head_sha_before,failure_message,completed_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'Blocked',$9,$10,$11,$12,$13,now())`,
      [cycleId, orgId, source.problem_id, rootRunId, review.repository, review.pullRequestNumber,
        review.reviewId, Math.min(cycle, 20), review.reviewerLogin, text(review.body, 50_000),
        JSON.stringify(commentIds), review.headSha, `Automatic correction limit of ${maximumReviewCycles()} reached`],
    );
    await audit(client, orgId, `Tenki correction limit reached for PR #${review.pullRequestNumber}`, cycleId, review.reviewId);
    return { outcome: "tenki_pr_review_correction_limit_reached" };
  }

  // A trusted changes-requested review invalidates the exact-head merge approval
  // immediately. The correction run creates a fresh approval for its new head.
  await client.query(
    `UPDATE approval_requests
        SET status='Superseded',updated_at=now()
      WHERE org_id=$1 AND action_type='final_execution' AND status='Pending'
        AND repository=$2 AND pull_request_number=$3 AND head_sha=$4`,
    [orgId, review.repository, review.pullRequestNumber, review.headSha],
  );

  const approvalId = `apr_tenki_${randomUUID().replaceAll("-", "")}`;
  const remediationRunId = randomUUID();
  const instructions = reviewInstructions(review);
  const capabilities = normalizedCapabilities(source.allowed_capabilities);
  await client.query(
    `INSERT INTO approval_requests(
       id,org_id,problem_id,recommendation_id,action,reason,confidence,systems,data_shared,
       reversible,risk,status,action_type,prompt_revision_id,prompt_hash,repository,base_branch,
       base_sha,allowed_capabilities,expires_at,consumed_at,pdd_verification_id,
       execution_profile_id,execution_profile_hash,execution_profile_snapshot
     ) VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,true,'Medium','Approved','agent_run',$9,$10,$11,$12,
       $13,$14,now()+interval '30 minutes',now(),$15,$16,$17,$18)`,
    [approvalId, orgId, source.problem_id, `tenki-review:${review.reviewId}`,
      `Correct trusted Tenki review findings on PR #${review.pullRequestNumber}`,
      "Derived from the existing human-approved prompt and acceptance contract; scope and capabilities are unchanged.",
      JSON.stringify(["Tenki reviewer", "GitHub"]),
      JSON.stringify(["Trusted review summary", "Inline review comments", "Existing approved prompt"]),
      source.prompt_revision_id, source.prompt_hash, source.repository, review.headRef, review.headSha,
      JSON.stringify(capabilities), source.pdd_verification_id, source.execution_profile_id,
      source.execution_profile_hash, JSON.stringify(source.execution_profile_snapshot)],
  );
  await client.query(
    `INSERT INTO agent_runs(
       id,org_id,problem_id,prompt_revision_id,approval_id,status,repository,base_branch,base_sha,
       branch_name,prompt_hash,pdd_verification_id,execution_profile_id,execution_profile_hash,
       execution_profile_snapshot,run_kind,parent_run_id,review_cycle,review_id,review_instructions,
       review_comment_ids,pull_request_number,pull_request_url,prompt_commit_sha,pull_request_base_branch
     ) VALUES($1,$2,$3,$4,$5,'Queued',$6,$7,$8,$7,$9,$10,$11,$12,$13,
       'tenki_review_remediation',$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
    [remediationRunId, orgId, source.problem_id, source.prompt_revision_id, approvalId,
      source.repository, review.headRef, review.headSha, source.prompt_hash, source.pdd_verification_id,
      source.execution_profile_id, source.execution_profile_hash, JSON.stringify(source.execution_profile_snapshot),
      rootRunId, cycle, review.reviewId, instructions, JSON.stringify(commentIds),
      review.pullRequestNumber, review.pullRequestUrl, source.prompt_commit_sha,
      review.pullRequestBaseBranch],
  );
  await client.query(
    `INSERT INTO tenki_pr_review_cycles(
       id,org_id,problem_id,root_run_id,remediation_run_id,repository,pull_request_number,
       review_id,cycle,state,reviewer_login,review_body,comment_ids,head_sha_before
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'Correction queued',$10,$11,$12,$13)`,
    [cycleId, orgId, source.problem_id, rootRunId, remediationRunId, review.repository,
      review.pullRequestNumber, review.reviewId, cycle, review.reviewerLogin,
      text(review.body, 50_000), JSON.stringify(commentIds), review.headSha],
  );
  await client.query(
    `UPDATE engineering_ticket_specifications
        SET implementation_state='Running',updated_at=now()
      WHERE org_id=$1 AND problem_id=$2`,
    [orgId, source.problem_id],
  );
  await audit(client, orgId, `Queued autonomous Tenki review correction ${cycle} for PR #${review.pullRequestNumber}`, cycleId, review.reviewId);
  return {
    outcome: "tenki_pr_review_correction_queued",
    queuedRun: { orgId, runId: remediationRunId },
  };
}
