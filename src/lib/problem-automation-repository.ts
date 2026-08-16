import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { Stage } from "./domain";
import { databasePool, transaction } from "./db";
import { getMemoryState } from "./memory-store";
import {
  getMemoryProblemStages,
  memoryTransitionAvailable,
  recordMemoryProblemTransition,
  setMemoryProblemStage,
} from "./problem-automation-memory";
import { primaryProblem } from "./seed";
import { workspacePersistenceMode } from "./workspace-persistence";
import {
  createNextAutomatedPromptDraft,
  type AutomatedPromptDraftResult,
} from "./automated-prompt-draft-repository";
import { deliverPromptReviewEmails, type PromptReviewEmailDeliveryResult } from "./prompt-review-email";
import {
  createNextAutomatedInvestigation,
  type AutomatedInvestigationResult,
} from "./investigation-repository";
import { autonomyCapabilities } from "./autonomy-policy";
import { readAutonomyLevel } from "./workspace-settings-repository";
import {
  reconcileFullAutonomy,
  type AutonomyAutomationResult,
} from "./autonomy-automation-repository";

export interface StageEvidence {
  hasFeedback: boolean;
  hasInvestigation: boolean;
  hasPendingApproval: boolean;
  hasApprovedApproval: boolean;
  hasApprovedWork: boolean;
  hasMergedPullRequest: boolean;
  hasReleaseRecord: boolean;
  hasPassingReleaseVerification: boolean;
  followUpComplete: boolean;
}

export interface StageAssessment {
  nextStage: Stage | null;
  reason: string;
}

export interface AutomationTickResult {
  moved: boolean;
  problemId: string | null;
  fromStage: Stage | null;
  toStage: Stage | null;
  reason: string;
  investigation?: AutomatedInvestigationResult;
  promptDraft?: AutomatedPromptDraftResult;
  emailDelivery?: PromptReviewEmailDeliveryResult;
  autonomy?: AutonomyAutomationResult;
}

export function assessAutomatedStage(
  stage: Stage,
  evidence: StageEvidence,
): StageAssessment {
  if (stage === "Detected") {
    return evidence.hasFeedback
      ? { nextStage: "Needs review", reason: "Customer evidence is attached." }
      : { nextStage: null, reason: "Waiting for customer evidence." };
  }
  if (stage === "Needs review") {
    if (evidence.hasApprovedApproval) {
      return {
        nextStage: "Approved",
        reason: "The user approved the queued agent action.",
      };
    }
    return evidence.hasInvestigation && evidence.hasPendingApproval
      ? { nextStage: null, reason: "Waiting for the user decision." }
      : { nextStage: null, reason: "Waiting for an investigation and approval-ready action." };
  }
  if (stage === "Approved") {
    return evidence.hasApprovedApproval
      ? { nextStage: "Planned", reason: "The user approved the queued action." }
      : { nextStage: null, reason: "Waiting for an approved action." };
  }
  if (stage === "Planned") {
    return evidence.hasApprovedWork
      ? { nextStage: "In progress", reason: "Approved implementation work has started." }
      : { nextStage: null, reason: "Waiting for approved implementation work to start." };
  }
  if (stage === "In progress") {
    return evidence.hasMergedPullRequest
      ? { nextStage: "Release Ready", reason: "The approved pull request was merged." }
      : { nextStage: null, reason: "Waiting for the approved pull request to merge." };
  }
  if (stage === "Release Ready") {
    return evidence.hasReleaseRecord
      ? { nextStage: "Released", reason: "A release record confirms the implementation reached its target environment." }
      : { nextStage: null, reason: "The pull request is merged; waiting for a truthful release signal." };
  }
  if (stage === "Released") {
    return evidence.hasPassingReleaseVerification
      ? { nextStage: "Verified", reason: "Release verification passed for the current specification." }
      : { nextStage: null, reason: "Waiting for passing release verification." };
  }
  if (stage === "Verified") {
    return evidence.followUpComplete
      ? { nextStage: "Closed", reason: "Customer follow-up is complete." }
      : { nextStage: null, reason: "Waiting for customer follow-up completion." };
  }
  return { nextStage: null, reason: "The ticket is closed." };
}

