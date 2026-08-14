"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  ExternalLink,
  LoaderCircle,
  MonitorCheck,
  ShieldCheck,
} from "lucide-react";
import type {
  EngineeringWorkflowView,
  ImplementationPromptView,
  UserStoryPromptTestView,
} from "@/lib/engineering-workflow-repository";
import type { PddPromptTimingSummary } from "@/lib/pdd-prompt-timing-repository";
import { userStoryInputIssue } from "@/lib/user-story-prompt-test";
import {
  autonomyCapabilities,
  type AutonomyLevel,
} from "@/lib/autonomy-policy";
import {
  promptPreparationLabel,
  useBackgroundPromptTests,
} from "./background-prompt-tests";
import { RepositoryMatchReview } from "./repository-match-review";

export interface StructuredPddChange {
  summary: string;
  steps: string[];
}

interface PromptComparisonSnapshot {
  tested: ImplementationPromptView;
  proposed: {
    revision: number;
    content: string;
    contentHash: string | null;
  };
  applied: boolean;
}

export type PreparationStepState = "complete" | "current" | "upcoming";

export interface PreparationStep {
  id: "repository" | "profile" | "prompt" | "alignment" | "acceptance" | "approval";
  label: string;
  state: PreparationStepState;
}

export function EngineeringPreparationSteps({
  steps,
  busy = false,
}: {
  steps: PreparationStep[];
  busy?: boolean;
}) {
  return (
    <ol className="engineering-preparation-steps">
      {steps.map((step) => (
        <li
          className={`engineering-preparation-step is-${step.state}`}
          aria-current={step.state === "current" ? "step" : undefined}
          key={step.id}
        >
          <span className="engineering-preparation-step-icon" aria-hidden="true">
            {step.state === "complete" ? (
              <CheckCircle2 size={18} />
            ) : step.state === "current" && busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : step.state === "current" ? (
              <MonitorCheck size={18} />
            ) : (
              <Circle size={18} />
            )}
          </span>
          <span>
            <small>
              {step.state === "complete"
                ? "Complete"
                : step.state === "current"
                  ? "Current"
                  : "Upcoming"}
            </small>
            <strong>{step.label}</strong>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function engineeringPreparationSteps(input: {
  repositoryProfileReady: boolean;
  promptReady: boolean;
  promptAligned: boolean;
  acceptanceReady: boolean;
  approvalReady: boolean;
}): PreparationStep[] {
  const checkpoints = [
    { id: "repository" as const, label: "Repository confirmed", reached: input.repositoryProfileReady },
    { id: "profile" as const, label: "Execution profile active", reached: input.repositoryProfileReady },
    { id: "prompt" as const, label: "Implementation prompt ready", reached: input.promptReady },
    { id: "alignment" as const, label: "Prompt alignment passed", reached: input.promptAligned },
    { id: "acceptance" as const, label: "Acceptance tests generated", reached: input.acceptanceReady },
    { id: "approval" as const, label: "Action approval ready", reached: input.approvalReady },
  ];
  let waitingForFirstIncomplete = true;
  let previousStepsComplete = true;
  return checkpoints.map((checkpoint) => {
    const complete = previousStepsComplete && checkpoint.reached;
    if (!complete) previousStepsComplete = false;
    if (complete) return { ...checkpoint, state: "complete" };
    if (waitingForFirstIncomplete) {
      waitingForFirstIncomplete = false;
      return { ...checkpoint, state: "current" };
    }
    return { ...checkpoint, state: "upcoming" };
  });
}

type PromptViewMode = "english" | "prompt";

function PromptViewSwitcher({
  ariaLabel,
  english,
  prompt,
}: {
  ariaLabel: string;
  english: ReactNode;
  prompt: string;
}) {
  const [mode, setMode] = useState<PromptViewMode>("english");
  const id = useId();
  const englishPanelId = `${id}-english`;
  const promptPanelId = `${id}-prompt`;

  return (
    <section className="prompt-viewer" aria-label={ariaLabel}>
      <div className="prompt-view-switcher" role="group" aria-label={`${ariaLabel} view`}>
        <button
          type="button"
          aria-pressed={mode === "english"}
          aria-controls={englishPanelId}
          className={mode === "english" ? "is-active" : undefined}
          onClick={() => setMode("english")}
        >
          English
        </button>
        <button
          type="button"
          aria-pressed={mode === "prompt"}
          aria-controls={promptPanelId}
          className={mode === "prompt" ? "is-active" : undefined}
          onClick={() => setMode("prompt")}
        >
          .prompt
        </button>
      </div>
      <div
        id={englishPanelId}
        className="prompt-view-english"
        hidden={mode !== "english"}
      >
        {english}
      </div>
      <pre
        id={promptPanelId}
        className="prompt-view-code"
        hidden={mode !== "prompt"}
      >
        {prompt}
      </pre>
    </section>
  );
}

function TicketEnglishView({
  specification,
}: {
  specification: NonNullable<EngineeringWorkflowView["specification"]>;
}) {
  return (
    <div className="prompt-english-copy">
      <p>{specification.userStory}</p>
      <dl>
        <div>
          <dt>Current behavior</dt>
          <dd>{specification.currentBehavior}</dd>
        </div>
        <div>
          <dt>Expected behavior</dt>
          <dd>{specification.expectedBehavior}</dd>
        </div>
      </dl>
      {specification.acceptanceCriteria.length > 0 && (
        <section>
          <h4>Acceptance criteria</h4>
          <ol>
            {specification.acceptanceCriteria.map((criterion) => (
              <li key={criterion.id}>{criterion.statement}</li>
            ))}
          </ol>
        </section>
      )}
      {specification.businessOutcome && (
        <p><strong>Outcome:</strong> {specification.businessOutcome}</p>
      )}
    </div>
  );
}

function PddResultEnglishView({
  aligned,
  changes,
  summary,
}: {
  aligned: boolean;
  changes: StructuredPddChange[];
  summary: string | null | undefined;
}) {
  return (
    <div className="prompt-english-copy">
      {summary && <p>{summary}</p>}
      {changes.length > 0 ? (
        <section>
          <h4>What Prompt Testing recommends</h4>
          <ol>
            {changes.map((change, index) => (
              <li key={`${index}-${change.summary}`}>
                {change.summary}
                {change.steps.length > 0 && (
                  <ul>{change.steps.map((step) => <li key={step}>{step}</li>)}</ul>
                )}
              </li>
            ))}
          </ol>
        </section>
      ) : aligned ? (
        <p>The prompt matches the user story and is ready for the executable acceptance-contract step.</p>
      ) : null}
    </div>
  );
}

function splitNumberedPddChanges(change: string): string[] {
  const normalized = change.trim().replace(/\s+/g, " ");
  const marker = /(^|\s)(\d+)\.\s+(?=[A-Z"'])/g;
  const matches = Array.from(normalized.matchAll(marker));
  if (matches.length === 0) return [];

  const firstStart = (matches[0].index ?? 0) + matches[0][1].length;
  if (firstStart !== 0) return [];

  return matches
    .map((match, index) => {
      const contentStart = (match.index ?? 0) + match[0].length;
      const nextMatch = matches[index + 1];
      const contentEnd = nextMatch
        ? (nextMatch.index ?? normalized.length) + nextMatch[1].length
        : normalized.length;
      return normalized.slice(contentStart, contentEnd).trim();
    })
    .filter(Boolean);
}

export function structurePddChange(change: string): StructuredPddChange {
  const normalized = change.trim().replace(/\s+/g, " ");
  const [summaryPart, instructionPart] = normalized.split(
    /\s*Follow these specific instructions:\s*/i,
    2,
  );
  const summary = (summaryPart || normalized)
    .replace(/^[-*]\s*/, "")
    .trim();
  if (!instructionPart) return { summary, steps: [] };

  const steps = instructionPart
    .split(/\s+(?=\d+\.\s+)/)
    .map((step) => step.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
  return { summary, steps };
}

export function structurePddChanges(changes: string[]): StructuredPddChange[] {
  return changes.flatMap((change) => {
    const numberedChanges = splitNumberedPddChanges(change);
    if (numberedChanges.length > 0) {
      return numberedChanges.map((summary) => ({ summary, steps: [] }));
    }
    return [structurePddChange(change)];
  });
}

export function pddRecommendationIsComplete(change: string): boolean {
  const trimmed = change.trimEnd();
  if (!trimmed || trimmed.endsWith("...") || trimmed.endsWith("…")) return false;
  return /[.!?;:)}\]"'`]$/.test(trimmed);
}

export function estimatedPddProgress(
  elapsedMs: number,
  estimatedDurationMs: number,
): number {
  const estimate = Math.max(1, estimatedDurationMs);
  if (elapsedMs <= estimate) {
    return Math.round(4 + (91 * elapsedMs) / estimate);
  }
  const overtime = elapsedMs - estimate;
  return Math.min(99, Math.round(95 + 4 * (1 - Math.exp(-overtime / estimate))));
}

export function formatPddDuration(durationMs: number): string {
  const seconds = Math.max(1, Math.round(durationMs / 1_000));
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0
    ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
    : `${minutes}m ${remainingSeconds}s`;
}

export function shouldAutomaticallyPreparePrompt(input: {
  autonomyLevel: AutonomyLevel;
  workflow: EngineeringWorkflowView;
  userStory: string;
  ticketContextMissing: boolean;
  hasBackgroundTask: boolean;
}): boolean {
  const prompt = input.workflow.prompt;
  const hasReachedExecution = Boolean(input.workflow.approval || input.workflow.run);
  const hasActiveContract = Boolean(
    input.workflow.verification
    && !["Failed", "Superseded"].includes(input.workflow.verification.status),
  );
  return Boolean(
    autonomyCapabilities(input.autonomyLevel).preparePrompt
    && prompt
    && ["Draft", "Ready"].includes(prompt.status)
    && !userStoryInputIssue(input.userStory)
    && !input.ticketContextMissing
    && !input.hasBackgroundTask
    && !hasReachedExecution
    && !hasActiveContract
    && !input.workflow.promptEvaluation?.automaticAttempted,
  );
}

export function shouldOfferManualPromptRevision(input: {
  triggerSource?: "automatic" | "manual";
  verdict?: "Passed" | "Needs revision";
  currentPromptHash?: string;
  evaluatedPromptHash?: string;
  suggestedRevision?: string | null;
  revisionReceipt?: string | null;
}): boolean {
  return Boolean(
    input.triggerSource === "manual"
    && input.verdict === "Needs revision"
    && input.currentPromptHash
    && input.currentPromptHash === input.evaluatedPromptHash
    && input.suggestedRevision
    && input.revisionReceipt,
  );
}

export function pddSuggestedRevisionDiffers(
  currentPrompt: string | undefined,
  suggestedRevision: string | null | undefined,
): boolean {
  return Boolean(
    currentPrompt
    && suggestedRevision
    && currentPrompt.trim() !== suggestedRevision.trim(),
  );
}

export function EngineeringTicketPanel({
  orgId,
  problemId,
  initialWorkflow,
  autonomyLevel,
  initialRepositoryProfileReady = true,
  initialPddTiming = {
    estimatedDurationMs: 45_000,
    averageDurationMs: null,
    sampleCount: 0,
  },
}: {
  orgId: string;
  problemId: string;
  initialWorkflow: EngineeringWorkflowView;
  autonomyLevel: AutonomyLevel;
  initialRepositoryProfileReady?: boolean;
  initialPddTiming?: PddPromptTimingSummary;
}) {
  const [storedWorkflow, setWorkflow] = useState(initialWorkflow);
  const [repositoryProfileReady, setRepositoryProfileReady] = useState(
    initialRepositoryProfileReady,
  );
  const [userStory, setUserStory] = useState(
    initialWorkflow.specification?.userStory ?? "",
  );
  const [storyTest, setStoryTest] = useState<UserStoryPromptTestView>();
  const [storedError, setError] = useState<string>();
  const [draftBusy, setDraftBusy] = useState(false);
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [recentPromptComparison, setRecentPromptComparison] =
    useState<PromptComparisonSnapshot>();
  const { tasks, startPromptTest, discardProblemTasks } = useBackgroundPromptTests();
  const backgroundPromptTask = tasks.find((task) => task.problemId === problemId);
  const backgroundPromptResult = backgroundPromptTask?.status === "succeeded"
    ? backgroundPromptTask.result
    : undefined;
  const workflow = backgroundPromptResult?.workflow ?? storedWorkflow;
  const promptEvaluation = backgroundPromptResult?.promptEvaluation
    ?? workflow.promptEvaluation?.review
    ?? undefined;
  const displayedStoryTest = backgroundPromptResult?.storyTest ?? storyTest;
  const pddTiming = backgroundPromptResult?.timing ?? initialPddTiming;
  const error = backgroundPromptTask?.status === "failed"
    ? backgroundPromptTask.error ?? "The story could not be tested against the prompt."
    : workflow.promptEvaluation?.status === "Failed"
      ? workflow.promptEvaluation.failureMessage ?? "The automatic prompt test stopped. Run it manually when you are ready."
      : storedError;
  const acceptancePreparationBlocker =
    !workflow.verification && !workflow.approval && !workflow.run
      ? workflow.promptEvaluation?.acceptancePreparationFailureMessage ?? null
      : null;
  const durablePromptEvaluationRunning = workflow.promptEvaluation?.status === "Running";
  const busy = backgroundPromptTask?.status === "running" || durablePromptEvaluationRunning;
  const pddProgress = backgroundPromptTask?.progress ?? (durablePromptEvaluationRunning ? 4 : 0);
  const preparationPhase = backgroundPromptTask?.phase ?? "evaluating";
  const repositoryNeedsReview = !repositoryProfileReady || Boolean(
    (error ?? acceptancePreparationBlocker)
      && /repository|execution profile|workspace root/i.test(
        error ?? acceptancePreparationBlocker ?? "",
      ),
  );

  useEffect(() => {
    const contractRunning = Boolean(
      workflow.verification
      && ["Queued", "Generating tests"].includes(workflow.verification.status),
    );
    if (!contractRunning && !durablePromptEvaluationRunning) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/problems/${problemId}/engineering`, {
          headers: { "x-org-id": orgId },
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = await response.json() as { workflow: EngineeringWorkflowView };
        setWorkflow(payload.workflow);
        if (payload.workflow.verification) {
          setStoryTest({
            id: payload.workflow.verification.id,
            status: payload.workflow.verification.status,
            message: payload.workflow.verification.summary
              ?? payload.workflow.verification.failureMessage
              ?? "Prompt Testing is preparing the executable acceptance contract.",
            promptHash: payload.workflow.verification.promptHash,
          });
        }
      } catch {
        // A later poll or a manual refresh can recover from a transient read failure.
      }
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [durablePromptEvaluationRunning, orgId, problemId, workflow.verification]);

  function testAgainstPrompt() {
    const issue = userStoryInputIssue(userStory);
    if (issue) {
      setStoryTest(undefined);
      setError(issue);
      return;
    }
    setError(undefined);
    setRecentPromptComparison(undefined);
    setStoryTest(undefined);
    startPromptTest({
      problemId,
      userStory: userStory.trim(),
      estimatedDurationMs: pddTiming.estimatedDurationMs,
      triggerSource: "manual",
    });
  }

  async function createSuggestedPrompt() {
    if (draftBusy) return;
    setDraftBusy(true);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/problems/${problemId}/engineering/draft`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-org-id": orgId,
            "idempotency-key": crypto.randomUUID(),
            "x-request-id": crypto.randomUUID(),
          },
        },
      );
      const payload = await response.json() as {
        workflow?: EngineeringWorkflowView;
        error?: string;
      };
      if (!response.ok || !payload.workflow?.specification) {
        throw new Error(payload.error ?? "The suggested prompt could not be created.");
      }
      setWorkflow(payload.workflow);
      setUserStory(payload.workflow.specification.userStory);
      setStoryTest(undefined);
      setRecentPromptComparison(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The suggested prompt could not be created.");
    } finally {
      setDraftBusy(false);
    }
  }

  async function applyImprovedPrompt() {
    const result = backgroundPromptResult;
    const review = result?.promptEvaluation;
    if (
      !result
      || backgroundPromptTask?.triggerSource !== "manual"
      || review?.verdict !== "Needs revision"
      || !review.suggestedRevision
      || !review.revisionReceipt
    ) return;

    setRevisionBusy(true);
    setError(undefined);
    const testedPrompt = workflow.prompt;
    try {
      const response = await fetch(
        `/api/problems/${problemId}/engineering/apply-pdd-revision`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-org-id": orgId,
            "idempotency-key": crypto.randomUUID(),
            "x-request-id": crypto.randomUUID(),
          },
          body: JSON.stringify({
            evaluationId: result.evaluationId,
            userStory: userStory.trim(),
            currentPromptHash: review.promptHash,
            revisedPrompt: review.suggestedRevision,
            revisionReceipt: review.revisionReceipt,
          }),
        },
      );
      const payload = await response.json() as {
        workflow?: EngineeringWorkflowView;
        error?: string;
      };
      if (!response.ok || !payload.workflow) {
        throw new Error(payload.error ?? "The improved prompt could not be applied.");
      }
      const appliedPrompt = payload.workflow.prompt;
      if (!testedPrompt || !appliedPrompt || appliedPrompt.contentHash === testedPrompt.contentHash) {
        throw new Error("Prompt Testing did not produce a different immutable prompt revision. Test the prompt again before applying it.");
      }
      setRecentPromptComparison({
        tested: testedPrompt,
        proposed: {
          revision: appliedPrompt.revision,
          content: appliedPrompt.content,
          contentHash: appliedPrompt.contentHash,
        },
        applied: true,
      });
      setWorkflow(payload.workflow);
      setStoryTest(undefined);
      discardProblemTasks(problemId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The improved prompt could not be applied.");
    } finally {
      setRevisionBusy(false);
    }
  }

  const promptStatus = workflow.prompt?.status ?? "No prompt yet";
  const retryableRun = Boolean(
    workflow.run && ["Failed", "No changes"].includes(workflow.run.status),
  );
  const preparesPromptAutomatically = autonomyCapabilities(autonomyLevel).preparePrompt;
  const verification = workflow.verification;
  const verificationReady = verification?.status === "Ready for approval";
  const ticketContextMissing = !workflow.specification || !workflow.readiness.ready;
  const canTestPrompt = Boolean(workflow.prompt) || Boolean(
    workflow.specification && workflow.readiness.ready,
  );
  const promptAligned = promptEvaluation?.verdict === "Passed";
  const incompletePromptEvaluation = Boolean(
    promptEvaluation?.verdict === "Needs revision"
    && promptEvaluation.changes.some((change) => !pddRecommendationIsComplete(change)),
  );
  const recommendedChanges = promptEvaluation && !incompletePromptEvaluation
    ? structurePddChanges(promptEvaluation.changes)
    : [];
  const suggestedRevisionDiffers = pddSuggestedRevisionDiffers(
    workflow.prompt?.content,
    promptEvaluation?.suggestedRevision,
  );
  const canApplyImprovedPrompt = !incompletePromptEvaluation && shouldOfferManualPromptRevision({
    triggerSource: backgroundPromptTask?.triggerSource,
    verdict: backgroundPromptResult?.promptEvaluation.verdict,
    currentPromptHash: workflow.prompt?.contentHash,
    evaluatedPromptHash: backgroundPromptResult?.promptEvaluation.promptHash,
    suggestedRevision: backgroundPromptResult?.promptEvaluation.suggestedRevision,
    revisionReceipt: backgroundPromptResult?.promptEvaluation.revisionReceipt,
  }) && suggestedRevisionDiffers;
  const promptEvaluationSummary = incompletePromptEvaluation
    ? "The runner returned an incomplete recommendation. Run Prompt Testing again to rebuild it from the complete generated contract. This partial result cannot be applied."
    : !promptAligned && recommendedChanges.length > 0
      ? `Prompt Testing found ${recommendedChanges.length} ${recommendedChanges.length === 1 ? "change" : "changes"} to make before approval.`
      : promptEvaluation?.summary;
  const displayedPromptStatus = promptEvaluation?.verdict ?? promptStatus;
  const currentPromptLabel = "Agent-written prompt";
  const pendingPromptComparison: PromptComparisonSnapshot | undefined =
    promptEvaluation?.verdict === "Needs revision"
    && workflow.prompt
    && promptEvaluation.promptHash === workflow.prompt.contentHash
    && promptEvaluation.suggestedRevision
      ? {
          tested: workflow.prompt,
          proposed: {
            revision: workflow.prompt.revision + 1,
            content: promptEvaluation.suggestedRevision,
            contentHash: null,
          },
          applied: false,
        }
      : undefined;
  const promptComparison = recentPromptComparison ?? pendingPromptComparison;
  useEffect(() => {
    if (!repositoryProfileReady) return;
    if (!shouldAutomaticallyPreparePrompt({
      autonomyLevel,
      workflow,
      userStory,
      ticketContextMissing,
      hasBackgroundTask: Boolean(backgroundPromptTask),
    })) return;
    startPromptTest({
      problemId,
      userStory: userStory.trim(),
      estimatedDurationMs: pddTiming.estimatedDurationMs,
      triggerSource: "automatic",
    });
  }, [
    autonomyLevel,
    backgroundPromptTask,
    pddTiming.estimatedDurationMs,
    problemId,
    repositoryProfileReady,
    startPromptTest,
    ticketContextMissing,
    userStory,
    workflow,
  ]);

  return (
    <section className="card section-gap" id="engineering-ticket">
      <div className="card-head">
        <div>
          <h2>Improve the suggested prompt</h2>
          <p className="subtle">
            {preparesPromptAutomatically
              ? "CloseSpan validates this immutable prompt once, applies at most one bounded improvement, then leaves the saved result ready for review."
              : "Review the immutable suggested prompt, then run Prompt Testing manually when you are ready to evaluate it."}
          </p>
        </div>
        <span
          className={`badge ${verificationReady ? "success" : "medium"}`}
        >
          {displayedPromptStatus}
        </span>
      </div>

      <div className="card-body detail-stack">
        {workflow.prompt?.status === "Draft" && (
          <div className="callout" role="status">
            <div className="callout-title">Agent-created prompt queued for Prompt Testing</div>
            <p className="subtle">
              {preparesPromptAutomatically
                ? "CloseSpan will validate this draft once, apply at most one immutable improvement, and will not restart the check when you revisit this page."
                : "This autonomy policy leaves prompt evaluation under your control. Choose Run prompt test when you are ready."}
            </p>
            {workflow.prompt.draftReason && <p className="subtle">{workflow.prompt.draftReason}</p>}
            {workflow.prompt.reviewerId && (
              <p className="subtle">
                Reviewer: {workflow.prompt.reviewerName ?? workflow.prompt.reviewerId}
                {workflow.prompt.reviewerNotificationRequested ? " · notification created" : ""}
                {workflow.prompt.reviewerEmailNotificationRequested ? " · email queued" : ""}
              </p>
            )}
          </div>
        )}
        {workflow.prompt?.evidenceBinding?.repositoryContext && (
          <section className="prompt-evidence-binding" aria-label="Prompt evidence provenance">
            <div>
              <ShieldCheck size={16} aria-hidden="true" />
              <span>
                <strong>Exact repository context</strong>
                {" · "}{workflow.prompt.evidenceBinding.repositoryContext.repository}
                @{workflow.prompt.evidenceBinding.repositoryContext.commitSha.slice(0, 12)}
              </span>
            </div>
            <div>
              <span>
                {workflow.prompt.evidenceBinding.repositoryContext.matchCount} cited source {workflow.prompt.evidenceBinding.repositoryContext.matchCount === 1 ? "match" : "matches"}
              </span>
              {workflow.prompt.evidenceBinding.runtimeVerification && (
                <span className="badge success">
                  Runtime {workflow.prompt.evidenceBinding.runtimeVerification.outcome.toLowerCase()}
                </span>
              )}
            </div>
          </section>
        )}
        {promptComparison ? (
          <section
            className={`prompt-comparison${promptComparison.applied ? " is-applied" : ""}`}
            aria-labelledby="prompt-comparison-title"
          >
            <div className="prompt-comparison-heading">
              <div className="prompt-comparison-heading-copy">
                <h3 id="prompt-comparison-title">
                  {promptComparison.applied
                    ? "Prompt Testing revision applied · Improved prompt is now current"
                    : "Prompt Testing comparison · Review the proposed prompt"}
                </h3>
                <p className="subtle">
                  {promptComparison.applied
                    ? `Revision ${promptComparison.proposed.revision} replaced the tested revision. Run Prompt Testing again only if you want to evaluate this new immutable prompt.`
                    : "Compare the exact prompt Prompt Testing tested with the proposed immutable replacement before applying it."}
                </p>
              </div>
              {!promptComparison.applied && canApplyImprovedPrompt && (
                <button
                  type="button"
                  className="btn primary"
                  disabled={revisionBusy}
                  onClick={applyImprovedPrompt}
                >
                  <CheckCircle2 size={14} />
                  {revisionBusy ? "Applying…" : "Apply improved prompt"}
                </button>
              )}
            </div>

            <div className="prompt-comparison-grid">
              <article className="prompt-comparison-version">
                <div className="prompt-comparison-version-heading">
                  <div>
                    <h4>Tested prompt · Revision {promptComparison.tested.revision}</h4>
                  </div>
                  <span className="badge">SHA {promptComparison.tested.contentHash.slice(0, 10)}</span>
                </div>
                <PromptViewSwitcher
                  ariaLabel={`Tested prompt revision ${promptComparison.tested.revision}`}
                  english={workflow.specification
                    ? <TicketEnglishView specification={workflow.specification} />
                    : <p>This is the exact immutable prompt Prompt Testing evaluated.</p>}
                  prompt={promptComparison.tested.content}
                />
              </article>

              <article className={`prompt-comparison-version current${promptComparison.applied ? " applied" : ""}`}>
                <div className="prompt-comparison-version-heading">
                  <div>
                    <h4>
                      {promptComparison.applied ? "Current prompt" : "Proposed prompt"}
                      {" · "}Revision {promptComparison.proposed.revision}
                    </h4>
                  </div>
                  <span className={`badge ${promptComparison.applied ? "success" : "brand"}`}>
                    {promptComparison.applied
                      ? `SHA ${promptComparison.proposed.contentHash?.slice(0, 10)}`
                      : suggestedRevisionDiffers
                        ? "Ready to apply"
                        : "No new revision"}
                  </span>
                </div>
                <PromptViewSwitcher
                  ariaLabel={`${promptComparison.applied ? "Current" : "Proposed"} prompt revision ${promptComparison.proposed.revision}`}
                  english={(
                    <PddResultEnglishView
                      aligned={promptAligned}
                      changes={recommendedChanges}
                      summary={promptEvaluationSummary}
                    />
                  )}
                  prompt={promptComparison.proposed.content}
                />
              </article>
            </div>

            {!promptComparison.applied && !suggestedRevisionDiffers && (
              <div className="callout warning" role="status">
                <div className="callout-title"><AlertCircle size={14} />Nothing new to apply</div>
                <p className="subtle">
                  Prompt Testing returned the same prompt content. Run Run prompt test again to create a distinct revision.
                </p>
              </div>
            )}

            {!promptComparison.applied && recommendedChanges.length > 0 && (
              <section className="prompt-comparison-changes" aria-labelledby="pdd-recommended-changes">
                <div className="prompt-comparison-changes-heading">
                  <strong id="pdd-recommended-changes">What Prompt Testing changed</strong>
                  <span className="badge medium">
                    {recommendedChanges.length} {recommendedChanges.length === 1 ? "change" : "changes"}
                  </span>
                </div>
                <div className="pdd-change-list">
                  {recommendedChanges.map((structured, index) => (
                    <article className="pdd-change-card" key={`${index}-${structured.summary}`}>
                      <span className="pdd-change-number">{index + 1}</span>
                      <div>
                        <h4>{structured.summary}</h4>
                        {structured.steps.length > 0 && (
                          <ol>
                            {structured.steps.map((step) => <li key={step}>{step}</li>)}
                          </ol>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {!promptComparison.applied && promptEvaluation && (
              <details className="pdd-evaluation-technical">
                <summary>Technical details</summary>
                <p className="subtle">
                  Prompt Testing {promptEvaluation.pddVersion} · {promptEvaluation.executionMode === "cloud" ? "Prompt Testing Cloud" : "local fallback"}
                  {promptEvaluation.model ? ` · ${promptEvaluation.model}` : ""}
                  {promptEvaluation.costUsd !== null ? ` · $${promptEvaluation.costUsd.toFixed(4)}` : ""}
                </p>
              </details>
            )}
          </section>
        ) : workflow.prompt ? (
          <section className="prompt-version-card" aria-label="Prompt currently under test">
            <div className="prompt-version-heading">
              <div>
                <h3>{currentPromptLabel} · Revision {workflow.prompt.revision}</h3>
              </div>
              <span className="badge brand">SHA {workflow.prompt.contentHash.slice(0, 10)}</span>
            </div>
            <p className="subtle">
              This is the exact prompt Prompt Testing will compare with the user story below.
            </p>
            <PromptViewSwitcher
              ariaLabel="Prompt currently under test"
              english={workflow.specification
                ? <TicketEnglishView specification={workflow.specification} />
                : <p>This is the exact immutable prompt Prompt Testing will evaluate.</p>}
              prompt={workflow.prompt.content}
            />
          </section>
        ) : null}

        {promptEvaluation && !promptComparison && (
          <div
            className={`callout pdd-evaluation-result ${promptAligned ? "success" : "warning"}`}
            role="status"
          >
            <div className="callout-title">
              {promptAligned ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
              {incompletePromptEvaluation
                ? "Prompt Testing result incomplete"
                : promptAligned
                  ? "Prompt alignment passed"
                  : "Prompt Testing needs another evaluation"}
            </div>
            {workflow.prompt ? (
              <PromptViewSwitcher
                ariaLabel="Saved Prompt Testing response"
                english={(
                  <PddResultEnglishView
                    aligned={promptAligned}
                    changes={recommendedChanges}
                    summary={promptEvaluationSummary}
                  />
                )}
                prompt={promptEvaluation.suggestedRevision ?? workflow.prompt.content}
              />
            ) : (
              <p>{promptEvaluationSummary}</p>
            )}
            <details className="pdd-evaluation-technical">
              <summary>Technical details</summary>
              <p className="subtle">
                Prompt Testing {promptEvaluation.pddVersion} · {promptEvaluation.executionMode === "cloud" ? "Prompt Testing Cloud" : "local fallback"}
                {promptEvaluation.model ? ` · ${promptEvaluation.model}` : ""}
                {promptEvaluation.costUsd !== null ? ` · $${promptEvaluation.costUsd.toFixed(4)}` : ""}
              </p>
            </details>
          </div>
        )}

        {acceptancePreparationBlocker && (
          <div
            className="callout warning pdd-preparation-blocker"
            role="alert"
          >
            <div className="callout-title">
              <AlertCircle size={14} />
              Execution setup blocked
            </div>
            <p>{acceptancePreparationBlocker}</p>
            <p className="subtle">
              Prompt alignment remains valid. Confirm the repository and active
              execution profile, then run Run prompt test again.
            </p>
          </div>
        )}

        <label className="field">
          User story
          <textarea
            rows={5}
            value={userStory}
            placeholder="As a customer, I want…, so that…"
            onChange={(event) => {
              setUserStory(event.target.value);
              setStoryTest(undefined);
              setError(undefined);
              setRecentPromptComparison(undefined);
            }}
          />
        </label>
        <p className="subtle">
          Use the format: As a…, I want…, so that…
        </p>

        <div className="top-actions" id="pdd-test-controls">
          <button
            type="button"
            className="btn primary"
            disabled={busy || !canTestPrompt}
            onClick={testAgainstPrompt}
          >
            <CheckCircle2 size={14} />
            <span className={busy ? "pdd-testing-shimmer-text" : undefined}>
              {busy
                ? "Testing prompt"
                : canTestPrompt
                  ? retryableRun
                    ? "Prepare another coding run"
                    : backgroundPromptTask?.status === "failed"
                    ? "Run prompt test again"
                    : "Run prompt test"
                  : "Suggested prompt required"}
            </span>
          </button>
        </div>

        {ticketContextMissing && (
          <div className="callout warning" role="status">
            <div className="callout-title"><AlertCircle size={14} />Ticket context needs review</div>
            <p className="subtle">
              {!workflow.specification
                ? "Create the suggested implementation prompt from the verified investigation and repository context."
                : preparesPromptAutomatically
                ? "CloseSpan will start one automatic prompt test when the implementation scope is complete."
                : "Complete the implementation scope, then choose Run prompt test when you are ready."}
            </p>
            <ul className="evidence-list">
              {workflow.readiness.issues.slice(0, 4).map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
            {!workflow.specification && (
              <div className="top-actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={draftBusy}
                  onClick={createSuggestedPrompt}
                >
                  {draftBusy ? <LoaderCircle className="spin" size={14} /> : <CheckCircle2 size={14} />}
                  {draftBusy ? "Creating suggested prompt…" : "Create suggested prompt"}
                </button>
              </div>
            )}
          </div>
        )}

        {busy && (
          <div className="pdd-testing-progress" role="status" aria-live="polite">
            <div className="pdd-testing-progress-copy">
              <strong>{promptPreparationLabel(preparationPhase)}</strong>
              <span>{pddProgress}%</span>
            </div>
            <p className="pdd-testing-progress-detail">
              This continues in the background. Automatic mode runs once for this ticket revision. {pddTiming.sampleCount > 0
                ? `Recent successful tests average ${formatPddDuration(pddTiming.estimatedDurationMs)}.`
                : `The first run uses a ${formatPddDuration(pddTiming.estimatedDurationMs)} estimate.`}
            </p>
            <div
              className="pdd-testing-progress-track"
              role="progressbar"
              aria-label="Prompt evaluation in progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pddProgress}
            >
              <span style={{ inlineSize: `${pddProgress}%` }} />
            </div>
          </div>
        )}

        {!busy && workflow.promptEvaluation?.triggerSource === "automatic" && (
          <div className="callout pdd-automatic-review-ready" role="status">
            <div className="callout-title">
              <CheckCircle2 size={14} />
              Automatic prompt test complete
            </div>
            <p className="subtle">
              {workflow.promptEvaluation.applied
                ? "CloseSpan applied one immutable improvement and stopped. Review the current prompt; use Run prompt test only if you want to evaluate it again."
                : workflow.promptEvaluation.review
                  ? "The saved result is ready for review. CloseSpan will not rerun it when you revisit this page."
                  : "This existing revision is marked complete and will not rerun automatically. Choose Run prompt test only if you want a fresh saved result."}
            </p>
          </div>
        )}

        {displayedStoryTest && (
          <div
            className={`callout ${displayedStoryTest.status === "Failed" ? "warning" : ""}`}
            role="status"
          >
            <div className="callout-title">
              {displayedStoryTest.status === "Ready for approval" ? (
                <CheckCircle2 size={14} />
              ) : (
                <AlertCircle size={14} />
              )}
              {displayedStoryTest.status === "Ready for approval"
                ? "Executable contract ready"
                : displayedStoryTest.status}
            </div>
            <p className="subtle">{displayedStoryTest.message}</p>
            <p className="subtle">Prompt SHA-256: {displayedStoryTest.promptHash}</p>
          </div>
        )}

        {verificationReady && verification && (
          <div className="callout" role="region" aria-label="Prompt Testing acceptance contract">
            <div className="callout-title">
              <CheckCircle2 size={14} />
              What the proposed solution must prove
            </div>
            <p className="subtle">{verification.summary}</p>
            <ul className="evidence-list">
              {verification.generatedTests.map((test) => (
                <li key={test.path}>
                  <strong>{test.path}</strong> — run with <code>{test.command}</code>
                </li>
              ))}
            </ul>
            <details>
              <summary>Technical details</summary>
              <p className="subtle">
                Prompt Testing {verification.pddVersion} · model {verification.model ?? "provider default"}
                {verification.costUsd === null ? ` · budget $${verification.budgetUsd.toFixed(2)}` : ` · cost $${verification.costUsd.toFixed(4)}`}
              </p>
              <p className="subtle">Generated files are hash-locked and cannot be edited by the coding agent.</p>
            </details>
          </div>
        )}

        {verificationReady &&
          workflow.approval?.status === "Pending" && (
            <>
              <div
                className="callout implementation-approval-callout"
                role="region"
                aria-label="Implementation approval"
              >
                <div className="callout-title">
                  <ShieldCheck size={14} />
                  Ready for one isolated run
                </div>
                <p className="subtle">
                  This approval is bound to prompt revision {workflow.prompt?.revision},
                  repository {workflow.approval.repository}, and base commit {workflow.approval.baseSha}.
                  CloseSpan will run the coding agent in a fresh Tenki microVM, verify the
                  result in a second isolated session, and open a draft pull request only
                  if verification passes.
                </p>
              </div>
              <div className="workflow-callout-actions implementation-approval-actions">
                <Link className="btn primary" href="/approvals">
                  Review execution approval
                </Link>
              </div>
            </>
          )}

        {workflow.run && (
          <>
            <div className={`callout ${retryableRun ? "warning" : ""}`} role="status">
              <div className="callout-title">
                {workflow.run.status === "Failed"
                  ? "Previous coding run failed"
                  : workflow.run.status === "No changes"
                    ? "Coding run returned no changes"
                    : `Run ${workflow.run.status}`}
              </div>
              <p className="subtle">
                {workflow.run.status === "Failed"
                  ? "This one-run authorization ended before a draft pull request was opened. Review the failure, then prepare another coding run to reuse the immutable prompt and acceptance contract with a fresh approval."
                  : workflow.run.status === "No changes"
                    ? "The coding agent did not produce repository changes. Review the run, then prepare another coding run if the implementation still needs work."
                    : "The approved run continues automatically. Open the run to follow coding, tests, independent verification, and the draft pull request."}
              </p>
            </div>
            <div className="workflow-callout-actions agent-run-actions">
              <Link className="btn secondary" href={`/agent-runs/${workflow.run.id}`}>
                {retryableRun ? "Review run" : "View run"}
              </Link>
            </div>
          </>
        )}

        {workflow.releaseEvidence && (
          <div
            className={`callout ${workflow.releaseEvidence.status === "Failed" ? "warning" : ""}`}
            role="region"
            aria-label="Production release verification"
          >
            <div className="callout-title">
              <MonitorCheck size={14} />
              Production verification {workflow.releaseEvidence.status.toLowerCase()}
            </div>
            <p className="subtle">{workflow.releaseEvidence.evidence}</p>
            {workflow.releaseEvidence.productionVerification ? (
              <>
                <div className="release-verification-sections" role="list" aria-label="Production verification sections">
                  {([
                    ["Backend", workflow.releaseEvidence.productionVerification.backend],
                    ["Frontend", workflow.releaseEvidence.productionVerification.frontend],
                  ] as const).map(([label, section]) => (
                    <div className="release-verification-section" role="listitem" key={label}>
                      <span>
                        {section.status === "Passed" ? (
                          <CheckCircle2 size={14} aria-hidden="true" />
                        ) : section.status === "Failed" ? (
                          <AlertCircle size={14} aria-hidden="true" />
                        ) : (
                          <ShieldCheck size={14} aria-hidden="true" />
                        )}
                        <strong>{label}</strong>
                      </span>
                      <span className="subtle">
                        {section.status} · {section.passedChecks} of {section.totalChecks} checks passed
                      </span>
                    </div>
                  ))}
                </div>
                <p className="subtle">Environment: {workflow.releaseEvidence.environment}</p>
                <div className="top-actions">
                  {workflow.releaseEvidence.productionVerification.captures.map((capture) => (
                    <a
                      className="btn secondary"
                      href={`/api/release-verifications/${workflow.releaseEvidence!.productionVerification!.jobId}/artifacts/${encodeURIComponent(capture.key)}`}
                      target="_blank"
                      rel="noreferrer"
                      key={capture.key}
                    >
                      {capture.viewport} screenshot <ExternalLink size={13} />
                    </a>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        )}

        {repositoryNeedsReview && (
          <section
            className="detail-stack"
            id="repository-execution-context"
            aria-label="Repository execution context"
          >
            <div>
              <h3>Confirm the repository execution context</h3>
              <p className="subtle">Resolve this exception, then retry approval preparation.</p>
            </div>
            <RepositoryMatchReview
              orgId={orgId}
              problemId={problemId}
              onPddProfileReady={setRepositoryProfileReady}
            />
          </section>
        )}

        {error && <p className="toast error" role="alert">{error}</p>}
      </div>
    </section>
  );
}
