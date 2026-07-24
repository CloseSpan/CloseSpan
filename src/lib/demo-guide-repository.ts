import { databasePool, persistenceMode, transaction } from "./db";
import { resetMemoryState } from "./memory-store";
import { approval, primaryProblem } from "./seed";

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

export const demoWorkspaceGuide: WorkspaceDemoGuide = {
  title: "From customer signal to verified fix",
  description:
    "A presentation-ready walkthrough of CloseSpan's feedback operations workflow.",
  steps: [
    {
      id: "operating-picture",
      title: "Start with the operating picture",
      description:
        "Show how one workspace turns fragmented signals into a view of volume, urgency, revenue, and resolution speed.",
      path: "/overview",
      actionLabel: "Open overview",
      talkingPoints: [
        "Eight weeks of feedback volume across four channels",
        "Revenue and renewal risk determine what rises first",
        "Every metric links back to customer evidence",
      ],
    },
    {
      id: "raw-signals",
      title: "Inspect the customer evidence",
      description:
        "Open the inbox to show source context, PII-safe content, classification confidence, and linked product problems.",
      path: "/feedback",
      actionLabel: "Open feedback inbox",
      talkingPoints: [
        "Signals retain source and account context",
        "PII protection is visible",
        "The original customer language stays attached",
      ],
    },
    {
      id: "problem-map",
      title: "Turn reports into durable problems",
      description:
        "Show how repeated reports become product problems with shared evidence, owners, and workflow stages.",
      path: "/problems",
      actionLabel: "Open product problems",
      talkingPoints: [
        "Related reports form evidence-backed clusters",
        "Stages separate detection, delivery, and verification",
        "Themes emerge from reviewed links",
      ],
    },
    {
      id: "priority",
      title: "Prioritize by business impact",
      description:
        "Compare frequency, severity, affected revenue, churn risk, confidence, and effort in one decision surface.",
      path: "/prioritization",
      actionLabel: "Open prioritization",
      talkingPoints: [
        "The export regression leads because evidence and revenue align",
        "Weights express the team's operating policy",
        "Each score traces back to customer evidence",
      ],
    },
    {
      id: "evidence",
      title: "Review the highest-impact problem",
      description:
        "Connect corroborating reports to a release and the suspected repository surface before any action is taken.",
      path: "/problems/prob_export",
      actionLabel: "Review problem evidence",
      talkingPoints: [
        "Three paid accounts describe the same failure mode",
        "$394k ARR is visibly represented",
        "Technical causes remain hypotheses until verified",
      ],
    },
    {
      id: "approval",
      title: "Keep a human at the action boundary",
      description:
        "Review the proposed GitHub issue, shared data, reversibility, and confidence before approving it.",
      path: "/approvals",
      actionLabel: "Review approval",
      talkingPoints: [
        "No external action happens before approval",
        "The proposed issue uses redacted evidence",
        "The audit trail records the decision",
      ],
    },
    {
      id: "connectors",
      title: "Show the feedback network",
      description:
        "Explain how feedback sources feed the workspace while engineering tools receive only approved actions.",
      path: "/integrations",
      actionLabel: "Open integrations",
      talkingPoints: [
        "Demo connections are clearly labeled",
        "Each connector exposes scope and permissions",
        "The integration assistant guides setup",
      ],
    },
    {
      id: "governance",
      title: "Finish with trust and control",
      description:
        "Close with autonomy boundaries, PII policy, prioritization weights, prompt versioning, and model budget controls.",
      path: "/settings",
      actionLabel: "Open governance",
      talkingPoints: [
        "Agent actions stay within explicit approval boundaries",
        "AI settings and operating policy are visible",
        "The walkthrough can be reset for the next presentation",
      ],
    },
  ],
};

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
  if (persistenceMode() !== "postgres") return demoWorkspaceGuide;
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
  if (persistenceMode() !== "postgres") {
    resetMemoryState(orgId);
    return { problemId: primaryProblem.id, approvalId: approval.id };
  }
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
