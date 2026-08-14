import { randomUUID } from "node:crypto";
import { databasePool } from "./db";
import {
  applyPddPromptRevision,
  approveImplementationRun,
  failAgentRun,
  failPddVerification,
  generatePddAcceptanceContract,
  getAgentRunExecutionContext,
  getPddVerificationExecutionContext,
  getPromptAlignmentContext,
  markPddVerificationGenerating,
  requestImplementationApproval,
} from "./engineering-workflow-repository";
import {
  agentRunDispatchFailureCode,
  dispatchAgentRun,
} from "./agent-executor-client";
import { approveFinalExecution } from "./final-execution-repository";
import {
  dispatchPddVerification,
  pddRunnerConfigured,
} from "./pdd-runner-client";
import { evaluateWorkspacePrompt } from "./workspace-prompt-evaluation";
import { PDD_CLI_VERSION } from "./pdd-verification";
import {
  readAutonomyLevel,
} from "./workspace-settings-repository";
import { workspacePersistenceMode } from "./workspace-persistence";

const actor = {
  actorId: "system:full-autonomy",
  actorName: "CloseSpan full autonomy",
  traceId: "full_autonomy",
  idempotencyKey: "full_autonomy",
};

export interface AutonomyAutomationResult {
  action:
    | "not_enabled"
    | "idle"
    | "prompt_aligned"
    | "pdd_dispatched"
    | "agent_dispatched"
    | "final_execution_queued"
    | "blocked";
  problemId: string | null;
  message: string;
}

async function approveAndDispatchAgent(
  orgId: string,
  approvalId: string,
): Promise<AutonomyAutomationResult> {
  const workflow = await approveImplementationRun(orgId, approvalId, {
    ...actor,
    traceId: `full_autonomy_agent_${approvalId}`,
    idempotencyKey: `full_autonomy_agent_${approvalId}`,
  });
  if (!workflow.run) {
    return { action: "blocked", problemId: workflow.problemId, message: "The approved agent run was not created." };
  }
  const execution = await getAgentRunExecutionContext(orgId, workflow.run.id);
  try {
    await dispatchAgentRun(execution);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The Tenki executor could not start.";
    await failAgentRun(
      execution,
      agentRunDispatchFailureCode(message, "autonomy_dispatch_failed"),
      message,
    );
    return { action: "blocked", problemId: workflow.problemId, message };
  }
  return {
    action: "agent_dispatched",
    problemId: workflow.problemId,
    message: "The immutable agent run was authorized and dispatched to Tenki.",
  };
}

async function pendingFinalApproval(orgId: string): Promise<{ id: string; problem_id: string } | null> {
  const result = await databasePool().query<{ id: string; problem_id: string }>(
    `SELECT id,problem_id FROM approval_requests
      WHERE org_id=$1 AND action_type='final_execution' AND status='Pending'
        AND expires_at>now()
      ORDER BY created_at,id LIMIT 1`,
    [orgId],
  );
  return result.rows[0] ?? null;
}

async function pendingAgentApproval(orgId: string): Promise<{ id: string; problem_id: string } | null> {
  const result = await databasePool().query<{ id: string; problem_id: string }>(
    `SELECT id,problem_id FROM approval_requests
      WHERE org_id=$1 AND action_type='agent_run' AND status='Pending'
        AND expires_at>now()
      ORDER BY created_at,id LIMIT 1`,
    [orgId],
  );
  return result.rows[0] ?? null;
}

async function readyVerification(orgId: string): Promise<{ prompt_id: string; problem_id: string } | null> {
  const result = await databasePool().query<{ prompt_id: string; problem_id: string }>(
    `SELECT prompt.id AS prompt_id,prompt.problem_id
       FROM implementation_prompts prompt
       JOIN pdd_prompt_verifications verification
         ON verification.org_id=prompt.org_id
        AND verification.prompt_revision_id=prompt.id
        AND verification.prompt_hash=prompt.content_hash
        AND verification.status='Ready for approval'
      WHERE prompt.org_id=$1 AND prompt.status='Ready'
        AND NOT EXISTS (
          SELECT 1 FROM approval_requests approval
           WHERE approval.org_id=prompt.org_id
             AND approval.prompt_revision_id=prompt.id
             AND approval.status IN ('Pending','Approved')
        )
      ORDER BY verification.completed_at,prompt.created_at LIMIT 1`,
    [orgId],
  );
  return result.rows[0] ?? null;
}

