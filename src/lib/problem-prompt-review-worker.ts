import { autonomyCapabilities } from "./autonomy-policy";
import { automaticCodingBudgetAvailable, readAutonomyLevel } from "./workspace-settings-repository";
import { workspacePersistenceMode } from "./workspace-persistence";
import { createAutomatedInvestigationForProblem } from "./investigation-repository";
import { createAutomatedPromptDraftForProblem, readPromptDraftReadiness } from "./automated-prompt-draft-repository";
import { refreshProblemRepositoryMatch } from "./problem-repository-match-repository";
import {
  latestIssueRuntimeVerification, startIssueRuntimeVerification, failIssueRuntimeVerification,
  getIssueRuntimeVerificationContext, reconcileIssueRuntimeVerificationFromGithub,
} from "./issue-runtime-verification";
import { dispatchIssueRuntimeVerification, runtimeVerifierWorkflowHash } from "./issue-runtime-verification-executor";
import {
  getEngineeringWorkflow, generateImplementationPrompt, getPromptAlignmentContext,
  generatePddAcceptanceContract, getPddVerificationExecutionContext,
  markPddVerificationGenerating, failPddVerification,
} from "./engineering-workflow-repository";
import { testPromptWithCloseSpanAgent, applyPromptRevisionWithCloseSpanAgent } from "./closespan-prompt-agent";
import { dispatchPddVerification, pddRunnerConfigured } from "./pdd-runner-client";
import {
  acceptProblemPromptReviewByPolicy, automaticPromptReviewAcceptanceIsCurrent,
  claimProblemPromptReview, finishProblemPromptReview, readAutomaticPromptReviewActivation,
  reviewLeaseIsCurrent, type ReviewRow,
} from "./problem-prompt-review-repository";
import { AUTOMATIC_PROMPT_POLICY, MAX_PROMPT_REVIEW_EVALUATIONS } from "./automatic-prompt-acceptance";

const MAX_EVALUATIONS = MAX_PROMPT_REVIEW_EVALUATIONS;

/** Runs from the scheduler, not page rendering. One bounded step per durable claim. */
export async function runProblemPromptReviewTick(orgId: string) {
  const level = await readAutonomyLevel(orgId);
  const policy = autonomyCapabilities(level);
  if (!policy.preparePrompt || workspacePersistenceMode(orgId) !== "postgres") return;
  const activation = level === AUTOMATIC_PROMPT_POLICY ? await readAutomaticPromptReviewActivation(orgId) : null;
  if (level === AUTOMATIC_PROMPT_POLICY && (!activation || !await automaticCodingBudgetAvailable(orgId))) return;
  const job = await claimProblemPromptReview(orgId, activation?.occurred_at ?? null);
  if (!job) return;
  try {
    await advanceReview(job, activation?.id ?? null);
  } catch (error) {
    await finishProblemPromptReview(job, { status: "Needs attention",
      failureMessage: error instanceof Error ? error.message : "Background prompt preparation failed." });
  }
}

