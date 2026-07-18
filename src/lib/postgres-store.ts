import type { Pool, PoolClient } from "pg";
import type { AuditEvent, Stage } from "./domain";
import type { DemoState } from "./memory-store";
import { transaction, databasePool } from "./db";
import { primaryProblem } from "./seed";

interface ActionContext { actorId: string; actorName: string; idempotencyKey: string; traceId: string }
type Action = "approve" | "reject" | "advance" | "notify";

async function readState(orgId: string, client: Pool | PoolClient = databasePool()): Promise<DemoState> {
  const result = await client.query<{
    version: number; stage: Stage; approval: DemoState["approval"]; work_item: DemoState["workItem"] | null;
    notification_status: DemoState["notifications"];
  }>(`SELECT w.version, p.stage, jsonb_build_object(
      'id',a.id,'orgId',a.org_id,'problemId',a.problem_id,'recommendationId',a.recommendation_id,
      'action',a.action,'reason',a.reason,'confidence',a.confidence,'systems',a.systems,
      'dataShared',a.data_shared,'reversible',a.reversible,'risk',a.risk,'status',a.status
    ) AS approval,
      CASE WHEN e.id IS NULL THEN NULL ELSE jsonb_build_object('id', e.external_key, 'url', e.url, 'simulated', e.simulated) END AS work_item,
      CASE WHEN NOT EXISTS (SELECT 1 FROM customer_notifications n WHERE n.org_id=w.org_id AND n.problem_id=p.id) THEN 'Not drafted'
        WHEN NOT EXISTS (SELECT 1 FROM customer_notifications n WHERE n.org_id=w.org_id AND n.problem_id=p.id AND n.status <> 'Approved') THEN 'Approved'
        ELSE 'Drafted' END AS notification_status
    FROM workspaces w
    JOIN product_problems p ON p.org_id=w.org_id AND p.id=w.primary_problem_id
    JOIN approval_requests a ON a.org_id=w.org_id AND a.id=w.primary_approval_id
    LEFT JOIN external_work_items e ON e.org_id=w.org_id AND e.problem_id=p.id
    WHERE w.org_id=$1
    LIMIT 1`, [orgId]);
  if (!result.rows[0]) throw new Error(`Organization ${orgId} is not seeded; run npm run db:seed`);
  const audit = await client.query<AuditEvent>(`SELECT id, org_id AS "orgId", occurred_at AS "occurredAt", actor_id AS "actorId", actor_name AS "actorName", action, entity_type AS "entityType", entity_id AS "entityId", trace_id AS "traceId" FROM audit_events WHERE org_id=$1 ORDER BY occurred_at DESC`, [orgId]);
  const processed = await client.query<{ key: string; action: string }>("SELECT key, action FROM idempotency_keys WHERE org_id=$1", [orgId]);
  const row = result.rows[0];
  return { orgId, version: row.version, approval: row.approval, problemStage: row.stage, workItem: row.work_item ?? undefined, notifications: row.notification_status, audit: audit.rows, processedActions: Object.fromEntries(processed.rows.map(({key, action}) => [key, action])) };
}

async function mutate(orgId: string, context: ActionContext, action: Action, work: (client: PoolClient) => Promise<void>): Promise<DemoState> {
  return transaction(async (client) => {
    await client.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [orgId]);
    const prior = await client.query<{ action: string }>("SELECT action FROM idempotency_keys WHERE org_id=$1 AND key=$2", [orgId, context.idempotencyKey]);
    if (prior.rows[0]) {
      if (prior.rows[0].action !== action) throw new Error("Idempotency key was already used for a different action");
      return readState(orgId, client);
    }
    await work(client);
    await client.query("INSERT INTO idempotency_keys(org_id,key,action) VALUES ($1,$2,$3)", [orgId, context.idempotencyKey, action]);
    await client.query("UPDATE workspaces SET version=version+1, updated_at=now() WHERE org_id=$1", [orgId]);
    return readState(orgId, client);
  });
}

