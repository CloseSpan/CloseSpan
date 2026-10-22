"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, ChevronRight, Clock3, GitBranch, Info, LoaderCircle, MonitorCheck, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import { CustomSelect } from "../custom-select";
import { type OverviewAnalytics } from "@/lib/overview-analytics";
import type { InvestigationVerificationMethod, InvestigationVerificationStatus, InvestigationWorkspaceItem } from "@/lib/investigation-repository";
import type { ProductProblemEvidenceBundle } from "@/lib/problem-evidence-bundle";
import { ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MS, ISSUE_RUNTIME_VERIFICATION_RUNNING_TIMEOUT_MS } from "@/lib/issue-runtime-verification-policy";
import type { IssueRuntimeVerificationRunView } from "@/lib/issue-runtime-verification";
import { investigationStatusCopy } from "@/lib/investigation-status-copy";
import { isProductCodeReference } from "@/lib/repository-path-policy";
import type { FeedbackType } from "@/lib/domain";
import { investigationStatusLabel, investigationStatusTone, money } from "./shared";

function verificationTone(status: InvestigationVerificationStatus) {
  if (status === "Confirmed current") return "success";
  if (status === "Not reproduced" || status === "Already resolved") return "medium";
  return "high";
}

function compactElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function runtimeVerificationElapsedLabel(
  run: Pick<IssueRuntimeVerificationRunView, "status" | "requestedAt" | "startedAt">,
  now: number,
): string | null {
  if (run.status !== "Queued" && run.status !== "Running") return null;
  const startedAt = run.status === "Queued"
    ? Date.parse(run.requestedAt)
    : Date.parse(run.startedAt ?? run.requestedAt);
  if (!Number.isFinite(startedAt)) return null;
  const limit = run.status === "Queued"
    ? ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MS
    : ISSUE_RUNTIME_VERIFICATION_RUNNING_TIMEOUT_MS;
  const elapsed = Math.max(0, now - startedAt);
  if (elapsed >= limit) {
    return `${run.status === "Queued" ? "Queued" : "Running"} for ${compactElapsed(elapsed)} · timeout reconciliation pending`;
  }
  return `${run.status === "Queued" ? "Queued" : "Running"} for ${compactElapsed(elapsed)} · timeout in ${compactElapsed(limit - elapsed)}`;
}

function InvestigationList({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: string[];
  emptyLabel: string;
}) {
  return (
    <section className="investigation-detail-section">
      <h3>{title}</h3>
      {items.length ? (
        <ul className="investigation-list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="subtle">{emptyLabel}</p>
      )}
    </section>
  );
}