async function advanceReview(job: ReviewRow, activationId: string | null) {
  const orgId = job.org_id;
  const problemId = job.problem_id;
  const actor = { actorId: "agent_prompt_review", actorName: "CloseSpan Prompt Agent",
    traceId: job.lease_id!, idempotencyKey: `review_${job.lease_id}` };
  const mayStartStep = async (requireAcceptance = false) => {
    if (!await reviewLeaseIsCurrent(job)) return false;
    if (job.evaluation?.policyAcceptance && !activationId) {
      throw new Error("Automatic coding was disabled. Administrator review is needed before continuing.");
    }
    if (activationId) {
      const current = await readAutomaticPromptReviewActivation(orgId);
      if (current?.id !== activationId || !await automaticCodingBudgetAvailable(orgId)) {
        throw new Error("Automatic coding authorization or the recorded workspace budget changed. Administrator review is needed.");
      }
      if (requireAcceptance && !job.confirmed_at && !await automaticPromptReviewAcceptanceIsCurrent(job)) {
        throw new Error("The automatic requirement acceptance is no longer current. Administrator review is needed.");
      }
    }
    return true;
  };
  if (!await mayStartStep()) return;
  let workflow = await getEngineeringWorkflow(orgId, problemId);

  if (!workflow.prompt) {
    await createAutomatedInvestigationForProblem(orgId, problemId);
    await refreshProblemRepositoryMatch(orgId, problemId);
    const readiness = await readPromptDraftReadiness(orgId, problemId);
    if (!readiness.repositoryReady) throw new Error("Repository access needs administrator attention in Settings.");
    if (readiness.verificationStatus !== "Confirmed current") {
      let run = await latestIssueRuntimeVerification(orgId, problemId);
      if (run && ["Queued", "Running"].includes(run.status)) {
        const context = await getIssueRuntimeVerificationContext(orgId, run.id);
        await reconcileIssueRuntimeVerificationFromGithub(context, run);
        run = await latestIssueRuntimeVerification(orgId, problemId);
      }
      // A new/recovered job may make one verification attempt; polling cannot retry it.
      if (run?.status === "Failed" && job.status === "Queued") run = null;
      if (run && ["Failed", "Completed"].includes(run.status)) {
        if (run.outcome !== "Confirmed current") throw new Error("The agent could not confirm the reported behavior. Administrator review is needed.");
      } else if (!run) {
        const origin = process.env.CLOSESPAN_INTERNAL_BASE_URL?.trim().replace(/\/$/, "");
        if (!origin) throw new Error("The verification worker is not configured. Ask an administrator to check Settings.");
        if (!await mayStartStep()) return;
        const started = await startIssueRuntimeVerification({ orgId, problemId, actor, workflowHash: await runtimeVerifierWorkflowHash() });
        try {
          if (!await mayStartStep()) return;
          await dispatchIssueRuntimeVerification(started, origin);
        }
        catch (error) {
          await failIssueRuntimeVerification(orgId, started.runId, error instanceof Error ? error.message : "Verification could not start.");
          throw error;
        }
      }
      await finishProblemPromptReview(job, { status: "Waiting for verification" });
      return;
    }
    if (!await mayStartStep()) return;
    const draft = await createAutomatedPromptDraftForProblem(orgId, problemId);
    workflow = await getEngineeringWorkflow(orgId, problemId);
    if (!workflow.prompt) throw new Error(draft.reason);
  }

  if (["Confirmed", "Preparing tests"].includes(job.status)) {
    if (!await mayStartStep(true)) return;
    if (workflow.prompt.contentHash !== job.prompt_hash) throw new Error("The prompt changed after confirmation. It needs a new review.");
    if (workflow.approval?.promptHash === job.prompt_hash && ["Pending", "Approved"].includes(workflow.approval.status)) {
      await finishProblemPromptReview(job, { status: "Awaiting approval" });
      return;
    }
    if (job.status === "Preparing tests" && workflow.verification?.status === "Failed") {
      throw new Error("Acceptance-test preparation failed. Administrator review is needed before another attempt.");
    }
    if (!pddRunnerConfigured()) throw new Error("The acceptance-test worker is unavailable. Ask an administrator to check Settings.");
    if (!await mayStartStep(true)) return;
    const acceptance = await generatePddAcceptanceContract(orgId, problemId, job.user_story, actor);
    if (acceptance.storyTest.promptHash !== job.prompt_hash) throw new Error("The prompt changed while preparing tests. A new review is required.");
    if (acceptance.storyTest.status === "Queued") {
      try {
        const execution = await getPddVerificationExecutionContext(orgId, acceptance.storyTest.id);
        if (!await mayStartStep(true)) return;
        await markPddVerificationGenerating(orgId, acceptance.storyTest.id);
        await dispatchPddVerification(execution);
      } catch (error) {
        await failPddVerification(orgId, acceptance.storyTest.id, error instanceof Error ? error.message : "Acceptance testing failed.");
        throw error;
      }
    }
    if (["Failed", "Superseded"].includes(acceptance.storyTest.status)) throw new Error(acceptance.storyTest.message);
    await finishProblemPromptReview(job, { status: acceptance.storyTest.status === "Ready for approval" ? "Awaiting approval" : "Preparing tests" });
    return;
  }

  // Never alter a version already approved by a human or the workspace policy.
  if (["Approved", "Awaiting approval"].includes(workflow.prompt.status)) {
    throw new Error("An execution approval already exists for this problem. Review that approval first.");
  }
  if (activationId && (!workflow.specification || !workflow.readiness.ready || workflow.readiness.issues.length)) {
    throw new Error("The expected behavior still has missing or ambiguous information. Administrator review is needed.");
  }
  // Only post-activation Ready work is claimable. Reuse its exact passing review,
  // so a temporary budget pause never turns into another paid evaluation.
  if (job.status === "Ready") {
    if (!activationId || workflow.prompt.contentHash !== job.prompt_hash || !job.evaluation
      || !await acceptProblemPromptReviewByPolicy(job, {
        promptHash: job.prompt_hash, userStory: job.user_story, evaluation: job.evaluation, attempts: job.attempts,
      })) throw new Error("The automatic requirement acceptance could not be verified. Administrator review is needed.");
    return;
  }
  if (job.attempts >= MAX_EVALUATIONS) throw new Error("The agent could not finish prompt testing after three attempts. Administrator review is needed.");
  if (workflow.prompt.status === "Draft") workflow = await generateImplementationPrompt(orgId, problemId, actor);
  const story = job.user_story || workflow.specification?.userStory;
  if (!story) throw new Error("The expected behavior could not be determined from the feedback.");
  const context = await getPromptAlignmentContext(orgId, problemId, story, actor);
  if (!await mayStartStep()) return;
  const evaluation = await testPromptWithCloseSpanAgent({ orgId, promptHash: context.promptHash,
    userStory: story, implementationPrompt: context.implementationPrompt });
  if (!await reviewLeaseIsCurrent(job)) return;
  if (activationId && evaluation.promptHash !== context.promptHash) {
    throw new Error("The prompt test result does not match the current prompt. Administrator review is needed.");
  }
  const result = { ...evaluation, summary: evaluation.verdict === "Passed"
    ? "The prompt covers the expected behavior." : "The prompt needs changes.", changes: evaluation.changes };
  // A concurrent revision must never inherit this evaluation or confirmation.
  const latest = await getEngineeringWorkflow(orgId, problemId);
  if (latest.prompt?.contentHash !== context.promptHash) throw new Error("The prompt changed during testing. A new review is required.");
  if (evaluation.verdict === "Passed") {
    if (activationId) {
      if (evaluation.changes.length || !latest.readiness.ready || latest.readiness.issues.length) {
        throw new Error("The expected behavior changed during testing. Administrator review is needed.");
      }
      if (await acceptProblemPromptReviewByPolicy(job, { promptHash: context.promptHash,
        userStory: story, evaluation: result, attempts: job.attempts + 1 })) return;
    }
    await finishProblemPromptReview(job, { status: "Ready", promptHash: context.promptHash,
      userStory: story, evaluation: result, attempts: job.attempts + 1 });
    return;
  }
  if (!evaluation.suggestedRevision || job.attempts + 1 >= MAX_EVALUATIONS) {
    await finishProblemPromptReview(job, { status: "Needs attention", promptHash: context.promptHash,
      userStory: story, evaluation: result, attempts: job.attempts + 1,
      failureMessage: "The agent could not produce a passing prompt within three attempts. Administrator review is needed." });
    return;
  }
  if (!await mayStartStep()) return;
  const revised = await applyPromptRevisionWithCloseSpanAgent({ orgId, problemId,
    currentPromptHash: context.promptHash, revisedPrompt: evaluation.suggestedRevision, actor });
  await finishProblemPromptReview(job, { status: "Testing", promptHash: revised.prompt?.contentHash,
    userStory: story, evaluation: result, attempts: job.attempts + 1 });
}
