import { randomUUID } from "node:crypto";
import { databasePool, transaction } from "./db";
import { detectRunFindings, type RunFinding } from "./agent-run-findings";
import { listAgentRuns } from "./engineering-workflow-repository";
import { HttpError, type RequestContext } from "./request-security";
import { workspacePersistenceMode } from "./workspace-persistence";

export async function readFindingIssueLinks(orgId: string): Promise<{ ready: boolean; links: Record<string, string> }> {
  if (workspacePersistenceMode(orgId) !== "postgres") return { ready: false, links: {} };
  try {
    const result = await databasePool().query<{ fingerprint: string; problem_id: string }>(
      "SELECT fingerprint,problem_id FROM agent_run_finding_issues WHERE org_id=$1", [orgId],
    );
    return { ready: true, links: Object.fromEntries(result.rows.map((row) => [row.fingerprint, row.problem_id])) };
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "42P01") return { ready: false, links: {} };
    throw error;
  }
}

function evidenceSummary(finding: RunFinding): string {
  return [finding.title, finding.explanation,
    `${finding.runIds.length} affected run(s) in the latest 100 runs. First observed: ${finding.firstSeen}. Last observed: ${finding.lastSeen}.`,
    `Source issue: ${finding.sourceProblemId}. Runs: ${finding.runIds.join(", ")}.`,
    `Recommended next step: ${finding.nextStep}`, "Rule-based finding; root cause is not independently established.",
  ].join("\n\n");
}

/** Browser supplies only the fingerprint. Evidence and tenancy are reloaded on the server. */
export async function createFindingIssue(context: RequestContext, fingerprint: string) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new HttpError(400, "Invalid finding");
  if (workspacePersistenceMode(context.orgId) !== "postgres") throw new HttpError(409, "Issue creation requires a database-backed workspace.");
  const finding = detectRunFindings(await listAgentRuns(context.orgId)).find((item) => item.id === fingerprint);
  if (!finding) throw new HttpError(404, "Finding is no longer in the recent run history.");
  if (finding.resolved) throw new HttpError(409, "A later successful run has superseded this finding. Refresh Agent Activity.");
  return transaction(async (client) => {
    // Serialize concurrent clicks, retries, and different callers within this tenant.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${context.orgId}:finding:${fingerprint}`]);
    const existing = await client.query<{ problem_id: string }>(
      "SELECT problem_id FROM agent_run_finding_issues WHERE org_id=$1 AND fingerprint=$2", [context.orgId, fingerprint],
    );
    const problemId = existing.rows[0]?.problem_id ?? `prob_${randomUUID().replaceAll("-", "")}`;
    const summary = evidenceSummary(finding);
    if (!existing.rows[0]) {
      await client.query(`INSERT INTO product_problems
        (id,org_id,title,statement,summary,stage,severity,confidence,product_area,team,churn_risk,suspected_repository,suspected_files,impact_factors)
        VALUES($1,$2,$3,$4,$4,'Needs review','Medium',1,'Agent execution','Unassigned',0,$5,'[]','[]')`,
      [problemId, context.orgId, finding.title, summary, finding.repository ?? "Not yet identified"]);
    }
    // Store fresh evidence separately so repeated reports never overwrite edited
    // issue text, reopen a closed issue, or authorize an implementation.
    await client.query(`INSERT INTO agent_run_finding_issues(org_id,fingerprint,problem_id,evidence)
      VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(org_id,fingerprint) DO UPDATE
      SET evidence=EXCLUDED.evidence,updated_at=now()`, [context.orgId, fingerprint, problemId, JSON.stringify(finding)]);
    await client.query(`INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id)
      VALUES($1,$2,$3,$4,$5,'product_problem',$6,$7) ON CONFLICT(org_id,trace_id,action) DO NOTHING`,
    [randomUUID(), context.orgId, context.actorId, context.actorName, "agent_finding.issue_linked", problemId, context.traceId]);
    return { problemId, created: !existing.rows[0] };
  });
}

/** Linked issues show the latest observed evidence without rewriting user edits. */
export async function readIssueRunFinding(orgId: string, problemId: string): Promise<RunFinding | null> {
  if (workspacePersistenceMode(orgId) !== "postgres") return null;
  try {
    const result = await databasePool().query<{ fingerprint: string; evidence: RunFinding }>(
      "SELECT fingerprint,evidence FROM agent_run_finding_issues WHERE org_id=$1 AND problem_id=$2", [orgId, problemId],
    );
    const saved = result.rows[0];
    if (!saved) return null;
    const current = detectRunFindings(await listAgentRuns(orgId)).find((finding) => finding.id === saved.fingerprint);
    return current ?? saved.evidence;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "42P01") return null;
    throw error;
  }
}
