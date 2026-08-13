"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertCircle, CheckCircle2, LoaderCircle, X } from "lucide-react";
import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  EngineeringWorkflowView,
  UserStoryPromptTestView,
} from "@/lib/engineering-workflow-repository";
import type { PddPromptReview } from "@/lib/pdd-prompt-review";
import type { PddPromptTimingSummary } from "@/lib/pdd-prompt-timing-repository";
import type { AutonomyLevel } from "@/lib/autonomy-policy";

export interface PromptTestResult {
  workflow: EngineeringWorkflowView;
  evaluationId: string;
  promptEvaluation: PddPromptReview;
  timing: PddPromptTimingSummary & { durationMs: number };
  storyTest?: UserStoryPromptTestView;
}

export type PromptPreparationPhase =
  | "evaluating"
  | "applying-revision"
  | "retesting"
  | "generating-contract"
  | "waiting-for-approval";

export interface BackgroundPromptTest {
  id: string;
  problemId: string;
  userStory: string;
  triggerSource: "automatic" | "manual";
  status: "running" | "succeeded" | "failed";
  startedAt: number;
  elapsedMs: number;
  estimatedDurationMs: number;
  progress: number;
  phase: PromptPreparationPhase;
  result?: PromptTestResult;
  error?: string;
  acknowledged: boolean;
}

interface BackgroundPromptTestContextValue {
  tasks: BackgroundPromptTest[];
  startPromptTest: (input: {
    problemId: string;
    userStory: string;
    estimatedDurationMs: number;
    triggerSource: "automatic" | "manual";
  }) => string;
  acknowledgeTask: (id: string) => void;
  discardProblemTasks: (problemId: string) => void;
}

const BackgroundPromptTestContext = createContext<BackgroundPromptTestContextValue | null>(null);

function estimatedProgress(elapsedMs: number, estimatedDurationMs: number): number {
  const estimate = Math.max(1, estimatedDurationMs);
  if (elapsedMs <= estimate) return Math.round(4 + (91 * elapsedMs) / estimate);
  const overtime = elapsedMs - estimate;
  return Math.min(99, Math.round(95 + 4 * (1 - Math.exp(-overtime / estimate))));
}

export function promptPreparationLabel(phase: PromptPreparationPhase): string {
  switch (phase) {
    case "applying-revision": return "Applying the Prompt Testing improvement";
    case "retesting": return "Retesting the immutable revision";
    case "generating-contract": return "Generating repository acceptance tests";
    case "waiting-for-approval": return "Creating the agent execution approval";
    default: return "Evaluating the suggested prompt";
  }
}