function uniqueInvestigationItems(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

const BUG_ONLY_EVIDENCE = /exact reproduction|expected result|failing trace|console error|request identifier|second independent customer report|internal reproduction/i;

const REPOSITORY_TRACE_CHECK = /^(?:run or extend the nearest existing test at|trace the reported behavior through)\b/i;

const INTERNAL_ASSUMPTION = /linked customer evidence belongs to the same product behavior|repository metadata is current/i;

export function investigationDecisionContent({
  feedbackType,
  problemTitle,
  evidenceToCollect,
  recommendedChecks,
  relevantCodePaths,
  assumptions,
}: {
  feedbackType: FeedbackType;
  problemTitle: string;
  evidenceToCollect: string[];
  recommendedChecks: string[];
  relevantCodePaths: string[];
  assumptions: string[];
}) {
  const featureDetails = [
    `Confirm the desired outcome and boundaries for “${problemTitle}”.`,
    "Define the acceptance criteria for the requested workflow.",
  ];
  const decisionEvidence = feedbackType === "Feature request"
    ? evidenceToCollect.filter((item) => !BUG_ONLY_EVIDENCE.test(item))
    : evidenceToCollect;

  return {
    detailsToConfirm: uniqueInvestigationItems([
      ...decisionEvidence,
      ...(feedbackType === "Feature request" ? featureDetails : []),
    ]),
    validationPlan: uniqueInvestigationItems(
      recommendedChecks.filter((item) => !REPOSITORY_TRACE_CHECK.test(item)),
    ),
    productCodePaths: uniqueInvestigationItems(
      relevantCodePaths.filter(isProductCodeReference),
    ),
    currentUnderstanding: uniqueInvestigationItems(
      assumptions.filter((item) => !INTERNAL_ASSUMPTION.test(item)),
    ),
  };
}

function InvestigationTechnicalContext({ items }: { items: string[] }) {
  const matchLabel = items.length
    ? `${items.length} product code ${items.length === 1 ? "match" : "matches"}`
    : "No product code matches yet";
  return (
    <details className="investigation-technical-context">
      <summary>
        <span>Technical context</span>
        <span className="subtle">{matchLabel}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="investigation-technical-context-body">
        {items.length ? (
          <ul className="investigation-list">
            {items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        ) : (
          <p className="subtle">
            Repository search has not found an application source file yet. Generated prompts,
            documentation, and CloseSpan configuration are excluded.
          </p>
        )}
      </div>
    </details>
  );
}

const INVESTIGATION_VERIFICATION_STATUS_OPTIONS = [
  "Confirmed current",
  "Not reproduced",
  "Already resolved",
  "Verification blocked",
] satisfies readonly InvestigationVerificationStatus[];

const INVESTIGATION_VERIFICATION_METHOD_OPTIONS = [
  "Production telemetry",
  "Release evidence",
] satisfies readonly InvestigationVerificationMethod[];

export function InvestigationVerificationFields({
  verificationStatus,
  verificationMethod,
  onVerificationStatusChange,
  onVerificationMethodChange,
}: {
  verificationStatus: InvestigationVerificationStatus;
  verificationMethod: InvestigationVerificationMethod;
  onVerificationStatusChange: (status: InvestigationVerificationStatus) => void;
  onVerificationMethodChange: (method: InvestigationVerificationMethod) => void;
}) {
  return (
    <>
      <div className="field">
        <span>Outcome</span>
        <CustomSelect
          ariaLabel="Outcome"
          className="investigation-verification-select"
          value={verificationStatus}
          options={INVESTIGATION_VERIFICATION_STATUS_OPTIONS}
          onValueChange={(value) => {
            onVerificationStatusChange(value as InvestigationVerificationStatus);
          }}
        />
      </div>
      <div className="field">
        <span>Verification method</span>
        <CustomSelect
          ariaLabel="Verification method"
          className="investigation-verification-select"
          value={verificationMethod}
          options={INVESTIGATION_VERIFICATION_METHOD_OPTIONS}
          onValueChange={(value) => {
            onVerificationMethodChange(value as InvestigationVerificationMethod);
          }}
        />
      </div>
    </>
  );
}

interface RepositoryContextRefreshSnapshot {
  repository: string;
  commitSha: string | null;
  status: "Queued" | "Discovering" | "Uploading" | "Indexing" | "Ready" | "Failed";
  stage: string;
  progress: number;
  errorMessage: string | null;
}

function waitForRepositoryContextPoll(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("Repository context refresh cancelled", "AbortError"));
    }, { once: true });
  });
}

