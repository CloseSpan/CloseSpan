"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { ArrowRightLeft, Boxes, ChevronRight, Info, LoaderCircle, MessageSquare, Sparkles, X } from "lucide-react";
import { CustomSelect } from "../custom-select";
import { IssueList, IssueViewControls } from "../issue-list";
import { type OverviewAnalytics } from "@/lib/overview-analytics";
import { EMPTY_ISSUE_FILTERS, filterIssues, groupIssues, issueProductArea, type IssueFilters, type IssueGrouping } from "@/lib/issue-views";
import type { Stage } from "@/lib/domain";
import { isProductProblemStage, problemStageTransitionPreview, PRODUCT_PROBLEM_STAGES } from "@/lib/problem-stage-transition";
import { isProblemActiveWork, type ProblemActiveWork, type ProblemActiveWorkStatus } from "@/lib/problem-active-work";
import { useOptionalBackgroundPromptTests } from "../background-prompt-tests";
import { WORKSPACE_LABELS } from "@/lib/workspace-labels";
import { EmptyWorkspaceState, PageTitle, containModalFocus, getModalFocusableElements } from "./shared";

const prioritizationStages = PRODUCT_PROBLEM_STAGES;

const problemViews = ["problems", "board"] as const;

type ProblemView = (typeof problemViews)[number];

function promptTaskStatus(
  phase: "evaluating" | "applying-revision" | "retesting" | "generating-contract" | "waiting-for-approval",
): ProblemActiveWorkStatus {
  if (phase === "applying-revision") return "Working";
  if (phase === "generating-contract" || phase === "waiting-for-approval")
    return "Preparing";
  return "Testing";
}

