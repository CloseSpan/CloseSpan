"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUp,
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
  prepareAlignedPromptApproval,
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

type PromptConversationChatMessage = {
  id: string;
  role: "assistant";
  kind: "conversation";
  content: string;
  question: string;
  improved: boolean;
  improvementSummary: string | null;
  suggestedRevision: string | null;
  currentPromptHash: string | null;
  revisionReceipt: string | null;
  provider: string;
  model: string;
  applied: boolean;
  testStarted: boolean;
};

type PromptTestingChatMessage =
  | {
      id: string;
      role: "user";
      content: string;
    }
  | {
      id: string;
      role: "assistant";
      kind: "evaluation";
      aligned: boolean;
      changes: StructuredPddChange[];
      summary: string | null | undefined;
      pddVersion: string;
      executionMode: "cloud" | "local";
      model: string | null;
      costUsd: number | null;
    }
  | PromptConversationChatMessage;

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
          aria-label={`${step.label}: ${step.state}`}
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
          <strong>{step.label}</strong>
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
          <h4>What CloseSpan recommends</h4>
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
        <p>The prompt satisfies your request and is ready for the executable acceptance-contract step.</p>
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
  const initialPromptReview = initialWorkflow.promptEvaluation?.review;
  const initialPromptEvaluationKey = initialPromptReview
    && initialWorkflow.promptEvaluation?.id
    ? `${initialWorkflow.promptEvaluation.id}:${initialPromptReview.promptHash}:${initialPromptReview.verdict}`
    : null;
  const [storedWorkflow, setWorkflow] = useState(initialWorkflow);
  const [repositoryProfileReady, setRepositoryProfileReady] = useState(
    initialRepositoryProfileReady,
  );
  const [userStory, setUserStory] = useState(
    initialWorkflow.specification?.userStory ?? "",
  );
  const [promptQuestion, setPromptQuestion] = useState(
    initialWorkflow.specification?.userStory ?? "",
  );
  const [chatMessages, setChatMessages] = useState<PromptTestingChatMessage[]>(
    () => {
      const messages: PromptTestingChatMessage[] = [];
      if (initialPromptReview && initialPromptEvaluationKey) {
        const changes = structurePddChanges(initialPromptReview.changes);
        messages.push({
          id: `closespan-response-${initialPromptEvaluationKey}`,
          role: "assistant",
          kind: "evaluation",
          aligned: initialPromptReview.verdict === "Passed",
          changes,
          summary: initialPromptReview.verdict === "Needs revision" && changes.length > 0
            ? `Prompt Testing found ${changes.length} ${changes.length === 1 ? "change" : "changes"} to make before approval.`
            : initialPromptReview.summary,
          pddVersion: initialPromptReview.pddVersion,
          executionMode: initialPromptReview.executionMode,
          model: initialPromptReview.model,
          costUsd: initialPromptReview.costUsd,
        });
      }
      return messages;
    },
  );
  const chatEndRef = useRef<HTMLDivElement>(null);
  const lastChatEvaluationRef = useRef<string | null>(
    initialPromptEvaluationKey,
  );
  const [storyTest, setStoryTest] = useState<UserStoryPromptTestView>();
  const [storedError, setError] = useState<string>();
  const [draftBusy, setDraftBusy] = useState(false);
  const [conversationBusy, setConversationBusy] = useState(false);
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

  function testAgainstPrompt(question = userStory) {
    const issue = userStoryInputIssue(question);
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
      userStory: question.trim(),
      estimatedDurationMs: pddTiming.estimatedDurationMs,
      triggerSource: "manual",
    });
  }

  async function submitPromptQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = promptQuestion.trim();
    if (!question || question.length > 2_000 || conversationBusy || busy) {
      if (question.length > 2_000) {
        setError("Enter a prompt question of 2,000 characters or fewer.");
      }
      return;
    }
    const history = chatMessages.slice(-10).map((message) => ({
      role: message.role,
      content: message.role === "user"
        ? message.content
        : message.kind === "conversation"
          ? message.content
          : message.summary ?? message.changes.map((change) => change.summary).join(" "),
    })).filter((message) => message.content.trim());
    setPromptQuestion("");
    setChatMessages((messages) => [
      ...messages,
      {
        id: `product-request-${crypto.randomUUID()}`,
        role: "user",
        content: question,
      },
    ]);
    setConversationBusy(true);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/problems/${problemId}/engineering/prompt-conversation`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-org-id": orgId,
            "idempotency-key": crypto.randomUUID(),
            "x-request-id": crypto.randomUUID(),
          },
          body: JSON.stringify({ message: question, history }),
        },
      );
      const payload = await response.json() as {
        answer?: string;
        improved?: boolean;
        improvementSummary?: string | null;
        suggestedRevision?: string | null;
        currentPromptHash?: string;
        revisionReceipt?: string | null;
        provider?: string;
        model?: string;
        error?: string;
      };
      if (!response.ok || !payload.answer) {
        throw new Error(payload.error ?? "CloseSpan could not answer this prompt question.");
      }
      const answer = payload.answer;
      setChatMessages((messages) => [
        ...messages,
        {
          id: `closespan-conversation-${crypto.randomUUID()}`,
          role: "assistant",
          kind: "conversation",
          content: answer,
          question,
          improved: Boolean(payload.improved),
          improvementSummary: payload.improvementSummary ?? null,
          suggestedRevision: payload.suggestedRevision ?? null,
          currentPromptHash: payload.currentPromptHash ?? null,
          revisionReceipt: payload.revisionReceipt ?? null,
          provider: payload.provider ?? "CloseSpan AI",
          model: payload.model ?? "configured model",
          applied: false,
          testStarted: false,
        },
      ]);
    } catch (cause) {
      setError(cause instanceof Error
        ? cause.message
        : "CloseSpan could not answer this prompt question.");
    } finally {
      setConversationBusy(false);
    }
  }

  async function applyConversationImprovement(
    message: PromptConversationChatMessage,
  ) {
    if (
      revisionBusy
      || busy
      || message.applied
      || !message.improved
      || !message.suggestedRevision
      || !message.currentPromptHash
      || !message.revisionReceipt
    ) return;
    const testedPrompt = workflow.prompt;
    setRevisionBusy(true);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/problems/${problemId}/engineering/apply-conversation-revision`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-org-id": orgId,
            "idempotency-key": crypto.randomUUID(),
            "x-request-id": crypto.randomUUID(),
          },
          body: JSON.stringify({
            message: message.question,
            currentPromptHash: message.currentPromptHash,
            revisedPrompt: message.suggestedRevision,
            revisionReceipt: message.revisionReceipt,
          }),
        },
      );
      const payload = await response.json() as {
        workflow?: EngineeringWorkflowView;
        error?: string;
      };
      if (!response.ok || !payload.workflow?.prompt) {
        throw new Error(payload.error ?? "The prompt improvement could not be applied.");
      }
      const appliedPrompt = payload.workflow.prompt;
      setWorkflow(payload.workflow);
      setChatMessages((messages) => messages.map((candidate) => (
        candidate.id === message.id && candidate.role === "assistant" && candidate.kind === "conversation"
          ? { ...candidate, applied: true, testStarted: true }
          : candidate
      )));
      if (testedPrompt && testedPrompt.contentHash !== appliedPrompt.contentHash) {
        setRecentPromptComparison({
          tested: testedPrompt,
          proposed: {
            revision: appliedPrompt.revision,
            content: appliedPrompt.content,
            contentHash: appliedPrompt.contentHash,
          },
          applied: true,
        });
      }
      discardProblemTasks(problemId);
      startPromptTest({
        problemId,
        userStory: payload.workflow.specification?.userStory ?? userStory,
        estimatedDurationMs: pddTiming.estimatedDurationMs,
        triggerSource: "manual",
      });
    } catch (cause) {
      setError(cause instanceof Error
        ? cause.message
        : "The prompt improvement could not be applied.");
    } finally {
      setRevisionBusy(false);
    }
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
        alignmentReceipt?: string;
        error?: string;
      };
      if (!response.ok || !payload.workflow || !payload.alignmentReceipt) {
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
      const prepared = await prepareAlignedPromptApproval({
        orgId,
        problemId,
        userStory: userStory.trim(),
        evaluationId: result.evaluationId,
        alignmentReceipt: payload.alignmentReceipt,
      });
      setWorkflow(prepared.workflow);
      setStoryTest(prepared.storyTest);
      discardProblemTasks(problemId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The improved prompt could not be applied.");
    } finally {
      setRevisionBusy(false);
    }
  }

  async function overridePromptTest() {
    const evaluationId = backgroundPromptResult?.evaluationId
      ?? workflow.promptEvaluation?.id;
    if (
      revisionBusy
      || !evaluationId
      || !workflow.prompt
      || promptEvaluation?.verdict !== "Needs revision"
      || promptEvaluation.promptHash !== workflow.prompt.contentHash
    ) return;

    setRevisionBusy(true);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/problems/${problemId}/engineering/override-prompt-test`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-org-id": orgId,
            "idempotency-key": crypto.randomUUID(),
            "x-request-id": crypto.randomUUID(),
          },
          body: JSON.stringify({
            evaluationId,
            userStory: userStory.trim(),
            currentPromptHash: workflow.prompt.contentHash,
            reason: "The user accepted the current immutable prompt as-is and chose to proceed to Action approval.",
          }),
        },
      );
      const payload = await response.json() as {
        workflow?: EngineeringWorkflowView;
        alignmentReceipt?: string;
        error?: string;
      };
      if (!response.ok || !payload.workflow || !payload.alignmentReceipt) {
        throw new Error(payload.error ?? "The Prompt Testing override could not be recorded.");
      }
      setWorkflow(payload.workflow);
      setRecentPromptComparison(undefined);
      discardProblemTasks(problemId);
      const prepared = await prepareAlignedPromptApproval({
        orgId,
        problemId,
        userStory: userStory.trim(),
        evaluationId,
        alignmentReceipt: payload.alignmentReceipt,
      });
      setWorkflow(prepared.workflow);
      setStoryTest(prepared.storyTest);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Prompt Testing override could not be recorded.");
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
  const currentPromptEvaluationId = backgroundPromptResult?.evaluationId
    ?? workflow.promptEvaluation?.id;
  const canOverridePromptTest = Boolean(
    currentPromptEvaluationId
    && workflow.prompt
    && promptEvaluation?.verdict === "Needs revision"
    && promptEvaluation.promptHash === workflow.prompt.contentHash,
  );
  const promptEvaluationSummary = incompletePromptEvaluation
    ? "The runner returned an incomplete recommendation. Run Prompt Testing again to rebuild it from the complete generated contract. This partial result cannot be applied."
    : !promptAligned && recommendedChanges.length > 0
      ? `Prompt Testing found ${recommendedChanges.length} ${recommendedChanges.length === 1 ? "change" : "changes"} to make before approval.`
      : promptEvaluation?.summary;
  const displayedPromptStatus = promptEvaluation?.override
    ? "Overridden"
    : promptEvaluation?.verdict ?? promptStatus;
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
  const promptOverrideAction = canOverridePromptTest ? (
    <div className="prompt-override-action">
      <div>
        <strong>Keep the tested prompt as-is</strong>
        <p className="subtle">
          Skip the recommended revision and prepare this immutable prompt for Action approval. CloseSpan records who made this decision.
        </p>
      </div>
      <button
        type="button"
        className="btn secondary"
        disabled={revisionBusy}
        onClick={overridePromptTest}
      >
        <ShieldCheck size={14} aria-hidden="true" />
        {revisionBusy ? "Preparing approval…" : "Override test & prepare approval"}
      </button>
    </div>
  ) : null;
  const promptEvaluationKey = promptEvaluation && currentPromptEvaluationId
    ? `${currentPromptEvaluationId}:${promptEvaluation.promptHash}:${promptEvaluation.verdict}`
    : null;

  useEffect(() => {
    if (
      busy
      || !promptEvaluation
      || !promptEvaluationKey
      || lastChatEvaluationRef.current === promptEvaluationKey
    ) return;
    lastChatEvaluationRef.current = promptEvaluationKey;
    setChatMessages((messages) => [
      ...messages,
      {
        id: `closespan-response-${promptEvaluationKey}`,
        role: "assistant",
        kind: "evaluation",
        aligned: promptAligned,
        changes: incompletePromptEvaluation
          ? []
          : structurePddChanges(promptEvaluation.changes),
        summary: promptEvaluationSummary,
        pddVersion: promptEvaluation.pddVersion,
        executionMode: promptEvaluation.executionMode,
        model: promptEvaluation.model,
        costUsd: promptEvaluation.costUsd,
      },
    ]);
  }, [
    busy,
    promptAligned,
    promptEvaluation,
    promptEvaluationKey,
    promptEvaluationSummary,
    incompletePromptEvaluation,
  ]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [busy, chatMessages, conversationBusy]);

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
                    ? `Revision ${promptComparison.proposed.revision} replaced the tested revision. CloseSpan is preparing its acceptance contract and Action approval now; no additional prompt revision is required.`
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
                  {revisionBusy ? "Preparing approval…" : "Apply & prepare approval"}
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
                    <div className="prompt-english-copy">
                      <p>
                        {promptComparison.applied
                          ? "This is the saved prompt revision produced from your conversation with CloseSpan."
                          : "This proposed revision incorporates CloseSpan's response in the conversation below. Switch to .prompt to inspect the exact immutable content."}
                      </p>
                    </div>
                  )}
                  prompt={promptComparison.proposed.content}
                />
              </article>
            </div>

            {promptOverrideAction}

            {!promptComparison.applied && !suggestedRevisionDiffers && (
              <div className="callout warning" role="status">
                <div className="callout-title"><AlertCircle size={14} />Nothing new to apply</div>
                <p className="subtle">
                  Prompt Testing returned the same prompt content. Run Run prompt test again to create a distinct revision.
                </p>
              </div>
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
              This is the exact prompt CloseSpan will discuss with you below.
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

        {!promptComparison && promptOverrideAction}

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

        <section className="prompt-testing-chat" aria-labelledby="prompt-testing-chat-title">
          <header className="prompt-testing-chat-heading">
            <div>
              <h3 id="prompt-testing-chat-title">Ask CloseSpan about this prompt</h3>
              <p>
                Ask a question, describe the behavior you want, or paste product notes. No user-story template is required, and sending a message never starts Prompt Testing.
              </p>
            </div>
            <span className={`badge ${busy ? "medium" : "brand"}`}>
              {conversationBusy
                ? "Replying"
                : busy
                  ? "Prompt Test running"
                : canTestPrompt
                  ? "Prompt chat"
                  : "Suggested prompt required"}
            </span>
          </header>

          <div className="prompt-testing-chat-thread" role="log" aria-live="polite">
            {chatMessages.length === 0 && (
              <article className="prompt-testing-message is-assistant">
                <span className="prompt-testing-message-author">CloseSpan</span>
                <p>
                  What would you like me to check? You can ask whether the prompt covers a feature, constraint, edge case, or expected outcome.
                </p>
              </article>
            )}
            {chatMessages.map((message) => (
              <article
                className={`prompt-testing-message is-${message.role}`}
                key={message.id}
              >
                <span className="prompt-testing-message-author">
                  {message.role === "user" ? "You" : "CloseSpan"}
                </span>
                {message.role === "user" ? (
                  <p>{message.content}</p>
                ) : message.kind === "conversation" ? (
                  <>
                    <p>{message.content}</p>
                    {message.improved && message.improvementSummary && (
                      <div className="prompt-conversation-improvement" role="status">
                        <CheckCircle2 size={16} aria-hidden="true" />
                        <div>
                          <strong>Prompt improved</strong>
                          <span>{message.improvementSummary}</span>
                        </div>
                      </div>
                    )}
                    {message.improved && (
                      <div className="prompt-testing-message-actions">
                        <button
                          type="button"
                          className="btn primary"
                          disabled={revisionBusy || busy || message.applied}
                          onClick={() => applyConversationImprovement(message)}
                        >
                          <CheckCircle2 size={14} aria-hidden="true" />
                          {message.testStarted
                            ? "Improvement applied · Prompt Test started"
                            : revisionBusy
                              ? "Applying improvement…"
                              : "Apply improvement & run Prompt Test"}
                        </button>
                      </div>
                    )}
                    <details className="pdd-evaluation-technical">
                      <summary>Response details</summary>
                      <p className="subtle">
                        Conversational review · {message.provider} · {message.model}
                      </p>
                    </details>
                  </>
                ) : (
                  <>
                    <PddResultEnglishView
                      aligned={message.aligned}
                      changes={message.changes}
                      summary={message.summary}
                    />
                    <details className="pdd-evaluation-technical">
                      <summary>Technical details</summary>
                      <p className="subtle">
                        Prompt Testing {message.pddVersion} · {message.executionMode === "cloud" ? "Prompt Testing Cloud" : "local fallback"}
                        {message.model ? ` · ${message.model}` : ""}
                        {message.costUsd !== null ? ` · $${message.costUsd.toFixed(4)}` : ""}
                      </p>
                    </details>
                  </>
                )}
              </article>
            ))}
            {conversationBusy && (
              <article className="prompt-testing-message is-assistant is-working">
                <span className="prompt-testing-message-author">CloseSpan</span>
                <div className="prompt-conversation-thinking" role="status">
                  <LoaderCircle className="spin" size={16} aria-hidden="true" />
                  <span>Answering from the current prompt…</span>
                </div>
              </article>
            )}
            {busy && (
              <article className="prompt-testing-message is-assistant is-working">
                <span className="prompt-testing-message-author">CloseSpan</span>
                <div className="pdd-testing-progress" role="status">
                  <div className="pdd-testing-progress-copy">
                    <strong>
                      <span className="pdd-testing-shimmer-text">
                        {promptPreparationLabel(preparationPhase)}
                      </span>
                    </strong>
                    <span>{pddProgress}%</span>
                  </div>
                  <p className="pdd-testing-progress-detail">
                    I’m checking your request against the exact saved prompt. {pddTiming.sampleCount > 0
                      ? `Recent successful checks average ${formatPddDuration(pddTiming.estimatedDurationMs)}.`
                      : `The first check uses a ${formatPddDuration(pddTiming.estimatedDurationMs)} estimate.`}
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
              </article>
            )}
            <div ref={chatEndRef} />
          </div>

          <form
            className="prompt-testing-composer"
            id="pdd-test-controls"
            onSubmit={submitPromptQuestion}
          >
            <textarea
              className="neumorphic-composite-field"
              aria-label="Message CloseSpan about this prompt"
              rows={2}
              maxLength={2_000}
              value={promptQuestion}
              placeholder="Ask CloseSpan to check this prompt…"
              onChange={(event) => {
                setPromptQuestion(event.target.value);
                setError(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button
              type="submit"
              className="prompt-testing-send"
              aria-label={conversationBusy ? "CloseSpan is answering" : "Send message to CloseSpan"}
              disabled={conversationBusy || busy || !canTestPrompt || !promptQuestion.trim()}
            >
              {conversationBusy
                ? <LoaderCircle className="spin" size={18} />
                : <ArrowUp size={18} />}
            </button>
          </form>
          <p className="prompt-testing-composer-hint">
            Press Enter to send · Shift + Enter for a new line
          </p>
          {retryableRun && (
            <div className="prompt-testing-quick-actions">
              <button
                type="button"
                className="btn secondary"
                disabled={busy || Boolean(userStoryInputIssue(userStory))}
                onClick={() => testAgainstPrompt(userStory)}
              >
                <CheckCircle2 size={14} />
                Prepare another coding run
              </button>
            </div>
          )}
        </section>

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