async function jsonRequest<T>(path: string, orgId: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "x-org-id": orgId,
      "idempotency-key": crypto.randomUUID(),
      "x-request-id": crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Agent approval preparation failed");
  return payload;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

type JsonRequester = <T>(path: string, orgId: string, body?: unknown) => Promise<T>;

export async function prepareAgentApproval(input: {
  orgId: string;
  problemId: string;
  userStory: string;
  triggerSource: "automatic" | "manual";
  onPhase?: (phase: PromptPreparationPhase) => void;
  request?: JsonRequester;
  wait?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
}): Promise<PromptTestResult> {
  const request = input.request ?? jsonRequest;
  const waitFor = input.wait ?? wait;
  const evaluation = await request<PromptTestResult>(
    `/api/problems/${input.problemId}/engineering/test-story`,
    input.orgId,
    { userStory: input.userStory, triggerSource: input.triggerSource },
  );

  if (evaluation.promptEvaluation.verdict === "Needs revision") {
    // Manual checks stop at the review boundary so the user can inspect and
    // explicitly apply the immutable replacement. Automatic preparation may
    // apply one bounded revision without turning every page visit into a loop.
    if (input.triggerSource === "manual") return evaluation;

    const proposed = evaluation.promptEvaluation.suggestedRevision;
    const receipt = evaluation.promptEvaluation.revisionReceipt;
    if (!proposed || !receipt) {
      throw new Error("Prompt Testing requested a revision but did not return a safe immutable replacement. Review the prompt manually.");
    }
    input.onPhase?.("applying-revision");
    const applied = await request<{ workflow: EngineeringWorkflowView }>(
      `/api/problems/${input.problemId}/engineering/apply-pdd-revision`,
      input.orgId,
      {
        evaluationId: evaluation.evaluationId,
        userStory: input.userStory,
        currentPromptHash: evaluation.promptEvaluation.promptHash,
        revisedPrompt: proposed,
        revisionReceipt: receipt,
      },
    );
    return {
      ...evaluation,
      workflow: applied.workflow,
    };
  }

  if (evaluation.promptEvaluation.verdict !== "Passed" || !evaluation.promptEvaluation.alignmentReceipt) {
    throw new Error("Prompt Testing did not approve the prompt for repository execution. Review the result and retry.");
  }

  input.onPhase?.("generating-contract");
  const acceptance = await request<{
    workflow: EngineeringWorkflowView;
    storyTest: UserStoryPromptTestView;
    autonomyLevel?: AutonomyLevel;
  }>(
    `/api/problems/${input.problemId}/engineering/generate-acceptance`,
    input.orgId,
    {
      evaluationId: evaluation.evaluationId,
      userStory: input.userStory,
      alignmentReceipt: evaluation.promptEvaluation.alignmentReceipt,
    },
  );
  let finalWorkflow = acceptance.workflow;
  let finalStoryTest = acceptance.storyTest;
  const autonomyLevel = acceptance.autonomyLevel ?? "Execute with approval";

  const reachedAutonomyBoundary = (): boolean => {
    if (autonomyLevel === "Recommend") {
      return finalWorkflow.verification?.status === "Ready for approval";
    }
    if (autonomyLevel === "Full autonomy") {
      return Boolean(
        finalWorkflow.run
        || finalWorkflow.approval?.status === "Approved"
        || finalWorkflow.approval?.status === "Pending",
      );
    }
    return finalWorkflow.approval?.status === "Pending";
  };

  if (!reachedAutonomyBoundary()) {
    input.onPhase?.("waiting-for-approval");
    const deadline = Date.now() + (input.timeoutMs ?? 5 * 60_000);
    while (Date.now() < deadline) {
      if (finalWorkflow.verification?.status === "Failed") {
        throw new Error(finalWorkflow.verification.failureMessage ?? "Repository acceptance generation failed.");
      }
      await waitFor(2_000);
      const latest = await request<{ workflow: EngineeringWorkflowView }>(
        `/api/problems/${input.problemId}/engineering`,
        input.orgId,
      );
      finalWorkflow = latest.workflow;
      if (finalWorkflow.verification) {
        finalStoryTest = {
          id: finalWorkflow.verification.id,
          status: finalWorkflow.verification.status,
          message: finalWorkflow.verification.summary
            ?? finalWorkflow.verification.failureMessage
            ?? "Prompt Testing is preparing the repository acceptance contract.",
          promptHash: finalWorkflow.verification.promptHash,
        };
      }
      if (reachedAutonomyBoundary()) break;
    }
  }

  if (!reachedAutonomyBoundary()) {
    throw new Error("The acceptance contract did not reach the workspace autonomy boundary in time. Retry to reconcile its current state.");
  }

  return {
    ...evaluation,
    workflow: finalWorkflow,
    storyTest: finalStoryTest,
  };
}

export function formatApproximateTimeLeft(remainingMs: number): string {
  if (remainingMs <= 0) return "Finishing up";
  const seconds = Math.ceil(remainingMs / 1_000);
  if (seconds < 10) return "Less than 10s left";
  const roundedSeconds = Math.ceil(seconds / 5) * 5;
  if (roundedSeconds < 60) return `~${roundedSeconds}s left`;
  const minutes = Math.floor(roundedSeconds / 60);
  const remainder = roundedSeconds % 60;
  return remainder === 0
    ? `~${minutes}m left`
    : `~${minutes}m ${remainder}s left`;
}

export function BackgroundPromptTestProvider({
  orgId,
  children,
  avoidGuidedDemo = false,
}: {
  orgId: string;
  children: ReactNode;
  avoidGuidedDemo?: boolean;
}) {
  const [tasks, setTasks] = useState<BackgroundPromptTest[]>([]);
  const hasRunningTask = tasks.some((task) => task.status === "running");

  useEffect(() => {
    if (!hasRunningTask) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setTasks((current) => current.map((task) => task.status === "running"
        ? {
            ...task,
            elapsedMs: now - task.startedAt,
            progress: estimatedProgress(now - task.startedAt, task.estimatedDurationMs),
          }
        : task));
    }, 250);
    return () => window.clearInterval(timer);
  }, [hasRunningTask]);

  const startPromptTest = useCallback((input: {
    problemId: string;
    userStory: string;
    estimatedDurationMs: number;
    triggerSource: "automatic" | "manual";
  }) => {
    const id = crypto.randomUUID();
    const task: BackgroundPromptTest = {
      id,
      problemId: input.problemId,
      userStory: input.userStory,
      triggerSource: input.triggerSource,
      status: "running",
      startedAt: Date.now(),
      elapsedMs: 0,
      estimatedDurationMs: input.estimatedDurationMs,
      progress: 4,
      phase: "evaluating",
      acknowledged: false,
    };
    setTasks((current) => [task, ...current.filter((item) => item.problemId !== input.problemId)]);

    const setPhase = (phase: PromptPreparationPhase) => {
      setTasks((current) => current.map((item) => item.id === id
        ? { ...item, phase }
        : item));
    };

    void prepareAgentApproval({
      orgId,
      problemId: input.problemId,
      userStory: input.userStory,
      triggerSource: input.triggerSource,
      onPhase: setPhase,
    })
      .then((result) => {
        setTasks((current) => current.map((item) => item.id === id
        ? {
            ...item,
            status: "succeeded",
            progress: 100,
            result,
          }
        : item));
      })
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : "The prompt test failed";
        setTasks((current) => current.map((item) => item.id === id
          ? { ...item, status: "failed", error: message }
          : item));
      });
    return id;
  }, [orgId]);

  const acknowledgeTask = useCallback((id: string) => {
    setTasks((current) => current.map((task) => task.id === id
      ? { ...task, acknowledged: true }
      : task));
  }, []);

  const discardProblemTasks = useCallback((problemId: string) => {
    setTasks((current) => current.filter((task) => task.problemId !== problemId));
  }, []);

  const value = useMemo(() => ({
    tasks,
    startPromptTest,
    acknowledgeTask,
    discardProblemTasks,
  }), [tasks, startPromptTest, acknowledgeTask, discardProblemTasks]);

  return (
    <BackgroundPromptTestContext.Provider value={value}>
      {children}
      <PromptTestDock
        tasks={tasks}
        acknowledgeTask={acknowledgeTask}
        avoidGuidedDemo={avoidGuidedDemo}
      />
    </BackgroundPromptTestContext.Provider>
  );
}