export function ProblemLifecycleBoard({
  problems,
  activeWork = problems.flatMap((problem) => problem.activeWork ? [problem.activeWork] : []),
  grouping = "stage",
  onStageChange,
}: {
  problems: OverviewAnalytics["problems"];
  activeWork?: ProblemActiveWork[];
  grouping?: Exclude<IssueGrouping, "none">;
  onStageChange?: (id: string, stage: Stage) => void;
}) {
  type BoardProblem = Omit<OverviewAnalytics["problems"][number], "stage"> & {
    stage: Stage;
  };
  type TransitionRequest = { problem: BoardProblem; toStage: Stage };

  const backgroundPromptTests = useOptionalBackgroundPromptTests();
  const [manualStages, setManualStages] = useState<Record<string, Stage>>({});
  const [transitionRequest, setTransitionRequest] =
    useState<TransitionRequest | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [transitionError, setTransitionError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const lastTriggerRef = useRef<HTMLElement | null>(null);

  const activeWorkByProblem = useMemo(() => {
    const values = new Map(activeWork.map((item) => [item.problemId, item]));
    for (const task of backgroundPromptTests?.tasks ?? []) {
      if (task.status === "running") {
        values.set(task.problemId, {
          problemId: task.problemId,
          status: promptTaskStatus(task.phase),
          startedAt: new Date(task.startedAt).toISOString(),
        });
      }
    }
    return values;
  }, [activeWork, backgroundPromptTests?.tasks]);

  const boardProblems = useMemo(
    () =>
      problems.flatMap((problem) => {
        const stage = manualStages[problem.id] ?? problem.stage;
        return isProductProblemStage(stage)
          ? [{ ...problem, stage, activeWork: activeWorkByProblem.get(problem.id) ?? null }] : [];
      }) as BoardProblem[],
    [manualStages, problems, activeWorkByProblem],
  );

  const closeTransition = useCallback(() => {
    if (isSubmitting) return;
    setTransitionRequest(null);
    setTransitionError("");
    window.requestAnimationFrame(() => lastTriggerRef.current?.focus());
  }, [isSubmitting]);

  const openTransition = (
    problem: BoardProblem,
    toStage: Stage,
    trigger?: HTMLElement | null,
  ) => {
    if (problem.stage === toStage) return;
    lastTriggerRef.current =
      trigger ?? (document.activeElement as HTMLElement | null);
    setTransitionError("");
    setTransitionRequest({ problem, toStage });
  };

  useLayoutEffect(() => {
    if (!transitionRequest || !dialogRef.current) return;
    const dialog = dialogRef.current;
    window.requestAnimationFrame(() => {
      getModalFocusableElements(dialog)[0]?.focus({ preventScroll: true });
    });
    const onKeyDown = (event: KeyboardEvent) =>
      containModalFocus(event, dialog, closeTransition);
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeTransition, transitionRequest]);

  const preview = transitionRequest
    ? problemStageTransitionPreview(transitionRequest.toStage)
    : null;

  const confirmTransition = async () => {
    if (!transitionRequest) return;
    setIsSubmitting(true);
    setTransitionError("");
    try {
      const response = await fetch(
        `/api/problems/${transitionRequest.problem.id}/stage`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
            "x-request-id": crypto.randomUUID(),
          },
          body: JSON.stringify({ stage: transitionRequest.toStage }),
        },
      );
      const payload = await response.json() as {
        error?: string;
        transition?: { toStage: Stage };
      };
      if (!response.ok || !payload.transition)
        throw new Error(payload.error ?? "The lifecycle stage could not be updated");
      const completed = transitionRequest;
      setManualStages((current) => ({
        ...current,
        [completed.problem.id]: payload.transition!.toStage,
      }));
      onStageChange?.(completed.problem.id, payload.transition.toStage);
      setTransitionRequest(null);
      setAnnouncement(
        `${completed.problem.title} moved from ${completed.problem.stage} to ${completed.toStage}.`,
      );
      window.requestAnimationFrame(() => lastTriggerRef.current?.focus());
    } catch (error) {
      setTransitionError(
        error instanceof Error ? error.message : "The lifecycle stage could not be updated",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <div className="board" data-grouping={grouping} aria-label={`Issues by ${grouping === "productArea" ? "product area" : grouping}`}>
        {groupIssues(boardProblems, grouping, grouping === "stage").map(({ key, issues: stageProblems }) => {
          return (
            <section
              className="board-col"
              key={key}
              aria-label={key}
              data-stage={grouping === "stage" ? key : undefined}
            >
              <div className="board-head">
                <span className="board-stage-dot" aria-hidden="true" />
                <strong>{key}</strong>
                <span className="board-stage-count">{stageProblems.length}</span>
              </div>
              {stageProblems.length === 0 ? (
                <p className="problem-board-empty">
                  No issues
                </p>
              ) : (
                stageProblems.map((problem) => {
                  const workStatus = problem.stage !== "Closed" ? problem.activeWork?.status : null;
                  const currentIndex = prioritizationStages.indexOf(problem.stage);
                  const suggestedStage =
                    currentIndex < prioritizationStages.length - 1
                      ? prioritizationStages[currentIndex + 1]
                      : prioritizationStages[currentIndex - 1];
                  return (
                    <article
                      className="problem-card problem-card-shell"
                      draggable={false}
                      key={problem.id}
                    >
                      <Link className="problem-card-link" href={`/problems/${problem.id}`}>
                        <h3 className="problem-card-title" title={problem.title}>
                          {problem.title}
                        </h3>
                        <p className="issue-card-area">
                          <Boxes size={14} aria-hidden="true" />
                          <span>{issueProductArea(problem)}</span>
                        </p>
                        <p className="issue-card-reports">
                          <MessageSquare size={14} aria-hidden="true" />
                          <span>{problem.count} {problem.count === 1 ? "report" : "reports"}</span>
                        </p>
                        <div className="ticket-badges">
                          <span className="badge">{problem.type}</span>
                          <span className={`badge ${problem.severity.toLowerCase()}`}>
                            {problem.severity}
                          </span>
                        </div>
                        <span className="badge issue-card-stage">{problem.stage === "Needs review" ? "Reported" : problem.stage}</span>
                        {workStatus && (
                          <span className="problem-card-work-status" role="status" aria-label={`${workStatus} in progress`}>
                            <strong>{workStatus}</strong>
                            <LoaderCircle className="problem-card-work-spinner spin" aria-hidden="true" />
                          </span>
                        )}
                      </Link>
                      <button
                        type="button"
                        className="problem-card-move-button"
                        onClick={(event) => openTransition(problem, suggestedStage, event.currentTarget)}
                        aria-label={`Move ${problem.title} to another stage`}
                      >
                        <ArrowRightLeft size={13} aria-hidden="true" /> Move stage
                      </button>
                    </article>
                  );
                })
              )}
            </section>
          );
        })}
      </div>
      {transitionRequest && preview && typeof document !== "undefined" &&
        createPortal(
          <div className="stage-transition-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeTransition();
          }}>
            <div
              className="stage-transition-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="stage-transition-title"
              aria-describedby="stage-transition-description"
              ref={dialogRef}
              tabIndex={-1}
            >
              <header>
                <div>
                  <span>Manual lifecycle authorization</span>
                  <h2 id="stage-transition-title">{preview.title}</h2>
                </div>
                <button type="button" onClick={closeTransition} aria-label="Close stage review" disabled={isSubmitting}>
                  <X size={18} />
                </button>
              </header>
              <div className="stage-transition-body">
                <p className="stage-transition-problem">{transitionRequest.problem.title}</p>
                <div className="stage-transition-route" aria-label={`${transitionRequest.problem.stage} to ${transitionRequest.toStage}`}>
                  <strong>{transitionRequest.problem.stage}</strong>
                  <ChevronRight aria-hidden="true" size={17} />
                  <div className="stage-transition-destination">
                    <span>Destination stage</span>
                    <CustomSelect
                      ariaLabel="Destination stage"
                      className="stage-transition-select"
                      inlineMenu
                      value={transitionRequest.toStage}
                      disabled={isSubmitting}
                      options={prioritizationStages.filter((candidate) => candidate !== transitionRequest.problem.stage)}
                      onValueChange={(value) => setTransitionRequest((current) => current ? { ...current, toStage: value as Stage } : current)}
                    />
                  </div>
                </div>
                <p id="stage-transition-description">{preview.summary}</p>
                <div className="stage-transition-effects">
                  <strong>On confirmation, CloseSpan will</strong>
                  <ul>{preview.effects.map((effect) => <li key={effect}>{effect}</li>)}</ul>
                </div>
                {preview.caution && <p className="stage-transition-caution"><Info size={15} aria-hidden="true" />{preview.caution}</p>}
                {transitionError && <p className="stage-transition-error" role="alert">{transitionError}</p>}
              </div>
              <footer>
                <button type="button" className="btn" onClick={closeTransition} disabled={isSubmitting}>Cancel</button>
                <button type="button" className="btn primary" onClick={confirmTransition} disabled={isSubmitting}>
                  {isSubmitting ? <><LoaderCircle className="spin" size={16} /> Updating stage</> : "Confirm stage update"}
                </button>
              </footer>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export function ProblemsScreen({ analytics }: { analytics: OverviewAnalytics }) {
  const reduceMotion = useReducedMotion();
  const [tableView, setTableView] = useState<ProblemView>("problems");
  const [filters, setFilters] = useState<IssueFilters>({ ...EMPTY_ISSUE_FILTERS });
  const [grouping, setGrouping] = useState<IssueGrouping>("none");
  const [stageOverrides, setStageOverrides] = useState<Record<string, Stage>>({});
  const [activeWork, setActiveWork] = useState<ProblemActiveWork[]>(() =>
    analytics.problems.flatMap((problem) =>
      problem.activeWork ? [problem.activeWork] : [],
    ),
  );
  const issues = useMemo(() => {
    const workByProblem = new Map(activeWork.map((work) => [work.problemId, work]));
    return analytics.problems.map((problem) => ({
      ...problem,
      stage: stageOverrides[problem.id] ?? problem.stage,
      activeWork: workByProblem.get(problem.id) ?? null,
    }));
  }, [analytics.problems, stageOverrides, activeWork]);
  const visibleIssues = useMemo(() => filterIssues(issues, filters), [issues, filters]);

  useEffect(() => {
    if (tableView !== "board") return;
    const controller = new AbortController();
    let disposed = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/problems/active-work", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok || disposed) return;
        const payload = await response.json() as { activeWork?: unknown };
        if (!Array.isArray(payload.activeWork)) return;
        const next = payload.activeWork.filter(isProblemActiveWork);
        if (!disposed) setActiveWork(next);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn("Unable to refresh active problem work", error);
        }
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 5_000);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [tableView]);
  const uncertain = analytics.problems.filter(
    (problem) => problem.confidence < 80,
  ).length;
  const high = analytics.problems.filter((problem) =>
    ["High", "Critical"].includes(problem.severity),
  ).length;
  const reviewProblem =
    analytics.problems.find((problem) => problem.stage === "Needs review") ??
    analytics.problems[0];

  const viewLabel = (view: ProblemView) => {
    if (view === "problems") return "List";
    return "Board";
  };

  return (
    <>
      <PageTitle
        title={WORKSPACE_LABELS.problems}
        action={
          reviewProblem ? (
            <Link
              className="btn"
              href={`/problems/${reviewProblem.id}#evidence`}
            >
              <Sparkles size={14} /> Review issue
            </Link>
          ) : undefined
        }
      />
      {analytics.problems.length === 0 ? (
        <EmptyWorkspaceState
          title="No issues yet"
          description="Import and review customer feedback to create your first issue."
          actionHref="/feedback"
          actionLabel="Open feedback inbox"
        />
      ) : (
        <>
          <div className="grid cols-4 page-metrics">
            {[
              ["Needs review", analytics.metrics.needsReview],
              ["High or critical", high],
              ["Low-confidence matches", uncertain],
              ["Active issues", analytics.metrics.activeProblems],
            ].map(([label, value]) => (
              <div className="card metric" key={label}>
                <div className="metric-label">{label}</div>
                <div className="metric-value">{value}</div>
              </div>
            ))}
          </div>
          <section className="card issue-workspace">
            <IssueViewControls
              issues={issues}
              filters={filters}
              onFiltersChange={setFilters}
              grouping={grouping}
              onGroupingChange={setGrouping}
              isBoard={tableView === "board"}
              count={visibleIssues.length}
            >
              <div
                className="problem-view-tabs"
                data-view={tableView}
                role="tablist"
                aria-label="Issue view"
              >
                <span
                  className="problem-view-switch-thumb"
                  aria-hidden="true"
                />
                {problemViews.map((view) => (
                  <button
                    key={view}
                    id={`problem-view-tab-${view}`}
                    type="button"
                    role="tab"
                    aria-controls={`problem-view-panel-${view}`}
                    aria-selected={tableView === view}
                    className={tableView === view ? "active" : ""}
                    tabIndex={tableView === view ? 0 : -1}
                    onClick={() => setTableView(view)}
                    onKeyDown={(event) => {
                      const currentIndex = problemViews.indexOf(tableView);
                      let nextIndex: number | null = null;
                      if (
                        event.key === "ArrowRight" ||
                        event.key === "ArrowDown"
                      ) {
                        nextIndex = (currentIndex + 1) % problemViews.length;
                      } else if (
                        event.key === "ArrowLeft" ||
                        event.key === "ArrowUp"
                      ) {
                        nextIndex =
                          (currentIndex - 1 + problemViews.length) %
                          problemViews.length;
                      } else if (event.key === "Home") {
                        nextIndex = 0;
                      } else if (event.key === "End") {
                        nextIndex = problemViews.length - 1;
                      }
                      if (nextIndex === null) return;
                      event.preventDefault();
                      const nextView = problemViews[nextIndex];
                      setTableView(nextView);
                      window.requestAnimationFrame(() => {
                        document
                          .getElementById(`problem-view-tab-${nextView}`)
                          ?.focus();
                      });
                    }}
                  >
                    {viewLabel(view)}
                  </button>
                ))}
              </div>
            </IssueViewControls>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={tableView}
                id={`problem-view-panel-${tableView}`}
                role="tabpanel"
                aria-labelledby={`problem-view-tab-${tableView}`}
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -6 }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }
                }
              >
                {visibleIssues.length === 0 ? (
                  <div className="issue-empty" role="status">
                    <strong>No matching issues</strong>
                    <button type="button" className="btn" onClick={() => setFilters({ ...EMPTY_ISSUE_FILTERS })}>Clear filters</button>
                  </div>
                ) : tableView === "board" ? (
                  <div className="problem-board-panel">
                    <ProblemLifecycleBoard
                      problems={visibleIssues}
                      activeWork={activeWork}
                      grouping={grouping === "none" ? "stage" : grouping}
                      onStageChange={(id, stage) => setStageOverrides((current) => ({ ...current, [id]: stage }))}
                    />
                  </div>
                ) : (
                  <IssueList issues={visibleIssues} grouping={grouping} />
                )}
              </motion.div>
            </AnimatePresence>
          </section>
        </>
      )}
    </>
  );
}
