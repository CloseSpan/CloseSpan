import { databasePool, persistenceMode, transaction } from "./db";

export interface DemoGuideStep {
  id: string;
  title: string;
  description: string;
  path: string;
  actionLabel: string;
  talkingPoints: string[];
}

export interface WorkspaceDemoGuide {
  title: string;
  description: string;
  steps: DemoGuideStep[];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseDemoGuideSteps(value: unknown): DemoGuideStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const row = candidate as Record<string, unknown>;
    const id = text(row.id);
    const title = text(row.title);
    const description = text(row.description);
    const path = text(row.path);
    const actionLabel = text(row.actionLabel);
    const talkingPoints = Array.isArray(row.talkingPoints)
      ? row.talkingPoints.map(text).filter((item): item is string => Boolean(item))
      : [];
    if (
      !id ||
      !title ||
      !description ||
      !path?.startsWith("/") ||
      path.startsWith("//") ||
      !actionLabel
    ) return [];
    return [{ id, title, description, path, actionLabel, talkingPoints }];
  });
}

export async function getWorkspaceDemoGuide(
  orgId: string,
): Promise<WorkspaceDemoGuide | null> {
  if (persistenceMode() !== "postgres") return null;
  try {
    const result = await databasePool().query<{
      title: string;
      description: string;
      steps: unknown;
    }>(
      `SELECT title,description,steps
         FROM workspace_demo_guides
        WHERE org_id=$1 AND enabled=true`,
      [orgId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const steps = parseDemoGuideSteps(row.steps);
    if (steps.length === 0) return null;
    return { title: row.title, description: row.description, steps };
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return null;
    throw error;
  }
}
export async function resetWorkspaceDemoWorkflow(orgId: string): Promise<{
  problemId: string;
  approvalId: string;
}> {
  if (persistenceMode() !== "postgres")
    throw new Error("PostgreSQL persistence is required");
  return transaction(async (client) => {
    const guide = await client.query(
      `SELECT org_id FROM workspace_demo_guides
        WHERE org_id=$1 AND enabled=true
        FOR UPDATE`,
      [orgId],
    );
    if (!guide.rowCount) throw new Error("Guided demo is not enabled");
    const workspace = await client.query<{
      primary_problem_id: string | null;
      primary_approval_id: string | null;
    }>(
      `SELECT primary_problem_id,primary_approval_id
         FROM workspaces WHERE org_id=$1 FOR UPDATE`,
      [orgId],
    );
    const problemId = workspace.rows[0]?.primary_problem_id;
    const approvalId = workspace.rows[0]?.primary_approval_id;
    if (!problemId || !approvalId)
      throw new Error("Guided demo workflow is incomplete");

    await client.query(
      `UPDATE approval_requests
          SET status='Pending',updated_at=now()
        WHERE org_id=$1 AND id=$2`,
      [orgId, approvalId],
    );
    await client.query(
      `UPDATE product_problems
          SET stage='Needs review',updated_at=now()
        WHERE org_id=$1 AND id=$2`,
      [orgId, problemId],
    );
    await client.query(
      "DELETE FROM external_work_items WHERE org_id=$1 AND problem_id=$2",
      [orgId, problemId],
    );
    await client.query(
      "DELETE FROM customer_notifications WHERE org_id=$1 AND problem_id=$2",
      [orgId, problemId],
    );
    await client.query("DELETE FROM idempotency_keys WHERE org_id=$1", [orgId]);
    await client.query(
      "DELETE FROM audit_events WHERE org_id=$1 AND trace_id NOT LIKE 'demo-seed-%'",
      [orgId],
    );
    await client.query(
      "UPDATE workspaces SET version=version+1,updated_at=now() WHERE org_id=$1",
      [orgId],
    );
    return { problemId, approvalId };
  });
}
