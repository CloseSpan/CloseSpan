import { randomUUID } from "node:crypto";
import { databasePool } from "./db";
import type { RequestContext } from "./request-security";
import { workspacePersistenceMode } from "./workspace-persistence";

export type TenkiRunnerSetupApprovalEvent = "approved" | "merged" | "failed";

export async function recordTenkiRunnerSetupApprovalEvent(input: {
  orgId: string;
  repository: string;
  pullRequestNumber: number;
  event: TenkiRunnerSetupApprovalEvent;
  actor: Pick<RequestContext, "actorId" | "actorName" | "traceId">;
  mergedSha?: string;
  failureMessage?: string;
}): Promise<void> {
  if (workspacePersistenceMode(input.orgId) === "memory") return;
  const pullRequest = `${input.repository}#${input.pullRequestNumber}`;
  const action = input.event === "approved"
    ? `Approved merge of the CloseSpan runner setup pull request ${pullRequest}`
    : input.event === "merged"
      ? `Merged the CloseSpan runner setup pull request ${pullRequest} at ${input.mergedSha}`
      : `Runner setup merge ${pullRequest} failed after approval: ${(input.failureMessage ?? "Unknown failure").slice(0, 500)}`;
  await databasePool().query(
    `INSERT INTO audit_events(
       id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
     ) VALUES($1,$2,$3,$4,$5,'Integration',$6,$7)
     ON CONFLICT (org_id,trace_id,action) DO NOTHING`,
    [
      randomUUID(),
      input.orgId,
      input.actor.actorId,
      input.actor.actorName,
      action,
      pullRequest,
      `${input.actor.traceId}:tenki-runner-setup:${input.event}`,
    ],
  );
}