function PromptTestDock({
  tasks,
  acknowledgeTask,
  avoidGuidedDemo,
}: {
  tasks: BackgroundPromptTest[];
  acknowledgeTask: (id: string) => void;
  avoidGuidedDemo: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const visibleTasks = tasks.filter((task) => !task.acknowledged);
  return (
    <aside
      className={`prompt-test-dock ${avoidGuidedDemo ? "prompt-test-dock-above-guide" : ""}`}
      aria-label="Background prompt tests"
    >
      <AnimatePresence initial={false}>
        {visibleTasks.map((task) => {
          const running = task.status === "running";
          const failed = task.status === "failed";
          const approvalReady = task.result?.workflow.approval?.status === "Pending";
          return (
            <motion.div
              key={task.id}
              layout
              initial={reduceMotion ? false : { opacity: 0, y: 18, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}
              className={`prompt-test-dock-item ${failed ? "failed" : task.status === "succeeded" ? "succeeded" : ""}`}
            >
              <Link
                href={`/pdd/${encodeURIComponent(task.problemId)}#engineering-ticket`}
                className="prompt-test-dock-link"
                onClick={() => acknowledgeTask(task.id)}
              >
                <span className="prompt-test-dock-icon" aria-hidden="true">
                  {running ? <LoaderCircle className="prompt-test-dock-spinner" /> : failed ? <AlertCircle /> : <CheckCircle2 />}
                </span>
                <span className="prompt-test-dock-copy">
                  <strong>{running ? "Checking the suggested prompt" : failed ? "Prompt check stopped" : approvalReady ? "Agent approval ready" : "Prompt result ready"}</strong>
                  <small>{running ? `${promptPreparationLabel(task.phase)} · ${task.progress}%` : failed ? "Open to review or run again" : approvalReady ? "Review in Action approvals" : "Review the Prompt Testing result"}</small>
                  {running && (
                    <small className="prompt-test-dock-eta">
                      {formatApproximateTimeLeft(task.estimatedDurationMs - task.elapsedMs)}
                    </small>
                  )}
                </span>
              </Link>
              {!running && (
                <button
                  type="button"
                  className="prompt-test-dock-dismiss"
                  aria-label="Dismiss prompt test status"
                  onClick={() => acknowledgeTask(task.id)}
                >
                  <X aria-hidden="true" />
                </button>
              )}
              {running && (
                <span className="prompt-test-dock-progress" aria-hidden="true">
                  <span style={{ inlineSize: `${task.progress}%` }} />
                </span>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </aside>
  );
}

export function useBackgroundPromptTests(): BackgroundPromptTestContextValue {
  const context = useContext(BackgroundPromptTestContext);
  if (!context) throw new Error("useBackgroundPromptTests must be used inside BackgroundPromptTestProvider");
  return context;
}

export function useOptionalBackgroundPromptTests(): BackgroundPromptTestContextValue | null {
  return useContext(BackgroundPromptTestContext);
}
