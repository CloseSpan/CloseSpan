import { databasePool } from "./db";
import {
  getEngineeringWorkflow,
  type EngineeringWorkflowView,
} from "./engineering-workflow-repository";
import type {
  IssueRuntimeVerificationOutcome,
  IssueRuntimeVerificationRunStatus,
} from "./issue-runtime-verification";
import { feedback, primaryProblem } from "./seed";
import { workspacePersistenceMode } from "./workspace-persistence";

export interface IssueWorkspaceVerification {
  label: string;
  summary: string;
  state: "passed" | "failed" | "pending";
  kind: "confirmed_bug" | "feature_gap" | "confirmed_issue" | "not_reproduced" | "blocked" | "pending" | "stale";
  repository: string;
  commitSha: string;
  completedAt: string | null;
}

export interface IssueWorkspaceContext {
  reportCount: number;
  sources: string[];
  summary: string;
  verification: IssueWorkspaceVerification | null;
  criteria: Array<{ id: string; statement: string }>;
}

interface ContextRow {
  summary: string;
  report_count: number | string;
  sources: string[] | null;
  report_types: string[] | null;
  investigation_id: string | null;
  runtime_id: string | null;
  runtime_investigation_id: string | null;
  runtime_status: IssueRuntimeVerificationRunStatus | null;
  runtime_outcome: IssueRuntimeVerificationOutcome | null;
  runtime_repository: string | null;
  runtime_base_sha: string | null;
  runtime_summary: string | null;
  runtime_failure_message: string | null;
  runtime_completed_at: Date | string | null;
  runtime_binding_current: boolean;
  newer_repository_commit: boolean;
}

function count(value: number | string): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function strings(value: string[] | null): string[] {
  return [...new Set((value ?? []).map((item) => item.trim()).filter(Boolean))].sort();
}