interface CandidateRow extends StageEvidence {
  id: string;
  stage: Stage;
}

function memoryEvidence(orgId: string, problemId: string): StageEvidence {
  if (problemId !== primaryProblem.id) {
    return {
      hasFeedback: problemId === "prob_filters" || problemId === "prob_invites",
      hasInvestigation: true,
      hasPendingApproval: false,
      hasApprovedApproval: false,
      hasApprovedWork: false,
      hasMergedPullRequest: false,
      hasReleaseRecord: false,
      hasPassingReleaseVerification: false,
      followUpComplete: false,
    };
  }
  const state = getMemoryState(orgId);
  return {
    hasFeedback: true,
    hasInvestigation: true,
    hasPendingApproval: state.approval.status === "Pending",
    hasApprovedApproval: state.approval.status === "Approved",
    hasApprovedWork: Boolean(state.workItem),
    hasMergedPullRequest: ["Release Ready", "Released", "Verified", "Closed"].includes(
      state.problemStage,
    ),
    hasReleaseRecord: ["Released", "Verified", "Closed"].includes(
      state.problemStage,
    ),
    hasPassingReleaseVerification: ["Verified", "Closed"].includes(
      state.problemStage,
    ),
    followUpComplete:
      state.problemStage === "Closed" && state.notifications === "Approved",
  };
}

function runMemoryTick(orgId: string): AutomationTickResult {
  if (!memoryTransitionAvailable(orgId)) {
    return {
      moved: false,
      problemId: null,
      fromStage: null,
      toStage: null,
      reason: "Another ticket moved recently; the coordinator is preserving one-at-a-time order.",
    };
  }
  const stages = getMemoryProblemStages(orgId);
  const order: Stage[] = [
    "Detected",
    "Needs review",
    "Approved",
    "Planned",
    "In progress",
    "Release Ready",
    "Released",
    "Verified",
  ];
  const candidates = [...stages.entries()].sort(
    (left, right) => order.indexOf(left[1]) - order.indexOf(right[1]),
  );
  for (const [problemId, stage] of candidates) {
    const assessment = assessAutomatedStage(
      stage,
      memoryEvidence(orgId, problemId),
    );
    if (!assessment.nextStage) continue;
    setMemoryProblemStage(orgId, problemId, assessment.nextStage);
    if (problemId === primaryProblem.id) {
      getMemoryState(orgId).problemStage = assessment.nextStage;
    }
    recordMemoryProblemTransition(orgId);
    return {
      moved: true,
      problemId,
      fromStage: stage,
      toStage: assessment.nextStage,
      reason: assessment.reason,
    };
  }
  return {
    moved: false,
    problemId: null,
    fromStage: null,
    toStage: null,
    reason: "No ticket currently has enough evidence for its next stage.",
  };
}

