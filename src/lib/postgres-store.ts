import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AuditEvent, Stage } from "./domain";
import type { DemoState } from "./memory-store";
import { transaction, databasePool } from "./db";

interface ActionContext { actorId: string; actorName: string; idempotencyKey: string; traceId: string }
type Action = "approve" | "reject" | "advance" | "notify";
interface WorkflowTarget {
  approvalId: string;
  problemId: string;
  stage: Stage;
}

export class WorkflowNotFoundError extends Error {
  readonly status = 404;
}

export class WorkflowConflictError extends Error {
  readonly status = 409;
}

async function readState(
  orgId: string,
  client: Pool | PoolClient = databasePool(),
): Promise<DemoState | null> {
  const result = await client.query<{
    version: number; stage: Stage; approval: DemoState["approval"]; work_item: DemoState["workItem"] | null;
    notification_status: DemoState["notifications"];
  }>(`SELECT coalesce(w.version,1)::int AS version, p.stage, jsonb_build_object(
      'id',a.id,'orgId',a.org_id,'problemId',a.problem_id,'recommendationId',a.recommendation_id,
      'action',a.action,'reason',a.reason,'confidence',a.confidence,'systems',a.systems,
      'dataShared',a.data_shared,'reversible',a.reversible,'risk',a.risk,'status',a.status
    ) AS approval,
      CASE WHEN e.id IS NULL THEN NULL ELSE jsonb_build_object('id', e.external_key, 'url', e.url, 'simulated', e.simulated) END AS work_item,
      CASE WHEN NOT EXISTS (SELECT 1 FROM customer_notifications n WHERE n.org_id=a.org_id AND n.problem_id=p.id) THEN 'Not drafted'
        WHEN NOT EXISTS (SELECT 1 FROM customer_notifications n WHERE n.org_id=a.org_id AND n.problem_id=p.id AND n.status <> 'Approved') THEN 'Approved'
        ELSE 'Drafted' END AS notification_status
    FROM approval_requests a
    JOIN product_problems p ON p.org_id=a.org_id AND p.id=a.problem_id
    LEFT JOIN workspaces w ON w.org_id=a.org_id
    LEFT JOIN LATERAL (
      SELECT item.id,item.external_key,item.url,item.simulated
      FROM external_work_items item
      WHERE item.org_id=a.org_id AND item.problem_id=p.id
      ORDER BY item.created_at DESC,item.id
      LIMIT 1
    ) e ON true
    WHERE a.org_id=$1
    ORDER BY coalesce(w.primary_approval_id=a.id,false) DESC,
      (a.status='Pending') DESC,a.updated_at DESC,a.id
    LIMIT 1`, [orgId]);
  if (!result.rows[0]) return null;
  const audit = await client.query<AuditEvent>(`SELECT id, org_id AS "orgId", occurred_at AS "occurredAt", actor_id AS "actorId", actor_name AS "actorName", action, entity_type AS "entityType", entity_id AS "entityId", trace_id AS "traceId" FROM audit_events WHERE org_id=$1 ORDER BY occurred_at DESC`, [orgId]);
  const processed = await client.query<{ key: string; action: string }>("SELECT key, action FROM idempotency_keys WHERE org_id=$1", [orgId]);
  const row = result.rows[0];
  return { orgId, version: row.version, approval: row.approval, problemStage: row.stage, workItem: row.work_item ?? undefined, notifications: row.notification_status, audit: audit.rows, processedActions: Object.fromEntries(processed.rows.map(({key, action}) => [key, action])) };
}

async function workflowTarget(
  client: PoolClient,
  orgId: string,
): Promise<WorkflowTarget | null> {
  const result = await client.query<{
    approval_id:string;
    problem_id:string;
    stage:Stage;
  }>(`SELECT a.id approval_id,a.problem_id,p.stage
      FROM approval_requests a
      JOIN product_problems p ON p.org_id=a.org_id AND p.id=a.problem_id
      LEFT JOIN workspaces w ON w.org_id=a.org_id
      WHERE a.org_id=$1
      ORDER BY coalesce(w.primary_approval_id=a.id,false) DESC,
        (a.status='Pending') DESC,a.updated_at DESC,a.id
      LIMIT 1
      FOR UPDATE OF a,p`,[orgId]);
  const row = result.rows[0];
  return row
    ? {
        approvalId:row.approval_id,
        problemId:row.problem_id,
        stage:row.stage,
      }
    : null;
}

async function mutate(
  orgId: string,
  context: ActionContext,
  action: Action,
  work: (client: PoolClient,target: WorkflowTarget) => Promise<void>,
): Promise<DemoState> {
  return transaction(async (client) => {
    const organization = await client.query(
      "SELECT id FROM organizations WHERE id=$1 FOR UPDATE",
      [orgId],
    );
    if (!organization.rowCount)
      throw new WorkflowNotFoundError("Workspace organization was not found");
    const target = await workflowTarget(client,orgId);
    if (!target)
      throw new WorkflowNotFoundError(
        "No approval workflow exists in this workspace",
      );
    const prior = await client.query<{ action: string }>("SELECT action FROM idempotency_keys WHERE org_id=$1 AND key=$2", [orgId, context.idempotencyKey]);
    if (prior.rows[0]) {
      if (prior.rows[0].action !== action)
        throw new WorkflowConflictError(
          "Idempotency key was already used for a different action",
        );
      const replay = await readState(orgId,client);
      if (!replay)
        throw new WorkflowNotFoundError(
          "No approval workflow exists in this workspace",
        );
      return replay;
    }
    await work(client,target);
    await client.query("INSERT INTO idempotency_keys(org_id,key,action) VALUES ($1,$2,$3)", [orgId, context.idempotencyKey, action]);
    await client.query("UPDATE workspaces SET version=version+1, updated_at=now() WHERE org_id=$1", [orgId]);
    const next = await readState(orgId,client);
    if (!next)
      throw new WorkflowNotFoundError(
        "No approval workflow exists in this workspace",
      );
    return next;
  });
}