export function ProductProblemInvestigationPanel({
  problem,
  investigation,
  evidenceBundle,
  showSummary = true,
}: {
  problem: OverviewAnalytics["problems"][number];
  investigation?: InvestigationWorkspaceItem;
  evidenceBundle?: ProductProblemEvidenceBundle | null;
  showSummary?: boolean;
}) {
  const router = useRouter();
  const [startingInvestigation, setStartingInvestigation] = useState(false);
  const [startingRuntimeVerification, setStartingRuntimeVerification] = useState(false);
  const [runtimeVerificationState, setRuntimeVerificationState] = useState<IssueRuntimeVerificationRunView | null>(
    investigation?.runtimeVerification ?? null,
  );
  const [runtimeVerificationError, setRuntimeVerificationError] = useState<string>();
  const [runtimeVerificationNotice, setRuntimeVerificationNotice] = useState<string>();
  const [runtimeClock, setRuntimeClock] = useState(() => Date.now());
  const [verificationStatus, setVerificationStatus] = useState<InvestigationVerificationStatus>("Confirmed current");
  const [verificationMethod, setVerificationMethod] = useState<InvestigationVerificationMethod>("Product reproduction");
  const [verificationSummary, setVerificationSummary] = useState("");
  const [editingVerification, setEditingVerification] = useState(false);
  const [savingVerification, setSavingVerification] = useState(false);
  const [refreshingRepositoryContext, setRefreshingRepositoryContext] = useState(false);
  const [repositoryContextFeedback, setRepositoryContextFeedback] = useState<string>();
  const [investigationError, setInvestigationError] = useState<string>();
  const repositoryContextRefreshAbort = useRef<AbortController | null>(null);
  const updatedAt = investigation ? new Date(investigation.updatedAt) : null;
  const updatedLabel = !updatedAt || Number.isNaN(updatedAt.getTime())
    ? "Awaiting investigation"
    : `Updated ${updatedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  const persistedRuntimeVerification = investigation?.runtimeVerification ?? null;
  const runtimeVerification = runtimeVerificationState;
  const evidenceToCollect = evidenceBundle?.remainingEvidence
    ?? investigation?.missingInformation
    ?? [];
  const recommendedChecks = evidenceBundle?.recommendedChecks
    ?? investigation?.recommendedTests
    ?? [];
  const relevantCodePaths = evidenceBundle?.relevantCodePaths.length
    ? evidenceBundle.relevantCodePaths
    : investigation?.suspectedFiles ?? [];
  const decisionContent = investigation
    ? investigationDecisionContent({
        feedbackType: problem.type,
        problemTitle: problem.title,
        evidenceToCollect,
        recommendedChecks,
        relevantCodePaths,
        assumptions: investigation.assumptions,
      })
    : null;
  const runtimeEvidence = evidenceBundle?.runtimeVerification ?? null;
  const statusCopy = investigation
    ? investigationStatusCopy({
        feedbackType: problem.type,
        verificationStatus: investigation.verification.status,
        verificationSummary: investigation.verification.summary,
        runtimeOutcome: runtimeEvidence?.outcome ?? null,
        runtimeSummary: runtimeEvidence?.summary ?? null,
        hypothesis: investigation.hypothesis,
      })
    : null;
  const runtimeVerificationActive = runtimeVerification?.status === "Queued"
    || runtimeVerification?.status === "Running";
  const runtimeVerificationQueued = runtimeVerification?.status === "Queued";
  const runtimeRunnerUnavailable = runtimeVerification?.status === "Failed"
    && runtimeVerification.failureMessage?.startsWith("Runner unavailable.");
  const runtimeTiming = runtimeVerification
    ? runtimeVerificationElapsedLabel(runtimeVerification, runtimeClock)
    : null;

  useEffect(() => {
    if (!persistedRuntimeVerification) return;
    // Server refreshes reconcile the durable run; mirror that result locally
    // so the action card never falls back to its pre-run state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRuntimeVerificationState(persistedRuntimeVerification);
  }, [persistedRuntimeVerification]);

  useEffect(() => {
    if (!runtimeVerificationActive) return;
    let cancelled = false;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const response = await fetch(
          `/api/problems/${encodeURIComponent(problem.id)}/investigation/runtime-verification`,
          { cache: "no-store", headers: { "x-request-id": crypto.randomUUID() } },
        );
        const payload = await response.json().catch(() => ({})) as {
          error?: string;
          run?: IssueRuntimeVerificationRunView | null;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Runtime verification status could not be refreshed.");
        }
        if (!cancelled && payload.run) {
          setRuntimeVerificationState(payload.run);
          if (payload.run.status === "Failed") {
            setRuntimeVerificationNotice(undefined);
            setRuntimeVerificationError(
              payload.run.failureMessage ?? payload.run.summary ?? "Runtime verification failed.",
            );
            router.refresh();
          } else if (payload.run.status === "Completed") {
            setRuntimeVerificationError(undefined);
            setRuntimeVerificationNotice(
              `Runtime verification finished: ${payload.run.outcome ?? "result received"}.`,
            );
            router.refresh();
          } else {
            setRuntimeVerificationError(undefined);
          }
        }
      } catch (cause) {
        if (!cancelled) {
          setRuntimeVerificationError(
            cause instanceof Error
              ? cause.message
              : "Runtime verification status could not be refreshed.",
          );
        }
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [problem.id, router, runtimeVerificationActive]);

  useEffect(() => {
    if (!runtimeVerificationActive) return;
    const timer = window.setInterval(() => setRuntimeClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [runtimeVerificationActive]);

  useEffect(() => () => repositoryContextRefreshAbort.current?.abort(), []);

  async function startInvestigation() {
    setStartingInvestigation(true);
    setInvestigationError(undefined);
    try {
      const response = await fetch(`/api/problems/${problem.id}/investigation`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "The investigation could not be started.");
      }
      router.refresh();
    } catch (cause) {
      setInvestigationError(cause instanceof Error ? cause.message : "The investigation could not be started.");
    } finally {
      setStartingInvestigation(false);
    }
  }

  async function saveVerification(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!investigation) return;
    setSavingVerification(true);
    setInvestigationError(undefined);
    try {
      const response = await fetch(`/api/problems/${problem.id}/investigation/verification`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify({
          status: verificationStatus,
          method: verificationMethod,
          summary: verificationSummary,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Issue verification could not be recorded.");
      setEditingVerification(false);
      router.refresh();
    } catch (cause) {
      setInvestigationError(cause instanceof Error ? cause.message : "Issue verification could not be recorded.");
    } finally {
      setSavingVerification(false);
    }
  }

  async function runRuntimeVerification() {
    if (!investigation) return;
    setStartingRuntimeVerification(true);
    setRuntimeVerificationError(undefined);
    try {
      const response = await fetch(
        `/api/problems/${problem.id}/investigation/runtime-verification`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
            "x-request-id": crypto.randomUUID(),
          },
        },
      );
      const payload = await response.json() as {
        error?: string;
        run?: IssueRuntimeVerificationRunView | null;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Runtime verification could not be started.");
      }
      if (!payload.run) {
        throw new Error("Runtime verification was accepted but no run status was returned.");
      }
      setRuntimeVerificationState(payload.run);
      router.refresh();
    } catch (cause) {
      setRuntimeVerificationError(
        cause instanceof Error ? cause.message : "Runtime verification could not be started.",
      );
    } finally {
      setStartingRuntimeVerification(false);
    }
  }

  async function refreshRepositoryContext() {
    if (!evidenceBundle || refreshingRepositoryContext) return;
    repositoryContextRefreshAbort.current?.abort();
    const controller = new AbortController();
    repositoryContextRefreshAbort.current = controller;
    setRefreshingRepositoryContext(true);
    setRepositoryContextFeedback("Queuing repository context refresh…");
    try {
      const response = await fetch("/api/repository-contexts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify({ repository: evidenceBundle.repository }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Repository context could not be refreshed.");
      }

      for (let attempt = 0; attempt < 80; attempt += 1) {
        await waitForRepositoryContextPoll(1_500, controller.signal);
        const statusResponse = await fetch("/api/repository-contexts", {
          headers: { "x-request-id": crypto.randomUUID() },
          cache: "no-store",
          signal: controller.signal,
        });
        const statusPayload = await statusResponse.json().catch(() => ({})) as {
          contexts?: RepositoryContextRefreshSnapshot[];
          error?: string;
        };
        if (!statusResponse.ok || !Array.isArray(statusPayload.contexts)) {
          throw new Error(statusPayload.error ?? "Repository context status could not be loaded.");
        }
        const context = statusPayload.contexts.find(
          (candidate) => candidate.repository === evidenceBundle.repository,
        );
        if (!context) throw new Error("Repository context was not found.");
        if (context.status === "Failed") {
          throw new Error(context.errorMessage ?? "Repository context refresh failed. Try again.");
        }
        if (
          context.status === "Ready"
          && context.commitSha?.toLowerCase() === evidenceBundle.commitSha.toLowerCase()
        ) {
          setRepositoryContextFeedback("Repository context refreshed. Updating investigation…");
          router.refresh();
          return;
        }
        setRepositoryContextFeedback(
          context.status === "Ready"
            ? "Repository changed again while context was refreshing. Refresh once more to use the latest commit."
            : `${context.stage} · ${context.progress}%`,
        );
      }
      setRepositoryContextFeedback("Repository context is still refreshing. Reload this page in a moment.");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setRepositoryContextFeedback(
        cause instanceof Error ? cause.message : "Repository context could not be refreshed.",
      );
    } finally {
      if (repositoryContextRefreshAbort.current === controller) {
        repositoryContextRefreshAbort.current = null;
        setRefreshingRepositoryContext(false);
      }
    }
  }

  return (
    <article className="card investigation-detail-card problem-investigation-detail section-gap" id="investigation">
      <header className="investigation-detail-head">
        <div className="investigation-detail-heading">
          <h2>Investigation</h2>
          <p>
            {investigation?.title ?? "Establish the evidence boundary before prompt preparation"}
            {" · "}{problem.productArea}
            {" · "}{problem.severity} severity
          </p>
        </div>
        {showSummary && (
          <div className="investigation-detail-status">
            <span className={`badge ${investigation ? investigationStatusTone(investigation.status) : "high"}`}>
              {investigation ? investigationStatusLabel(investigation.status) : "Not started"}
            </span>
            <span className="subtle">{updatedLabel}</span>
          </div>
        )}
      </header>

      <div className="investigation-detail-body">
        {showSummary && (
          <section className="investigation-readiness" aria-label="Investigation readiness">
            <div>
              <span>Related signals</span>
              <strong>{investigation?.relatedSignalCount ?? problem.count}</strong>
            </div>
            <div>
              <span>Details to confirm</span>
              <strong>{decisionContent ? decisionContent.detailsToConfirm.length : "—"}</strong>
            </div>
            <div>
              <span>Validation checks</span>
              <strong>{decisionContent ? decisionContent.validationPlan.length : "—"}</strong>
              <small>Planned checks</small>
            </div>
          </section>
        )}

        {investigation ? (
          <>
            {evidenceBundle && (
              <section className={`investigation-repository-evidence is-${evidenceBundle.contextStatus === "Exact commit" ? "exact" : "unavailable"}`} aria-label="Repository context provenance">
                <div>
                  <GitBranch size={16} aria-hidden="true" />
                  <span>
                    <strong>Repository context</strong>
                    {" · "}{evidenceBundle.repository}
                    {evidenceBundle.commitSha ? `@${evidenceBundle.commitSha.slice(0, 12)}` : ""}
                  </span>
                </div>
                <div>
                  {evidenceBundle.contextStatus === "Refresh required" ? (
                    <span className="badge medium investigation-context-refresh-capsule">
                      <span>Refresh required</span>
                      <button
                        type="button"
                        className="investigation-context-refresh"
                        aria-label={refreshingRepositoryContext
                          ? "Refreshing repository context"
                          : "Refresh repository context"}
                        title={refreshingRepositoryContext
                          ? "Refreshing repository context"
                          : "Refresh repository context"}
                        disabled={refreshingRepositoryContext}
                        onClick={() => void refreshRepositoryContext()}
                      >
                        <RefreshCw
                          size={14}
                          className={refreshingRepositoryContext ? "spin" : undefined}
                          aria-hidden="true"
                        />
                      </button>
                    </span>
                  ) : (
                    <span className={`badge ${evidenceBundle.contextStatus === "Exact commit" ? "success" : "medium"}`}>
                      {evidenceBundle.contextStatus === "Exact commit"
                        ? evidenceBundle.freshness === "Runtime commit"
                          ? "Runtime commit"
                          : "Indexed commit"
                        : evidenceBundle.contextStatus}
                    </span>
                  )}
                  <span className="subtle" aria-live="polite">
                    {evidenceBundle.contextStatus === "Exact commit" && !refreshingRepositoryContext
                      ? evidenceBundle.contextMessage
                      : repositoryContextFeedback ?? evidenceBundle.contextMessage}
                  </span>
                </div>
              </section>
            )}

            <section className={`callout ${statusCopy?.tone === "info" ? "" : statusCopy?.tone ?? "warning"} investigation-hypothesis`}>
              <div className="callout-title">
                {statusCopy?.icon === "confirmed"
                  ? <ShieldCheck size={14} aria-hidden="true" />
                  : statusCopy?.icon === "info"
                    ? <Info size={14} aria-hidden="true" />
                    : <AlertTriangle size={14} aria-hidden="true" />}
                {statusCopy?.title}
              </div>
              <p>{statusCopy?.detail}</p>
              {statusCopy?.showWorkingHypothesis && (
                <p className="subtle">Working hypothesis: {investigation.hypothesis}</p>
              )}
            </section>

            {decisionContent && (
              <>
                <div className="investigation-detail-grid investigation-decision-grid">
                  <InvestigationList
                    title="Details to confirm"
                    items={decisionContent.detailsToConfirm}
                    emptyLabel="No product decisions remain open."
                  />
                  <InvestigationList
                    title="Validation plan"
                    items={decisionContent.validationPlan}
                    emptyLabel="No validation checks are recommended."
                  />
                </div>

                {decisionContent.currentUnderstanding.length > 0 && (
                  <section className="investigation-current-understanding">
                    <h3>Current understanding</h3>
                    <p>{decisionContent.currentUnderstanding[0]}</p>
                  </section>
                )}

                <InvestigationTechnicalContext items={decisionContent.productCodePaths} />
              </>
            )}

            <section className={`investigation-verification is-${verificationTone(investigation.verification.status)}`} aria-labelledby="issue-verification-title">
              <div className="investigation-verification-head">
                <div>
                  <h3 id="issue-verification-title">Current issue verification</h3>
                  <p>Inspect the pinned commit first, then run targeted product tests only when the evidence requires them.</p>
                </div>
                <span className={`badge ${runtimeVerificationActive ? "medium" : verificationTone(investigation.verification.status)}`}>
                  {runtimeVerificationActive
                    ? runtimeVerification?.status === "Queued" ? "Queued for Tenki" : "Running on Tenki"
                    : runtimeRunnerUnavailable ? "Runner unavailable" : investigation.verification.status}
                </span>
              </div>

              <div
                className="runtime-verification-action"
                aria-live="polite"
                aria-busy={startingRuntimeVerification || runtimeVerificationActive}
              >
                <div>
                  <strong>{runtimeVerificationActive
                    ? runtimeVerificationQueued
                      ? "Waiting for a Tenki runner"
                      : "Analyzing code and selecting verification evidence"
                    : runtimeRunnerUnavailable
                      ? "Runner unavailable"
                    : runtimeVerification
                      ? runtimeVerification.outcome ?? "Issue verification finished"
                      : "Verify current behavior"}</strong>
                  <p>{runtimeVerification?.summary
                    ?? (runtimeVerificationActive
                      ? runtimeVerificationQueued
                        ? `CloseSpan dispatched ${runtimeVerification.repository} at ${runtimeVerification.baseSha.slice(0, 12)} and is waiting for the configured runner. Verification has not started.`
                        : `CloseSpan is checking ${runtimeVerification.repository} at ${runtimeVerification.baseSha.slice(0, 12)} on the configured Tenki runner.`
                      : "CloseSpan will inspect the authorized commit, accept decisive code evidence, and escalate to runtime or UI testing only when necessary.")}</p>
                  {runtimeTiming && (
                    <span className="runtime-verification-timing" suppressHydrationWarning>
                      <Clock3 size={13} aria-hidden="true" />
                      {runtimeTiming}
                    </span>
                  )}
                  {runtimeVerification && (
                    <span>
                      {runtimeVerification.repository} · {runtimeVerification.baseSha.slice(0, 12)} · requested by {runtimeVerification.requestedByName}
                      {runtimeVerification.workflowRunId ? (
                        <> · <a href={`https://github.com/${runtimeVerification.repository}/actions/runs/${runtimeVerification.workflowRunId}`} target="_blank" rel="noreferrer">View GitHub run</a></>
                      ) : null}
                    </span>
                  )}
                </div>
                <button
                  className="btn primary"
                  type="button"
                  disabled={startingRuntimeVerification || runtimeVerificationActive}
                  onClick={runRuntimeVerification}
                >
                  {startingRuntimeVerification || runtimeVerificationActive
                    ? <LoaderCircle className="spin" size={14} aria-hidden="true" />
                    : runtimeVerification?.status === "Failed"
                      || runtimeVerification?.outcome === "Verification blocked"
                      ? <RotateCcw size={14} aria-hidden="true" />
                      : <MonitorCheck size={14} aria-hidden="true" />}
                  {startingRuntimeVerification
                    ? "Starting…"
                    : runtimeVerificationQueued
                      ? "Waiting for runner"
                      : runtimeVerification?.status === "Running"
                        ? "Verification in progress"
                        : runtimeVerification?.status === "Failed"
                          || runtimeVerification?.outcome === "Verification blocked"
                          ? "Retry issue verification"
                          : runtimeVerification ? "Run verification again" : "Run issue verification"}
                </button>
              </div>

              {runtimeVerificationError && (
                <div className="toast error runtime-verification-feedback" role="alert">
                  <p>{runtimeVerificationError}</p>
                  {runtimeVerificationError.includes("confirmed repository binding") && (
                    <div className="top-actions">
                      <Link className="btn secondary" href="/settings#execution">
                        Open Settings → Execution
                      </Link>
                      <Link className="btn secondary" href={`/pdd/${problem.id}`}>
                        Open Prompt Testing repository context
                      </Link>
                    </div>
                  )}
                </div>
              )}

              {runtimeVerificationNotice && (
                <div className="toast success runtime-verification-feedback" role="status">
                  <p>{runtimeVerificationNotice}</p>
                </div>
              )}

              {editingVerification ? (
                <form className="investigation-verification-form" onSubmit={saveVerification}>
                  <InvestigationVerificationFields
                    verificationStatus={verificationStatus}
                    verificationMethod={verificationMethod}
                    onVerificationStatusChange={setVerificationStatus}
                    onVerificationMethodChange={setVerificationMethod}
                  />
                  <label className="field investigation-verification-evidence">
                    <span>Observed evidence</span>
                    <textarea
                      rows={4}
                      minLength={20}
                      maxLength={2000}
                      required
                      value={verificationSummary}
                      onChange={(event) => setVerificationSummary(event.target.value)}
                      placeholder="Record the production trace, release evidence, environment, and observed result."
                    />
                    <small>Use this only for trusted evidence collected outside the CloseSpan runtime run.</small>
                  </label>
                  <button className="btn primary" type="submit" disabled={savingVerification || verificationSummary.trim().length < 20}>
                    {savingVerification ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <ShieldCheck size={14} aria-hidden="true" />}
                    {savingVerification ? "Recording…" : "Record verification"}
                  </button>
                </form>
              ) : investigation.verification.status !== "Unverified"
                && !(runtimeVerification && investigation.verification.method === "Automated check") ? (
                <div className="investigation-verification-record-wrap">
                  <div className={`investigation-verification-record is-${verificationTone(investigation.verification.status)}`}>
                    {investigation.verification.status === "Verification blocked"
                      ? <AlertTriangle size={18} aria-hidden="true" />
                      : <ShieldCheck size={18} aria-hidden="true" />}
                    <div>
                      <strong>{investigation.verification.method}</strong>
                      <p>{investigation.verification.summary}</p>
                      <span>
                        {investigation.verification.actorName ?? "Recorded reviewer"}
                        {investigation.verification.verifiedAt
                          ? ` · ${new Date(investigation.verification.verifiedAt).toLocaleString()}`
                          : ""}
                      </span>
                    </div>
                  </div>
                  <button
                    className="btn secondary"
                    type="button"
                    onClick={() => {
                      setVerificationStatus("Confirmed current");
                      setVerificationMethod("Production telemetry");
                      setVerificationSummary("");
                      setEditingVerification(true);
                    }}
                  >
                    Record newer external evidence
                  </button>
                </div>
              ) : (
                <button
                  className="btn secondary runtime-verification-external"
                  type="button"
                  onClick={() => {
                    setVerificationStatus("Confirmed current");
                    setVerificationMethod("Production telemetry");
                    setVerificationSummary("");
                    setEditingVerification(true);
                  }}
                >
                  Record external evidence
                </button>
              )}
            </section>

            <section className="investigation-next-step">
              <div>
                <h3>{investigation.verification.status === "Confirmed current" ? "Recommended action" : "Verification required"}</h3>
                <p>{investigation.verification.status === "Confirmed current"
                  ? investigation.proposedAction
                  : investigation.verification.status === "Unverified"
                    ? "Reproduce the reported behavior and record the observed result before writing an implementation prompt."
                    : investigation.verification.status === "Verification blocked"
                      ? "Resolve the recorded environment or access blocker, then run verification again before writing an implementation prompt."
                    : "Do not prepare an implementation prompt for this report unless new evidence confirms the issue is current."}</p>
                <span className="subtle">{investigation.verification.status === "Confirmed current"
                  ? "Prompt Testing will use this verified investigation as the prompt evidence boundary."
                  : "Prompt Testing remains blocked until the current issue is confirmed."}</span>
              </div>
              {investigation.verification.status === "Confirmed current" && (
                <Link className="btn primary" href={`/pdd/${encodeURIComponent(problem.id)}#engineering-ticket`}>
                  Continue to prompt <ChevronRight size={14} aria-hidden="true" />
                </Link>
              )}
            </section>

            <footer className="investigation-context-line">
              <GitBranch size={15} aria-hidden="true" />
              <span>{investigation.repository}</span>
              <span aria-hidden="true">·</span>
              <span>{investigation.team}</span>
              <span aria-hidden="true">·</span>
              <span>{Math.round(investigation.signalConfidence * 100)}% initial report confidence</span>
            </footer>
          </>
        ) : (
          <section className="investigation-next-step">
            <div>
              <h3>Investigate before writing the prompt</h3>
              <span className="subtle">Affected impact: {problem.revenue > 0 ? `${money(problem.revenue)} ARR across ` : ""}{problem.count} signal{problem.count === 1 ? "" : "s"}.</span>
            </div>
            <button className="btn primary" type="button" disabled={startingInvestigation} onClick={startInvestigation}>
              {startingInvestigation ? "Starting…" : "Start investigation"}
            </button>
          </section>
        )}
        {investigationError && (
          <div className="toast error" role="alert">
            <p>{investigationError}</p>
            {investigationError.includes("confirmed repository binding") && (
              <div className="top-actions">
                <Link className="btn secondary" href="/settings#execution">
                  Open Settings → Execution
                </Link>
                <Link className="btn secondary" href={`/pdd/${problem.id}`}>
                  Open Prompt Testing repository context
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