function completedAt(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function knownSha(value: string | undefined | null): string | null {
  return value && /^[a-f0-9]{40}$/i.test(value) && !/^0{40}$/.test(value)
    ? value.toLowerCase()
    : null;
}

function projectVerification(
  row: ContextRow,
  workflow: EngineeringWorkflowView | null,
): IssueWorkspaceVerification | null {
  if (!row.runtime_id) return null;
  const binding = {
    repository: row.runtime_repository ?? "",
    commitSha: row.runtime_base_sha ?? "",
    completedAt: completedAt(row.runtime_completed_at),
  };
  const specification = workflow?.specification;
  const currentSha = knownSha(specification?.baseSha);
  const runtimeSha = knownSha(row.runtime_base_sha);
  const stale = !row.runtime_binding_current
    || !row.investigation_id
    || row.runtime_investigation_id !== row.investigation_id
    || !runtimeSha
    || row.newer_repository_commit
    || Boolean(specification?.repository && specification.repository !== binding.repository)
    || Boolean(currentSha && currentSha !== runtimeSha);
  if (stale) {
    return {
      ...binding, kind: "stale", label: "Verification outdated", state: "pending",
      summary: "This verification belongs to an earlier issue or repository context. Verify the current context.",
    };
  }
  if (row.runtime_status === "Queued" || row.runtime_status === "Running") {
    return {
      ...binding, kind: "pending", label: row.runtime_status === "Queued" ? "Verification queued" : "Verifying issue", state: "pending",
      summary: row.runtime_status === "Queued"
        ? "Verification is waiting to start."
        : "Verification is running; no outcome has been recorded yet.",
    };
  }
  if (row.runtime_status === "Failed" || row.runtime_outcome === "Verification blocked") {
    return {
      ...binding, kind: "blocked", label: "Verification blocked", state: "failed",
      summary: row.runtime_failure_message?.trim() || row.runtime_summary?.trim() || "Verification could not reach a conclusion.",
    };
  }
  if (row.runtime_status !== "Completed" || !binding.completedAt || !row.runtime_summary?.trim()) {
    return {
      ...binding, kind: "pending", label: "Verification needed", state: "pending",
      summary: "A completed verification result is not available for this context.",
    };
  }
  if (row.runtime_outcome === "Not reproduced") {
    return {
      ...binding, kind: "not_reproduced", label: "Not reproduced", state: "failed",
      summary: row.runtime_summary.trim(),
    };
  }
  if (row.runtime_outcome !== "Confirmed current") return null;
  const types = strings(row.report_types);
  // Feedback classifies the issue; only a completed runtime outcome confirms it.
  const featureGap = types.length > 0 && types.every((type) => type === "Feature request");
  const bug = types.length > 0 && types.every((type) => type === "Bug" || type === "Incident");
  return {
    ...binding,
    kind: featureGap ? "feature_gap" : bug ? "confirmed_bug" : "confirmed_issue",
    label: featureGap ? "Feature gap confirmed" : bug ? "Bug confirmed" : "Issue confirmed",
    state: "passed",
    summary: row.runtime_summary.trim(),
  };
}

function criteria(workflow: EngineeringWorkflowView | null, problemId: string): IssueWorkspaceContext["criteria"] {
  if (workflow?.problemId !== problemId) return [];
  return (workflow.specification?.acceptanceCriteria ?? [])
    .filter((criterion) => criterion.id.trim() && criterion.statement.trim())
    .map(({ id, statement }) => ({ id, statement }));
}

/** All linked reports, without the overview's date window or the report panel's limit. */
export async function readIssueReportCounts(orgId: string): Promise<Record<string, number>> {
  if (workspacePersistenceMode(orgId) === "memory") {
    const totals: Record<string, number> = {};
    for (const item of feedback) {
      if (item.problemId) totals[item.problemId] = (totals[item.problemId] ?? 0) + 1;
    }
    return totals;
  }
  const result = await databasePool().query<{ problem_id: string; report_count: number | string }>(
    `SELECT membership.problem_id,count(DISTINCT feedback.id)::int AS report_count
       FROM feedback_cluster_memberships membership
       JOIN feedback_items feedback
         ON feedback.org_id=membership.org_id AND feedback.id=membership.feedback_id
       JOIN product_problems problem
         ON problem.org_id=membership.org_id AND problem.id=membership.problem_id
      WHERE membership.org_id=$1
      GROUP BY membership.problem_id`,
    [orgId],
  );
  return Object.fromEntries(result.rows.map((row) => [row.problem_id, count(row.report_count)]));
}

/**
 * Read-only projection: no reconciliation, provider requests, or verification starts.
 * A caller that already loaded the engineering workflow can pass it as argument 3.
 * Stored normalized outcomes are used; provider report blobs and confidence are not.
 */
export async function readIssueWorkspaceContext(
  orgId: string,
  problemId: string,
  existingWorkflow?: EngineeringWorkflowView | null,
): Promise<IssueWorkspaceContext> {
  if (workspacePersistenceMode(orgId) === "memory") {
    const linked = feedback.filter((item) => item.problemId === problemId);
    const workflow = existingWorkflow === undefined
      ? await getEngineeringWorkflow(orgId, problemId)
      : existingWorkflow;
    return {
      reportCount: linked.length,
      sources: strings(linked.map((item) => item.source)),
      summary: problemId === primaryProblem.id ? primaryProblem.summary : "",
      verification: null,
      criteria: criteria(workflow, problemId),
    };
  }
  const result = await databasePool().query<ContextRow>(
    `SELECT problem.summary,reports.report_count,reports.sources,reports.report_types,
            investigation.id AS investigation_id,
            runtime.id AS runtime_id,runtime.investigation_id AS runtime_investigation_id,
            runtime.status AS runtime_status,runtime.outcome AS runtime_outcome,
            runtime.repository AS runtime_repository,runtime.base_sha AS runtime_base_sha,
            runtime.summary AS runtime_summary,runtime.failure_message AS runtime_failure_message,
            runtime.completed_at AS runtime_completed_at,
            EXISTS (
              SELECT 1 FROM problem_repository_matches match
              JOIN github_repository_allowlists allowlist
                ON allowlist.org_id=match.org_id AND allowlist.repository=match.repository
               AND allowlist.active=true AND allowlist.workspace_selected=true
              JOIN execution_profile_assignments assignment
                ON assignment.org_id=match.org_id AND assignment.repository=match.repository
               AND assignment.workspace_root=match.workspace_root
               AND assignment.active_profile_id=match.profile_id
               AND assignment.active_profile_hash=match.profile_hash
              JOIN execution_profile_versions profile
                ON profile.org_id=match.org_id AND profile.id=match.profile_id
               AND profile.content_hash=match.profile_hash AND profile.source IN ('confirmed','override')
              WHERE match.org_id=problem.org_id AND match.problem_id=problem.id
                AND match.status='Confirmed' AND match.repository=runtime.repository
                AND match.workspace_root=runtime.workspace_root
                AND match.profile_id=runtime.execution_profile_id
                AND match.profile_hash=runtime.execution_profile_hash
            ) AS runtime_binding_current,
            EXISTS (
              SELECT 1 FROM repository_context_snapshots snapshot
               WHERE snapshot.org_id=problem.org_id AND snapshot.repository=runtime.repository
                 AND snapshot.default_branch=runtime.base_branch AND snapshot.status='Ready'
                 AND snapshot.started_at>runtime.requested_at
                 AND snapshot.commit_sha<>runtime.base_sha
            ) AS newer_repository_commit
       FROM product_problems problem
       LEFT JOIN LATERAL (
         SELECT count(DISTINCT feedback.id)::int AS report_count,
                array_agg(DISTINCT feedback.source) AS sources,
                array_agg(DISTINCT feedback.type) AS report_types
           FROM feedback_cluster_memberships membership
           JOIN feedback_items feedback
             ON feedback.org_id=membership.org_id AND feedback.id=membership.feedback_id
          WHERE membership.org_id=problem.org_id AND membership.problem_id=problem.id
       ) reports ON true
       LEFT JOIN LATERAL (
         SELECT candidate.id FROM investigations candidate
          WHERE candidate.org_id=problem.org_id AND candidate.problem_id=problem.id
          ORDER BY candidate.updated_at DESC,candidate.id LIMIT 1
       ) investigation ON true
       LEFT JOIN LATERAL (
         SELECT candidate.* FROM issue_runtime_verification_runs candidate
          WHERE candidate.org_id=problem.org_id AND candidate.problem_id=problem.id
          ORDER BY candidate.requested_at DESC,candidate.id DESC LIMIT 1
       ) runtime ON true
      WHERE problem.org_id=$1 AND problem.id=$2`,
    [orgId, problemId],
  );
  const row = result.rows[0];
  if (!row) return { reportCount: 0, sources: [], summary: "", verification: null, criteria: [] };
  const loadedWorkflow = existingWorkflow === undefined
    ? await getEngineeringWorkflow(orgId, problemId)
    : existingWorkflow;
  const workflow = loadedWorkflow?.problemId === problemId ? loadedWorkflow : null;
  return {
    reportCount: count(row.report_count),
    sources: strings(row.sources),
    summary: row.summary.trim(),
    verification: projectVerification(row, workflow),
    criteria: criteria(workflow, problemId),
  };
}