async function readCandidates(client: PoolClient, orgId: string) {
  const result = await client.query<CandidateRow>(
    `SELECT problem.id,problem.stage,
      EXISTS (
        SELECT 1 FROM feedback_cluster_memberships membership
        WHERE membership.org_id=problem.org_id AND membership.problem_id=problem.id
      ) AS "hasFeedback",
      EXISTS (
        SELECT 1 FROM investigations investigation
        WHERE investigation.org_id=problem.org_id AND investigation.problem_id=problem.id
      ) AS "hasInvestigation",
      EXISTS (
        SELECT 1 FROM approval_requests approval
        WHERE approval.org_id=problem.org_id AND approval.problem_id=problem.id
          AND approval.status='Pending'
      ) AS "hasPendingApproval",
      EXISTS (
        SELECT 1 FROM approval_requests approval
        WHERE approval.org_id=problem.org_id AND approval.problem_id=problem.id
          AND approval.status='Approved'
      ) AS "hasApprovedApproval",
      (
        EXISTS (
          SELECT 1 FROM external_work_items work
          WHERE work.org_id=problem.org_id AND work.problem_id=problem.id
        ) OR EXISTS (
          SELECT 1 FROM agent_runs run
          WHERE run.org_id=problem.org_id AND run.problem_id=problem.id
            AND run.status IN ('Queued','Running','Tests passed','Draft PR opened')
        )
      ) AS "hasApprovedWork",
      EXISTS (
        SELECT 1
        FROM agent_runs run
        JOIN final_execution_attempts attempt
          ON attempt.org_id=run.org_id AND attempt.agent_run_id=run.id
        WHERE run.org_id=problem.org_id
          AND run.problem_id=problem.id
          AND run.pull_request_number IS NOT NULL
          AND attempt.status='Succeeded'
      ) AS "hasMergedPullRequest",
      EXISTS (
        SELECT 1 FROM engineering_ticket_specifications specification
        WHERE specification.org_id=problem.org_id
          AND specification.problem_id=problem.id
          AND specification.implementation_state IN ('Released','Verified')
      ) AS "hasReleaseRecord",
      EXISTS (
        SELECT 1
        FROM engineering_release_verifications verification
        JOIN engineering_ticket_specifications specification
          ON specification.org_id=verification.org_id
          AND specification.id=verification.specification_id
          AND specification.revision=verification.specification_revision
        WHERE verification.org_id=problem.org_id
          AND verification.problem_id=problem.id
          AND verification.status='Passed'
      ) AS "hasPassingReleaseVerification",
      (
        EXISTS (
          SELECT 1 FROM customer_notifications notification
          WHERE notification.org_id=problem.org_id
            AND notification.problem_id=problem.id
        ) AND NOT EXISTS (
          SELECT 1 FROM customer_notifications notification
          WHERE notification.org_id=problem.org_id
            AND notification.problem_id=problem.id
            AND notification.status <> 'Sent'
        )
      ) AS "followUpComplete"
    FROM product_problems problem
    WHERE problem.org_id=$1 AND problem.stage <> 'Closed'
    ORDER BY CASE problem.stage
      WHEN 'Detected' THEN 1 WHEN 'Needs review' THEN 2 WHEN 'Approved' THEN 3
      WHEN 'Planned' THEN 4 WHEN 'In progress' THEN 5 WHEN 'Release Ready' THEN 6
      WHEN 'Released' THEN 7 WHEN 'Verified' THEN 8 ELSE 9 END,
      CASE problem.severity
        WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END,
      problem.updated_at,problem.id
    FOR UPDATE OF problem SKIP LOCKED`,
    [orgId],
  );
  return result.rows;
}

async function draftFollowUp(
  client: PoolClient,
  orgId: string,
  problemId: string,
): Promise<void> {
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
      `INSERT INTO customer_notifications(
        id,org_id,problem_id,customer_name,status
      ) VALUES($1,$2,$3,$4,'Drafted') ON CONFLICT DO NOTHING`,
      [randomUUID(), orgId, problemId, customer.customer_name],
    );
  }
}

