import { databasePool } from "./db";
import { feedback } from "./seed";
import { workspacePersistenceMode } from "./workspace-persistence";
import type { IssueCodeReviewStatus, IssueReport } from "./issue-lifecycle";

/** Read-only issue context. Every join is scoped to the signed-in workspace. */
export async function readIssueReports(orgId: string, problemId: string): Promise<IssueReport[]> {
  if (workspacePersistenceMode(orgId) === "memory") {
    return feedback.filter((item) => item.problemId === problemId).slice(0, 100).map(({ id, quote, source, customer }) => ({ id, quote, source, customer }));
  }
  const result = await databasePool().query<IssueReport>(
    `SELECT feedback.id,feedback.quote,feedback.source,feedback.customer_name AS customer
       FROM feedback_cluster_memberships membership
       JOIN feedback_items feedback
         ON feedback.org_id=membership.org_id AND feedback.id=membership.feedback_id
      WHERE membership.org_id=$1 AND membership.problem_id=$2
      ORDER BY feedback.created_at,feedback.id LIMIT 100`,
    [orgId, problemId],
  );
  return result.rows;
}

export async function readIssueCodeReview(orgId: string, problemId: string, runId: string): Promise<IssueCodeReviewStatus> {
  if (workspacePersistenceMode(orgId) === "memory") return null;
  const result = await databasePool().query<{ state: string }>(
    `SELECT review.state
       FROM agent_runs run
       JOIN tenki_pr_review_cycles review
         ON review.org_id=run.org_id AND review.problem_id=run.problem_id
        AND review.repository=run.repository
        AND (review.remediation_run_id=run.id
          OR (review.pull_request_number=run.pull_request_number
            AND run.implementation_commit_sha IS NOT NULL
            AND coalesce(review.head_sha_after,review.head_sha_before)=run.implementation_commit_sha))
      WHERE run.org_id=$1 AND run.problem_id=$2 AND run.id=$3
      ORDER BY review.created_at DESC,review.id DESC LIMIT 1`,
    [orgId, problemId, runId],
  );
  const state = result.rows[0]?.state;
  if (state === "Approved") return "Approved";
  if (state === "Blocked" || state === "Failed") return "Blocked";
  if (state === "Correction queued" || state === "Correction running") return "Improving";
  if (state === "Changes requested") return "Changes requested";
  if (state === "Review requested" || state === "Correction published") return "Review requested";
  return null;
}