async function audit(client: PoolClient, orgId: string, context: ActionContext, action: string, entityType: AuditEvent["entityType"], entityId: string) {
  await client.query("INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [crypto.randomUUID(), orgId, context.actorId, context.actorName, action, entityType, entityId, context.traceId]);
}

export const getPostgresState = readState;

export function approvePostgresAction(orgId: string, context: ActionContext) {
  return mutate(orgId, context, "approve", async (client) => {
    const result = await client.query("UPDATE approval_requests SET status='Approved',updated_at=now() WHERE org_id=$1 AND id='apr_001' AND status='Pending'", [orgId]);
    if (!result.rowCount) throw new Error("Approval is no longer pending");
    await client.query("UPDATE product_problems SET stage='Approved',updated_at=now() WHERE org_id=$1 AND id=$2", [orgId, primaryProblem.id]);
    await client.query("INSERT INTO external_work_items(id,org_id,problem_id,provider,external_key,url,simulated) VALUES ($1,$2,$3,'GitHub','GH-1842','#simulated-work-item',true) ON CONFLICT (org_id,provider,external_key) DO NOTHING", [crypto.randomUUID(), orgId, primaryProblem.id]);
    await audit(client, orgId, context, "Approved simulated GitHub issue GH-1842", "ApprovalRequest", "apr_001");
  });
}

export function rejectPostgresAction(orgId: string, context: ActionContext) {
  return mutate(orgId, context, "reject", async (client) => {
    const result = await client.query("UPDATE approval_requests SET status='Rejected',updated_at=now() WHERE org_id=$1 AND id='apr_001' AND status='Pending'", [orgId]);
    if (!result.rowCount) throw new Error("Approval is no longer pending");
    await audit(client, orgId, context, "Rejected simulated GitHub issue proposal", "ApprovalRequest", "apr_001");
  });
}

export function advancePostgresLifecycle(orgId: string, context: ActionContext) {
  return mutate(orgId, context, "advance", async (client) => {
    const current = await client.query<{ stage: Stage }>("SELECT stage FROM product_problems WHERE org_id=$1 AND id=$2 FOR UPDATE", [orgId, primaryProblem.id]);
    const next: Partial<Record<Stage, Stage>> = { Approved: "Planned", Planned: "In progress", "In progress": "Released", Released: "Verified", Verified: "Closed" };
    const target = current.rows[0] && next[current.rows[0].stage];
    if (!target) throw new Error("The problem cannot advance from its current stage");
    await client.query("UPDATE product_problems SET stage=$3,updated_at=now() WHERE org_id=$1 AND id=$2", [orgId, primaryProblem.id, target]);
    if (target === "Verified") await client.query(`INSERT INTO customer_notifications(id,org_id,problem_id,customer_name,status) VALUES
      ($1,$2,$3,'Northstar Labs','Drafted'),($4,$2,$3,'Acme Health','Drafted'),($5,$2,$3,'Atlas Cloud','Drafted') ON CONFLICT DO NOTHING`, [crypto.randomUUID(), orgId, primaryProblem.id, crypto.randomUUID(), crypto.randomUUID()]);
    await audit(client, orgId, context, `Moved problem to ${target}`, "ProductProblem", primaryProblem.id);
  });
}

export function approvePostgresNotifications(orgId: string, context: ActionContext) {
  return mutate(orgId, context, "notify", async (client) => {
    const result = await client.query("UPDATE customer_notifications SET status='Approved',updated_at=now() WHERE org_id=$1 AND problem_id=$2 AND status='Drafted'", [orgId, primaryProblem.id]);
    if (!result.rowCount) throw new Error("Customer follow-up requires a verified resolution and drafted messages");
    await audit(client, orgId, context, "Approved three simulated customer follow-up drafts", "CustomerNotification", primaryProblem.id);
  });
}
