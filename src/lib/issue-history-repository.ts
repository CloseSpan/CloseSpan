import { databasePool } from "./db";
import type { AuditEvent } from "./domain";
import type { DemoState } from "./store";
import { workspacePersistenceMode } from "./workspace-persistence";

function relatedToIssue(event: AuditEvent, problemId: string, entityIds: Set<string>): boolean {
  return entityIds.has(event.entityId) || event.traceId.includes(problemId);
}

/**
 * Audit events about one issue: the issue itself, its legacy approval and
 * work item when it has a workflow, and events traced to its id.
 */
export async function listIssueHistory(orgId: string, problemId: string, workflow: DemoState | null): Promise<AuditEvent[]> {
  const entityIds = new Set([problemId, workflow?.approval.id, workflow?.workItem?.id].filter((id): id is string => Boolean(id)));
  if (workflow) return workflow.audit.filter((event) => relatedToIssue(event, problemId, entityIds));
  if (workspacePersistenceMode(orgId) !== "postgres") return [];
  const result = await databasePool().query<AuditEvent>(
    `SELECT id, org_id AS "orgId", occurred_at AS "occurredAt", actor_id AS "actorId", actor_name AS "actorName",
       action, entity_type AS "entityType", entity_id AS "entityId", trace_id AS "traceId"
     FROM audit_events
     WHERE org_id=$1 AND (entity_id=$2 OR strpos(trace_id,$2) > 0)
     ORDER BY occurred_at DESC LIMIT 200`,
    [orgId, problemId],
  );
  return result.rows.filter((event) => relatedToIssue(event, problemId, entityIds));
}