async function promptToAlign(orgId: string): Promise<{ problem_id: string; user_story: string } | null> {
  const result = await databasePool().query<{ problem_id: string; user_story: string }>(
    `SELECT specification.problem_id,specification.user_story
       FROM engineering_ticket_specifications specification
       JOIN LATERAL (
         SELECT candidate.id,candidate.status,candidate.created_at
           FROM implementation_prompts candidate
          WHERE candidate.org_id=specification.org_id
            AND candidate.problem_id=specification.problem_id
            AND candidate.status IN ('Draft','Ready')
          ORDER BY candidate.revision DESC LIMIT 1
       ) prompt ON true
      WHERE specification.org_id=$1
        AND NOT EXISTS (
          SELECT 1 FROM pdd_prompt_verifications verification
           WHERE verification.org_id=specification.org_id
             AND verification.prompt_revision_id=prompt.id
             AND verification.status IN ('Queued','Generating tests','Ready for approval')
        )
      ORDER BY prompt.created_at,specification.problem_id LIMIT 1`,
    [orgId],
  );
  return result.rows[0] ?? null;
}

async function alignAndDispatchPdd(
  orgId: string,
  problemId: string,
  userStory: string,
): Promise<AutonomyAutomationResult> {
  let context = await getPromptAlignmentContext(orgId, problemId, userStory, actor);
  for (let revision = 0; revision < 3; revision += 1) {
    const evaluation = await evaluateWorkspacePrompt({
      orgId,
      promptHash: context.promptHash,
      userStory: context.userStory,
      implementationPrompt: context.implementationPrompt,
      pddVersion: PDD_CLI_VERSION,
    });
    if (evaluation.verdict === "Passed") {
      const acceptance = await generatePddAcceptanceContract(orgId, problemId, userStory, actor);
      if (acceptance.storyTest.status === "Queued" && pddRunnerConfigured()) {
        try {
          const execution = await getPddVerificationExecutionContext(orgId, acceptance.storyTest.id);
          await markPddVerificationGenerating(orgId, acceptance.storyTest.id);
          await dispatchPddVerification(execution);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Prompt Testing verification could not start.";
          await failPddVerification(orgId, acceptance.storyTest.id, message);
          return { action: "blocked", problemId, message };
        }
        return { action: "pdd_dispatched", problemId, message: "Prompt Testing is generating the repository-bound acceptance contract." };
      }
      return {
        action: acceptance.storyTest.status === "Ready for approval" ? "prompt_aligned" : "blocked",
        problemId,
        message: acceptance.storyTest.status === "Ready for approval"
          ? "The prompt and acceptance contract are aligned."
          : "Prompt Testing is not configured to execute the repository acceptance contract.",
      };
    }
    const revisedPrompt = [
      context.implementationPrompt.trim(),
      "",
      "## PDD-required outcomes",
      ...evaluation.changes.map((change) => `- ${change}`),
      "",
      `Product-manager user story: ${context.userStory}`,
    ].join("\n");
    await applyPddPromptRevision(
      orgId,
      problemId,
      { currentPromptHash: context.promptHash, revisedPrompt },
      { ...actor, traceId: `full_autonomy_revision_${randomUUID()}` },
    );
    context = await getPromptAlignmentContext(orgId, problemId, userStory, actor);
  }
  return {
    action: "blocked",
    problemId,
    message: "Prompt Testing could not align the prompt after three immutable revisions; human review is required.",
  };
}

export async function reconcileFullAutonomy(orgId: string): Promise<AutonomyAutomationResult> {
  if (await readAutonomyLevel(orgId) !== "Full autonomy") {
    return { action: "not_enabled", problemId: null, message: "Full autonomy is not enabled." };
  }
  if (workspacePersistenceMode(orgId) !== "postgres") {
    return { action: "blocked", problemId: null, message: "Full autonomy requires the persistent production workflow." };
  }

  const finalApproval = await pendingFinalApproval(orgId);
  if (finalApproval) {
    await approveFinalExecution(orgId, finalApproval.id, {
      actorId: actor.actorId,
      actorName: actor.actorName,
      traceId: `full_autonomy_final_${finalApproval.id}`,
    });
    return {
      action: "final_execution_queued",
      problemId: finalApproval.problem_id,
      message: "The commit-locked final execution was authorized and queued.",
    };
  }

  const agentApproval = await pendingAgentApproval(orgId);
  if (agentApproval) return approveAndDispatchAgent(orgId, agentApproval.id);

  const verification = await readyVerification(orgId);
  if (verification) {
    const workflow = await requestImplementationApproval(orgId, verification.prompt_id, {
      ...actor,
      traceId: `full_autonomy_request_${verification.prompt_id}`,
      idempotencyKey: `full_autonomy_request_${verification.prompt_id}`,
    });
    if (!workflow.approval) {
      return { action: "blocked", problemId: verification.problem_id, message: "The agent approval record could not be created." };
    }
    return approveAndDispatchAgent(orgId, workflow.approval.id);
  }

  const prompt = await promptToAlign(orgId);
  if (prompt) return alignAndDispatchPdd(orgId, prompt.problem_id, prompt.user_story);

  return { action: "idle", problemId: null, message: "No full-autonomy action is ready." };
}