async function audit(client: PoolClient, orgId: string, context: ActionContext, action: string, entityType: AuditEvent["entityType"], entityId: string) {
  await client.query("INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [randomUUID(), orgId, context.actorId, context.actorName, action, entityType, entityId, context.traceId]);
}

export async function findPostgresState(orgId: string): Promise<DemoState | null> {
  return readState(orgId);
}

export async function getPostgresState(orgId: string): Promise<DemoState> {
  const state = await readState(orgId);
  if (!state)
    throw new WorkflowNotFoundError(
      "No approval workflow exists in this workspace",
    );
  return state;
}

export function approvePostgresAction(orgId: string, context: ActionContext) {
  return mutate(orgId, context, "approve", async (client,target) => {
    const result = await client.query("UPDATE approval_requests SET status='Approved',updated_at=now() WHERE org_id=$1 AND id=$2 AND status='Pending'", [orgId,target.approvalId]);
    if (!result.rowCount)
      throw new WorkflowConflictError("Approval is no longer pending");
    await client.query("UPDATE product_problems SET stage='Approved',updated_at=now() WHERE org_id=$1 AND id=$2", [orgId,target.problemId]);
    const externalKey = `SIM-${target.approvalId}`;
    await client.query("INSERT INTO external_work_items(id,org_id,problem_id,provider,external_key,url,simulated) VALUES ($1,$2,$3,'Simulated connector',$4,'#simulated-work-item',true) ON CONFLICT (org_id,provider,external_key) DO NOTHING", [randomUUID(),orgId,target.problemId,externalKey]);
    await audit(client, orgId, context, `Approved simulated external action ${externalKey}`, "ApprovalRequest", target.approvalId);
  });
}

export function rejectPostgresAction(orgId: string, context: ActionContext) {
  return mutate(orgId, context, "reject", async (client,target) => {
    const result = await client.query("UPDATE approval_requests SET status='Rejected',updated_at=now() WHERE org_id=$1 AND id=$2 AND status='Pending'", [orgId,target.approvalId]);
    if (!result.rowCount)
      throw new WorkflowConflictError("Approval is no longer pending");
    await audit(client, orgId, context, "Rejected simulated external action proposal", "ApprovalRequest", target.approvalId);
  });
}

export function advancePostgresLifecycle(orgId: string, context: ActionContext) {
  return mutate(orgId, context, "advance", async (client,target) => {
    const next: Partial<Record<Stage, Stage>> = { Approved: "Planned", Planned: "In progress", "In progress": "Released", Released: "Verified", Verified: "Closed" };
    const nextStage = next[target.stage];
    if (!nextStage)
      throw new WorkflowConflictError(
        "The problem cannot advance from its current stage",
      );
    await client.query("UPDATE product_problems SET stage=$3,updated_at=now() WHERE org_id=$1 AND id=$2", [orgId,target.problemId,nextStage]);
    if (nextStage === "Verified") {
      const customers = await client.query<{ customer_name:string }>(`SELECT DISTINCT f.customer_name
        FROM feedback_cluster_memberships membership
        JOIN feedback_items f ON f.org_id=membership.org_id AND f.id=membership.feedback_id
        WHERE membership.org_id=$1 AND membership.problem_id=$2
        ORDER BY f.customer_name`,[orgId,target.problemId]);
      for (const customer of customers.rows) {
        await client.query(`INSERT INTO customer_notifications(id,org_id,problem_id,customer_name,status)
          VALUES($1,$2,$3,$4,'Drafted') ON CONFLICT DO NOTHING`,[
          randomUUID(),orgId,target.problemId,customer.customer_name,
        ]);
      }
    }
    await audit(client, orgId, context, `Moved problem to ${nextStage}`, "ProductProblem", target.problemId);
  });
}

export function approvePostgresNotifications(orgId: string, context: ActionContext) {
  return mutate(orgId, context, "notify", async (client,target) => {
    const result = await client.query("UPDATE customer_notifications SET status='Approved',updated_at=now() WHERE org_id=$1 AND problem_id=$2 AND status='Drafted'", [orgId,target.problemId]);
    if (!result.rowCount)
      throw new WorkflowConflictError(
        "Customer follow-up requires a verified resolution and drafted messages",
      );
    await audit(client, orgId, context, `Approved ${result.rowCount} simulated customer follow-up draft${result.rowCount === 1 ? "" : "s"}`, "CustomerNotification", target.problemId);
  });
}
