import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { Stage } from "./domain";
import { persistenceMode, transaction } from "./db";
import { overviewAnalytics } from "./overview-analytics";
import {
  isProductProblemStage,
  problemStageTransitionPreview,
} from "./problem-stage-transition";
import type { RequestContext } from "./request-security";

export interface ManualProblemStageTransition {
  problemId: string;
  fromStage: Stage;
  toStage: Stage;
  sideEffects: string[];
  replayed: boolean;
}

export class ProblemStageTransitionError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

const memoryStages = new Map<string, Stage>();

function actionKey(problemId: string, fromStage: Stage, toStage: Stage) {
  return `manual_problem_stage:${problemId}:${fromStage}:${toStage}`;
}

async function draftFollowups(client: PoolClient, orgId: string, problemId: string) {
  const customers = await client.query<{ customer_name: string }>(
    `SELECT DISTINCT feedback.customer_name
       FROM feedback_cluster_memberships membership
       JOIN feedback_items feedback
         ON feedback.org_id=membership.org_id AND feedback.id=membership.feedback_id
      WHERE membership.org_id=$1 AND membership.problem_id=$2
      ORDER BY feedback.customer_name`,
    [orgId, problemId],
  );
  for (const customer of customers.rows) {
    await client.query(
      `INSERT INTO customer_notifications(id,org_id,problem_id,customer_name,status)
       VALUES($1,$2,$3,$4,'Drafted') ON CONFLICT DO NOTHING`,
      [randomUUID(), orgId, problemId, customer.customer_name],
    );
  }
}

async function transitionPostgres(
  orgId: string,
  problemId: string,
  toStage: Stage,
  context: RequestContext,
): Promise<ManualProblemStageTransition> {
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `${orgId}:${context.idempotencyKey}`,
    ]);
    const prior = await client.query<{ action: string }>(
      "SELECT action FROM idempotency_keys WHERE org_id=$1 AND key=$2",
      [orgId, context.idempotencyKey],
    );
    if (prior.rows[0]) {
      const parts = prior.rows[0].action.split(":");
      if (parts[0] !== "manual_problem_stage" || parts[1] !== problemId || parts[3] !== toStage)
        throw new ProblemStageTransitionError(
          409,
          "This idempotency key was already used for another action",
        );
      return {
        problemId,
        fromStage: parts[2] as Stage,
        toStage,
        sideEffects: problemStageTransitionPreview(toStage).effects,
        replayed: true,
      };
    }

    const result = await client.query<{ title: string; stage: Stage }>(
      "SELECT title,stage FROM product_problems WHERE org_id=$1 AND id=$2 FOR UPDATE",
      [orgId, problemId],
    );
    const problem = result.rows[0];
    if (!problem)
      throw new ProblemStageTransitionError(404, "Product problem was not found");
    if (problem.stage === toStage)
      throw new ProblemStageTransitionError(409, `Problem is already ${toStage}`);

    await client.query(
      "UPDATE product_problems SET stage=$3,updated_at=now() WHERE org_id=$1 AND id=$2",
      [orgId, problemId, toStage],
    );
    if (toStage === "Verified") await draftFollowups(client, orgId, problemId);

    const action = actionKey(problemId, problem.stage, toStage);
    await client.query(
      "INSERT INTO idempotency_keys(org_id,key,action) VALUES($1,$2,$3)",
      [orgId, context.idempotencyKey, action],
    );
    await client.query(
      `INSERT INTO audit_events(
        id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
      ) VALUES($1,$2,$3,$4,$5,'ProductProblem',$6,$7)`,
      [
        randomUUID(),
        orgId,
        context.actorId,
        context.actorName,
        `Manually moved problem from ${problem.stage} to ${toStage}; no external evidence was created`,
        problemId,
        context.traceId,
      ],
    );
    await client.query(
      "UPDATE workspaces SET version=version+1,updated_at=now() WHERE org_id=$1",
      [orgId],
    );
    return {
      problemId,
      fromStage: problem.stage,
      toStage,
      sideEffects: problemStageTransitionPreview(toStage).effects,
      replayed: false,
    };
  });
}

function transitionMemory(
  orgId: string,
  problemId: string,
  toStage: Stage,
): ManualProblemStageTransition {
  const memoryKey = `${orgId}:${problemId}`;
  const original = overviewAnalytics.problems.find((problem) => problem.id === problemId);
  const fromStage = memoryStages.get(memoryKey) ?? original?.stage;
  if (!fromStage || !isProductProblemStage(fromStage))
    throw new ProblemStageTransitionError(404, "Product problem was not found");
  if (fromStage === toStage)
    throw new ProblemStageTransitionError(409, `Problem is already ${toStage}`);
  memoryStages.set(memoryKey, toStage);
  return {
    problemId,
    fromStage,
    toStage,
    sideEffects: problemStageTransitionPreview(toStage).effects,
    replayed: false,
  };
}

export function transitionProblemStage(
  orgId: string,
  problemId: string,
  toStage: Stage,
  context: RequestContext,
) {
  return persistenceMode() === "postgres"
    ? transitionPostgres(orgId, problemId, toStage, context)
    : Promise.resolve(transitionMemory(orgId, problemId, toStage));
}