async function runPostgresTick(orgId: string): Promise<AutomationTickResult> {
  return transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [`closespan-workflow:${orgId}`],
    );
    const lease = await client.query<{ last_transition_at: Date }>(
      `SELECT last_transition_at
       FROM workflow_automation_leases
       WHERE org_id=$1
       FOR UPDATE`,
      [orgId],
    );
    if (
      lease.rows[0] &&
      Date.now() - lease.rows[0].last_transition_at.getTime() < 30_000
    ) {
      return {
        moved: false,
        problemId: null,
        fromStage: null,
        toStage: null,
        reason: "Another ticket moved recently; the coordinator is preserving one-at-a-time order.",
      };
    }
    const candidates = await readCandidates(client, orgId);
    for (const candidate of candidates) {
      const assessment = assessAutomatedStage(candidate.stage, candidate);
      if (!assessment.nextStage) continue;
      await client.query(
        `UPDATE product_problems SET stage=$3,updated_at=now()
         WHERE org_id=$1 AND id=$2 AND stage=$4`,
        [orgId, candidate.id, assessment.nextStage, candidate.stage],
      );
      if (["Release Ready", "Released", "Verified"].includes(assessment.nextStage)) {
        await client.query(
          `UPDATE engineering_ticket_specifications
           SET implementation_state=$3,updated_at=now()
           WHERE org_id=$1 AND problem_id=$2`,
          [orgId, candidate.id, assessment.nextStage],
        );
      }
      if (assessment.nextStage === "Verified") {
        await draftFollowUp(client, orgId, candidate.id);
      }
      await client.query(
        `INSERT INTO audit_events(
          id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
        ) VALUES($1,$2,'agent_workflow_coordinator','Workflow coordinator',$3,
          'ProductProblem',$4,$5)`,
        [
          randomUUID(),
          orgId,
          `Automatically moved problem from ${candidate.stage} to ${assessment.nextStage}: ${assessment.reason}`,
          candidate.id,
          `automation:${candidate.id}:${candidate.stage}:${assessment.nextStage}`,
        ],
      );
      await client.query(
        "UPDATE workspaces SET version=version+1,updated_at=now() WHERE org_id=$1",
        [orgId],
      );
      await client.query(
        `INSERT INTO workflow_automation_leases(
          org_id,last_transition_at,problem_id,from_stage,to_stage,updated_at
        ) VALUES($1,now(),$2,$3,$4,now())
        ON CONFLICT (org_id) DO UPDATE SET
          last_transition_at=excluded.last_transition_at,
          problem_id=excluded.problem_id,
          from_stage=excluded.from_stage,
          to_stage=excluded.to_stage,
          updated_at=now()`,
        [orgId, candidate.id, candidate.stage, assessment.nextStage],
      );
      return {
        moved: true,
        problemId: candidate.id,
        fromStage: candidate.stage,
        toStage: assessment.nextStage,
        reason: assessment.reason,
      };
    }
    return {
      moved: false,
      problemId: null,
      fromStage: null,
      toStage: null,
      reason: "No ticket currently has enough evidence for its next stage.",
    };
  });
}

export async function runProblemAutomationTick(
  orgId: string,
): Promise<AutomationTickResult> {
  const autonomyLevel = await readAutonomyLevel(orgId);
  const policy = autonomyCapabilities(autonomyLevel);
  if (!policy.investigate) {
    return {
      moved: false,
      problemId: null,
      fromStage: null,
      toStage: null,
      reason: "Observe mode records and classifies feedback without starting workflow automation.",
      autonomy: { action: "not_enabled", problemId: null, message: "Execution automation is disabled in Observe mode." },
    };
  }
  const investigation = await createNextAutomatedInvestigation(orgId);
  const promptDraft = policy.preparePrompt
    ? await createNextAutomatedPromptDraft(orgId)
    : undefined;
  const stageResult = workspacePersistenceMode(orgId) === "memory"
    ? runMemoryTick(orgId)
    : runPostgresTick(orgId);
  const completedStage = await stageResult;
  const emailDelivery = await deliverPromptReviewEmails(orgId);
  const autonomy = autonomyLevel === "Full autonomy"
    ? await reconcileFullAutonomy(orgId).catch((error: unknown) => ({
        action: "blocked" as const,
        problemId: promptDraft?.problemId ?? null,
        message: error instanceof Error ? error.message : "Full-autonomy reconciliation failed.",
      }))
    : { action: "not_enabled" as const, problemId: null, message: `${autonomyLevel} does not auto-authorize execution.` };
  return { ...completedStage, investigation, promptDraft, emailDelivery, autonomy };
}

export async function runProblemAutomationForAllOrganizations(): Promise<
  Array<{ orgId: string; result: AutomationTickResult }>
> {
  const organizations = await databasePool().query<{ id: string }>(
    "SELECT id FROM organizations ORDER BY id",
  );
  const results: Array<{ orgId: string; result: AutomationTickResult }> = [];
  for (const organization of organizations.rows) {
    results.push({
      orgId: organization.id,
      result: await runProblemAutomationTick(organization.id),
    });
  }
  return results;
}
