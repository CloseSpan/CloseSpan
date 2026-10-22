"use client";

import { Button, ButtonLink, StatusBadge } from "@/components/ui";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Filter, RefreshCw, Search, Sparkles } from "lucide-react";
import { feedbackProblemTitle, normalizeProblemSubject } from "@/lib/problem-subject";
import { CustomSelect } from "../custom-select";
import { IntegrationProviderIcon } from "../integration-provider-icon";
import type { FeedbackItem } from "@/lib/domain";
import { WORKSPACE_LABELS } from "@/lib/workspace-labels";
import { EmptyWorkspaceState, PageTitle } from "./shared";

interface FeedbackAnalysisView {
  feedbackId: string;
  classification: string;
  severity: string;
  sentiment: "Positive" | "Neutral" | "Negative" | "Mixed" | null;
  sentimentIntensity: number | null;
  sentimentConfidence: number | null;
  sentimentEvidence: string[];
  sentimentRationale: string | null;
  redactedSummary: string;
  problemSubject?: string;
  proposedProblemId: string | null;
  classificationConfidence: number;
  clusterConfidence: number;
  rationale: string;
  evidence: string[];
  reviewStatus: "Proposed" | "Approved" | "Rejected";
}

function sentimentTone(
  sentiment: FeedbackAnalysisView["sentiment"],
): string {
  return sentiment ? ` is-${sentiment.toLowerCase()}` : " is-unavailable";
}

export function classificationConfidenceLabel(confidence: number): string {
  return `${Math.round(confidence * 100)}% classification confidence`;
}

export function feedbackInboxSubject(
  item: FeedbackItem,
  analysis?: FeedbackAnalysisView,
  linkedProblem?: { title: string },
): string {
  return linkedProblem?.title
    ?? (analysis?.reviewStatus !== "Rejected" ? normalizeProblemSubject(analysis?.problemSubject) : null)
    ?? feedbackProblemTitle(item.quote);
}

export type FeedbackReportedOrder = "recent" | "first";

function feedbackReportedTimestamp(observedAt: string): number | null {
  const timestamp = Date.parse(observedAt);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function orderFeedbackByReportedAt(
  items: FeedbackItem[],
  order: FeedbackReportedOrder,
): FeedbackItem[] {
  return items
    .map((item, index) => ({
      item,
      index,
      timestamp: feedbackReportedTimestamp(item.observedAt),
    }))
    .sort((left, right) => {
      if (left.timestamp === null && right.timestamp === null)
        return left.index - right.index;
      if (left.timestamp === null) return 1;
      if (right.timestamp === null) return -1;
      const difference = order === "recent"
        ? right.timestamp - left.timestamp
        : left.timestamp - right.timestamp;
      return difference || left.index - right.index;
    })
    .map(({ item }) => item);
}

export function formatFeedbackReportedAt(observedAt: string): {
  date: string;
  time: string | null;
} {
  const timestamp = feedbackReportedTimestamp(observedAt);
  if (timestamp === null) return { date: "Date unavailable", time: null };
  const reportedAt = new Date(timestamp);
  return {
    date: new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(reportedAt),
    time: new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(reportedAt),
  };
}

export function FeedbackScreen({
  feedbackItems,
  orgId,
  providerLabel,
  initialAnalyses = [],
  problemOptions = [],
  connectedPullSources = [],
  initialOpenFeedbackId = null,
}: {
  feedbackItems: FeedbackItem[];
  orgId: string;
  providerLabel: string;
  initialAnalyses?: FeedbackAnalysisView[];
  problemOptions?: Array<{ id: string; title: string; stage: string }>;
  connectedPullSources?: Array<{
    integrationId: string;
    provider: string;
    accountCount: number;
    manualPullAvailable: boolean;
  }>;
  initialOpenFeedbackId?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("All");
  const [severity, setSeverity] = useState("All");
  const [tier, setTier] = useState("All");
  const [reportedOrder, setReportedOrder] =
    useState<FeedbackReportedOrder>("recent");
  const [selected, setSelected] = useState<string[]>([]);
  const [openFeedbackId, setOpenFeedbackId] = useState<string | null>(
    initialOpenFeedbackId,
  );
  const [advanced, setAdvanced] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null);
  const [pullingFeedback, setPullingFeedback] = useState(false);
  const [selectedPullSource, setSelectedPullSource] = useState("__all__");
  const [analyses, setAnalyses] =
    useState<FeedbackAnalysisView[]>(initialAnalyses);
  const [reviewProblemByFeedback, setReviewProblemByFeedback] = useState<
    Record<string, string>
  >({});
  const [reviewedProblems, setReviewedProblems] = useState<
    Record<string, { id: string; title: string; stage: string }>
  >({});
  const feedbackDetailTriggerRef = useRef<HTMLElement | null>(null);
  const router = useRouter();
  const problemById = useMemo(
    () => new Map(problemOptions.map((problem) => [problem.id, problem])),
    [problemOptions],
  );
  const analysisByFeedback = useMemo(
    () => new Map(analyses.map((analysis) => [analysis.feedbackId, analysis])),
    [analyses],
  );
  const visible = useMemo(
    () => {
      const filtered = feedbackItems.filter(
        (item) =>
          (source === "All" || item.source === source) &&
          (severity === "All" || item.severity === severity) &&
          (tier === "All" || item.accountTier === tier) &&
          `${item.customer} ${item.quote} ${feedbackInboxSubject(item, analysisByFeedback.get(item.id), reviewedProblems[item.id] ?? (item.problemId ? problemById.get(item.problemId) : undefined))}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      );
      return orderFeedbackByReportedAt(filtered, reportedOrder);
    },
    [feedbackItems, query, reportedOrder, source, severity, tier, analysisByFeedback, reviewedProblems, problemById],
  );
  const openFeedback = openFeedbackId
    ? feedbackItems.find((item) => item.id === openFeedbackId) ?? null
    : null;
  const openFeedbackIndex = openFeedback
    ? visible.findIndex((item) => item.id === openFeedback.id)
    : -1;
  const openAnalysis = openFeedback
    ? analysisByFeedback.get(openFeedback.id)
    : undefined;
  const openLinkedProblem = openFeedback
    ? reviewedProblems[openFeedback.id]
    : undefined;
  const openFeedbackReportedAt = openFeedback
    ? formatFeedbackReportedAt(openFeedback.observedAt)
    : null;
  const proposedAnalyses = analyses.filter(
    (analysis) => analysis.reviewStatus === "Proposed",
  );
  function openFeedbackDetails(feedbackId: string) {
    if (!openFeedbackId) {
      feedbackDetailTriggerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    setOpenFeedbackId(feedbackId);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function closeFeedbackDetails() {
    const previouslyFocused = feedbackDetailTriggerRef.current;
    setOpenFeedbackId(null);
    if (previouslyFocused?.isConnected) {
      window.requestAnimationFrame(() => {
        previouslyFocused.focus({ preventScroll: true });
      });
    }
  }
  function toggle(id: string) {
    setSelected((value) =>
      value.includes(id) ? value.filter((item) => item !== id) : [...value, id],
    );
  }
  async function classify(feedbackIds = selected) {
    if (!feedbackIds.length) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-org-id": orgId,
          "idempotency-key": `ai_${crypto.randomUUID().replaceAll("-", "")}`,
        },
        body: JSON.stringify({ feedbackIds }),
      });
      const body = (await response.json()) as {
        error?: string;
        providerLabel?: string;
        model?: string;
        analyses?: FeedbackAnalysisView[];
      };
      if (!response.ok)
        throw new Error(
          body.error ??
            "The AI provider could not analyze the selected feedback",
        );
      setAnalyses((current) => {
        const next = new Map(
          current.map((analysis) => [analysis.feedbackId, analysis]),
        );
        for (const analysis of body.analyses ?? [])
          next.set(analysis.feedbackId, {
            ...analysis,
            reviewStatus: analysis.reviewStatus ?? "Proposed",
          });
        return [...next.values()];
      });
      setSelected((current) =>
        current.filter((id) => !feedbackIds.includes(id)),
      );
      setNotice({
        kind: "success",
        text: `${body.providerLabel ?? body.model ?? providerLabel} analyzed ${body.analyses?.length ?? 0} feedback item${body.analyses?.length === 1 ? "" : "s"}. Recommendations and evidence are stored for human review.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "AI analysis failed",
      });
    } finally {
      setBusy(false);
    }
  }
  async function reviewAnalysis(
    feedbackId: string,
    decision: "approve" | "reject",
  ) {
    if (reviewBusyId) return;
    setReviewBusyId(feedbackId);
    setNotice(null);
    try {
      const analysis = analysisByFeedback.get(feedbackId);
      if (!analysis) throw new Error("Analyze this feedback before reviewing it.");
      const selectedProblem =
        reviewProblemByFeedback[feedbackId] ??
        analysis.proposedProblemId ??
        "__new__";
      const response = await fetch("/api/ai/review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-org-id": orgId,
          "idempotency-key": `review_${crypto.randomUUID().replaceAll("-", "")}`,
          "x-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify(
          decision === "approve"
            ? {
                feedbackId,
                decision,
                problemId: selectedProblem === "__new__" ? null : selectedProblem,
              }
            : { feedbackId, decision },
        ),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        reviewStatus?: "Approved" | "Rejected";
        problem?: { id: string; title: string; stage: string } | null;
        createdProblem?: boolean;
        investigation?: { created: boolean; investigationId: string | null };
      };
      if (!response.ok || !payload.reviewStatus)
        throw new Error(payload.error || "This review could not be saved.");
      setAnalyses((current) =>
        current.map((item) =>
          item.feedbackId === feedbackId
            ? { ...item, reviewStatus: payload.reviewStatus! }
            : item,
        ),
      );
      if (payload.problem)
        setReviewedProblems((current) => ({
          ...current,
          [feedbackId]: payload.problem!,
        }));
      setNotice({
        kind: "success",
        text:
          decision === "approve"
            ? `${payload.createdProblem ? "Created" : "Linked"} issue “${payload.problem?.title ?? "Needs review"}”.${payload.investigation ? " Its investigation is ready for review." : " The workflow will continue automatically."}`
            : "AI proposal rejected. The feedback remains in the inbox and unclustered.",
      });
      router.refresh();
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "This review could not be saved.",
      });
    } finally {
      setReviewBusyId(null);
    }
  }
  async function pullFeedback() {
    if (pullingFeedback) return;
    setPullingFeedback(true);
    setNotice(null);
    try {
      const response = await fetch("/api/integrations/pull", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-org-id": orgId,
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify({
          ...(selectedPullSource !== "__all__"
            ? { integrationIds: [selectedPullSource] }
            : connectedPullSources.length === 1
              ? { integrationIds: [connectedPullSources[0].integrationId] }
              : {}),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        failed?: number;
        routed?: boolean;
        message?: string;
        orchestrationProvider?: "pipedream" | "n8n";
        results?: Array<{
          provider: string;
          status: "succeeded" | "failed" | "unsupported";
          fetched: number;
          created: number;
          updated: number;
          analyzed: number;
          clustered: number;
          message?: string;
        }>;
      };
      if (!response.ok) throw new Error(payload.error || "Feedback could not be pulled.");
      if (payload.routed) {
        setNotice({
          kind: payload.failed ? "error" : "success",
          text: payload.message || "n8n accepted the feedback collection request.",
        });
        router.refresh();
        return;
      }
      const results = payload.results ?? [];
      const completed = results.filter((result) => result.status === "succeeded");
      const sourceSummary = completed.map(
        (result) =>
          `${result.provider}: ${result.created} new, ${result.updated} updated`,
      );
      const analyzed = completed.reduce((sum, result) => sum + result.analyzed, 0);
      const clustered = completed.reduce((sum, result) => sum + result.clustered, 0);
      const issues = results
        .filter((result) => result.status !== "succeeded")
        .map((result) => result.message)
        .filter((message): message is string => Boolean(message));
      const summary = [
        sourceSummary.length ? `Checked ${sourceSummary.join("; ")}.` : "",
        analyzed || clustered
          ? `${analyzed} signal${analyzed === 1 ? "" : "s"} analyzed; ${clustered} problem${clustered === 1 ? "" : "s"} clustered.`
          : "",
        ...issues,
      ].filter(Boolean).join(" ");
      setNotice({
        kind: payload.failed ? "error" : "success",
        text: summary || "Connected sources were checked. No new feedback was found.",
      });
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Feedback could not be pulled." });
    } finally {
      setPullingFeedback(false);
    }
  }
  const hasSourceChoice = connectedPullSources.length > 1;
  const pullButtonLabel = hasSourceChoice
    ? "Pull selected"
    : connectedPullSources.length === 1
      ? `Pull ${connectedPullSources[0].provider}`
      : "Pull connected sources";
  function pullControls(primary = false) {
    return (
      <>
        {hasSourceChoice && (
          <CustomSelect
            ariaLabel="Choose feedback source to pull"
            className="feedback-pull-source-select"
            disabled={pullingFeedback}
            value={selectedPullSource}
            onValueChange={setSelectedPullSource}
            options={[
              { label: "All connected sources", value: "__all__" },
              ...connectedPullSources.map((source) => ({
                label: `${source.provider}${source.accountCount > 1 ? ` (${source.accountCount} accounts)` : ""}${source.manualPullAvailable ? "" : " · unavailable"}`,
                value: source.integrationId,
              })),
            ]}
          />
        )}
        <button
          type="button"
          className={`btn${primary ? " primary" : ""} feedback-pull-button`}
          data-pulling={pullingFeedback ? "true" : "false"}
          aria-label={pullingFeedback ? "Pulling selected feedback sources" : pullButtonLabel}
          disabled={pullingFeedback}
          onClick={() => void pullFeedback()}
        >
          <span className="feedback-pull-button-state feedback-pull-button-idle" aria-hidden={pullingFeedback}>
            <RefreshCw size={14} /> {pullButtonLabel}
          </span>
          <span className="feedback-pull-button-state feedback-pull-button-progress" aria-hidden={!pullingFeedback}>
            <RefreshCw className="spin" size={14} /> Pulling…
          </span>
        </button>
      </>
    );
  }
  if (feedbackItems.length === 0) {
    return (
      <>
        <PageTitle
          title={WORKSPACE_LABELS.feedback}
          action={pullControls(true)}
        />
        {notice && <p className={`toast ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
        <EmptyWorkspaceState
          title="No feedback yet"
          description="Import feedback from a connected source, or connect a new one."
          actionHref="/integrations"
          actionLabel="Manage integrations"
        />
      </>
    );
  }
  if (openFeedback) {
    const linkedProblemId = openLinkedProblem?.id ?? openFeedback.problemId;
    const linkedProblemTitle = openLinkedProblem?.title
      ?? (linkedProblemId ? problemById.get(linkedProblemId)?.title : undefined)
      ?? "Linked issue";
    return (
      <section
        className="feedback-detail-page"
        id={`feedback-detail-${openFeedback.id}`}
        aria-labelledby="feedback-detail-title"
      >
        <header className="feedback-detail-page-header">
          <button
            type="button"
            className="btn feedback-detail-back"
            onClick={closeFeedbackDetails}
          >
            <ChevronLeft size={15} /> Feedback inbox
          </button>
          <nav className="feedback-detail-pagination" aria-label="Browse feedback">
            <button
              type="button"
              className="icon-button"
              aria-label="Previous feedback"
              disabled={openFeedbackIndex <= 0}
              onClick={() => setOpenFeedbackId(visible[openFeedbackIndex - 1]?.id ?? null)}
            >
              <ChevronLeft size={17} />
            </button>
            <span>
              {openFeedbackIndex >= 0
                ? `${openFeedbackIndex + 1} of ${visible.length}`
                : "Filtered item"}
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label="Next feedback"
              disabled={openFeedbackIndex < 0 || openFeedbackIndex >= visible.length - 1}
              onClick={() => setOpenFeedbackId(visible[openFeedbackIndex + 1]?.id ?? null)}
            >
              <ChevronRight size={17} />
            </button>
          </nav>
        </header>

        {notice && (
          <p className={`toast ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
            {notice.text}
          </p>
        )}

        <div className="feedback-detail-page-title">
          <IntegrationProviderIcon
            integrationId={
              openFeedback.source === "Zendesk"
                ? "int_zendesk"
                : openFeedback.source === "Intercom"
                  ? "int_intercom"
                  : openFeedback.source === "Slack"
                    ? "int_slack"
                    : "int_webhook"
            }
          />
          <div>
            <h1 id="feedback-detail-title">{openFeedback.customer}</h1>
            <p>
              {openFeedback.source}
              {openFeedbackReportedAt?.date ? ` · Reported ${openFeedbackReportedAt.date}` : ""}
            </p>
          </div>
          <StatusBadge>
            {openAnalysis?.classification ?? openFeedback.type}
          </StatusBadge>
        </div>

        <div className="feedback-detail-page-layout">
          <main className="feedback-detail-page-main">
            <section className="feedback-detail-primary" aria-labelledby="customer-feedback-title">
              <h2 id="customer-feedback-title">Customer feedback</h2>
              <blockquote>{openFeedback.quote}</blockquote>
            </section>

            {openAnalysis ? (
              <section className="feedback-detail-recommendation" aria-labelledby="feedback-recommendation-title">
                <header>
                  <h2 id="feedback-recommendation-title">CloseSpan recommendation</h2>
                  <span className={`badge ${openAnalysis.reviewStatus === "Approved" ? "success" : "brand"}`}>
                    {openAnalysis.reviewStatus === "Proposed"
                      ? classificationConfidenceLabel(openAnalysis.classificationConfidence)
                      : openAnalysis.reviewStatus}
                  </span>
                </header>
                <p className="feedback-detail-recommendation-summary">
                  {openAnalysis.redactedSummary}
                </p>
                {openAnalysis.proposedProblemId && openAnalysis.reviewStatus === "Proposed" && (
                  <p className="feedback-detail-suggested-problem">
                    Suggested match · {problemById.get(openAnalysis.proposedProblemId)?.title ?? "Existing issue"}
                    <span>{Math.round(openAnalysis.clusterConfidence * 100)}% confidence</span>
                  </p>
                )}
                <details className="feedback-detail-disclosure">
                  <summary>Why CloseSpan made this recommendation</summary>
                  <div>
                    <p>{openAnalysis.rationale}</p>
                    {openAnalysis.evidence.length > 0 && (
                      <ul>
                        {openAnalysis.evidence.map((evidence) => (
                          <li key={evidence}>{evidence}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </details>
              </section>
            ) : (
              <section className="feedback-detail-recommendation feedback-detail-recommendation-empty">
                <h2>No recommendation yet</h2>
                <p>Analyze this report to classify it and find related issues.</p>
              </section>
            )}
          </main>

          <aside className="feedback-detail-page-aside" aria-labelledby="signal-overview-title">
            <section className="feedback-detail-overview">
              <h2 id="signal-overview-title">Signal overview</h2>
              <dl>
                <div>
                  <dt>Severity</dt>
                  <dd>{openAnalysis?.severity ?? openFeedback.severity}</dd>
                </div>
                <div>
                  <dt>Sentiment</dt>
                  <dd>
                    {openAnalysis?.sentiment ? (
                      <span className={`badge feedback-sentiment${sentimentTone(openAnalysis.sentiment)}`}>
                        {openAnalysis.sentiment}
                      </span>
                    ) : (
                      "Not analyzed"
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Privacy</dt>
                  <dd>{openFeedback.redacted ? "PII redacted" : "PII scan clear"}</dd>
                </div>
                <div>
                  <dt>Problem</dt>
                  <dd>
                    {linkedProblemId ? (
                      <Link className="text-link" href={`/problems/${linkedProblemId}#evidence`}>
                        {linkedProblemTitle}
                      </Link>
                    ) : (
                      "Not linked"
                    )}
                  </dd>
                </div>
              </dl>
              <details className="feedback-detail-disclosure feedback-detail-more-facts">
                <summary>More signal details</summary>
                <dl>
                  <div>
                    <dt>Received</dt>
                    <dd>
                      {openFeedbackReportedAt?.date ?? "Date unavailable"}
                      {openFeedbackReportedAt?.time ? ` · ${openFeedbackReportedAt.time}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{openFeedback.source}</dd>
                  </div>
                  <div>
                    <dt>Account</dt>
                    <dd>{openFeedback.accountTier}</dd>
                  </div>
                  <div>
                    <dt>Source context</dt>
                    <dd>{openFeedback.environment}</dd>
                  </div>
                </dl>
              </details>
            </section>
          </aside>
        </div>

        <footer className="feedback-detail-page-actions">
          {linkedProblemId ? (
            <ButtonLink variant="primary" href={`/problems/${linkedProblemId}#evidence`}>
              Open {linkedProblemTitle} <ChevronRight size={14} />
            </ButtonLink>
          ) : openAnalysis?.reviewStatus === "Proposed" ? (
            <div className="feedback-detail-review">
              <div className="field">
                <span>Review destination</span>
                <CustomSelect
                  ariaLabel="Review destination"
                  value={reviewProblemByFeedback[openFeedback.id] ?? openAnalysis.proposedProblemId ?? "__new__"}
                  onValueChange={(value) =>
                    setReviewProblemByFeedback((current) => ({
                      ...current,
                      [openFeedback.id]: value,
                    }))
                  }
                  options={[
                    { value: "__new__", label: "Create a new issue" },
                    ...(openAnalysis.proposedProblemId && !problemOptions.some((problem) => problem.id === openAnalysis.proposedProblemId)
                      ? [{
                          value: openAnalysis.proposedProblemId,
                          label: `Suggested problem · ${openAnalysis.proposedProblemId}`,
                        }]
                      : []),
                    ...problemOptions
                      .filter((problem) => problem.stage !== "Closed")
                      .map((problem) => ({
                        value: problem.id,
                        label: `${problem.id === openAnalysis.proposedProblemId ? "Suggested · " : ""}${problem.title}`,
                      })),
                  ]}
                />
              </div>
              <div className="feedback-detail-review-actions">
                <Button
                  type="button"
                  
                  disabled={reviewBusyId === openFeedback.id}
                  onClick={() => void reviewAnalysis(openFeedback.id, "reject")}
                >
                  Reject proposal
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={reviewBusyId === openFeedback.id}
                  onClick={() => void reviewAnalysis(openFeedback.id, "approve")}
                >
                  {reviewBusyId === openFeedback.id
                    ? "Saving review…"
                    : (reviewProblemByFeedback[openFeedback.id] ?? openAnalysis.proposedProblemId ?? "__new__") === "__new__"
                      ? "Approve & create problem"
                      : "Approve & link problem"}
                </Button>
              </div>
            </div>
          ) : openAnalysis?.reviewStatus === "Rejected" ? (
            <Button
              type="button"
              variant="primary"
              disabled={busy}
              onClick={() => void classify([openFeedback.id])}
            >
              <Sparkles size={14} /> {busy ? "Analyzing…" : "Analyze again"}
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              disabled={busy}
              onClick={() => void classify([openFeedback.id])}
            >
              <Sparkles size={14} /> {busy ? "Analyzing…" : `Analyze with ${providerLabel}`}
            </Button>
          )}
        </footer>
      </section>
    );
  }
  return (
    <>
      <PageTitle
        title={WORKSPACE_LABELS.feedback}
        action={<div className="page-title-actions">
          {proposedAnalyses.length > 0 && <StatusBadge tone="info" role="status">{proposedAnalyses.length} {proposedAnalyses.length === 1 ? "needs" : "need"} review</StatusBadge>}
          {pullControls()}
          <button type="button" className="btn primary feedback-analyze-button" aria-label={`Analyze selected feedback with ${providerLabel}`} disabled={!selected.length || busy} onClick={() => void classify()}>
            <Sparkles size={14} /> {busy ? "Analyzing…" : `Analyze${selected.length ? ` (${selected.length})` : ""}`}
          </button>
        </div>}
      />
      <div className="toolbar">
        <label className="searchbox">
          <Search size={15} />
          <span className="sr-only">Search feedback</span>
          <input
            className="neumorphic-composite-field"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search feedback…"
          />
        </label>
        <CustomSelect
          className="toolbar-select"
          ariaLabel="Filter by source"
          value={source}
          onValueChange={setSource}
          options={[
            "All",
            ...new Set(feedbackItems.map((item) => item.source)),
          ]}
        />
        <Button
          type="button"
          
          aria-expanded={advanced}
          aria-controls="feedback-advanced-filters"
          onClick={() => setAdvanced((value) => !value)}
        >
          <Filter size={14} /> More filters
        </Button>
      </div>
      <div
        id="feedback-advanced-filters"
        className="feedback-filter-region"
        data-open={advanced ? "true" : "false"}
        aria-hidden={!advanced}
        inert={!advanced}
      >
        <div className="feedback-filter-region-inner">
          <div className="filter-panel">
            <div className="filter-field">
              <span>Severity</span>
              <CustomSelect
                ariaLabel="Filter by severity"
                value={severity}
                onValueChange={setSeverity}
                options={["All", "Critical", "High", "Medium", "Low"]}
              />
            </div>
            <div className="filter-field">
              <span>Customer tier</span>
              <CustomSelect
                ariaLabel="Filter by customer tier"
                value={tier}
                onValueChange={setTier}
                options={["All", "Enterprise", "Growth", "Starter", "Unknown"]}
              />
            </div>
            <Button
              type="button"
              
              onClick={() => {
                setQuery("");
                setSource("All");
                setSeverity("All");
                setTier("All");
              }}
            >
              Clear filters
            </Button>
          </div>
        </div>
      </div>
      {notice && (
        <p
          className={`toast ${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      )}
      <section className="card table-wrap">
        <table className="feedback-inbox-table">
          <caption className="sr-only">Customer feedback signals</caption>
          <thead>
            <tr>
              <th>
                <span className="sr-only">Select</span>
              </th>
              <th>Feedback</th>
              <th aria-sort={reportedOrder === "recent" ? "descending" : "ascending"}>
                <button
                  type="button"
                  className="feedback-reported-sort"
                  aria-label={`Reported date, ${reportedOrder === "recent" ? "newest" : "oldest"} first. Activate to show ${reportedOrder === "recent" ? "oldest" : "newest"} first.`}
                  aria-keyshortcuts="ArrowUp ArrowDown"
                  onClick={() =>
                    setReportedOrder((current) => current === "recent" ? "first" : "recent")
                  }
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setReportedOrder("recent");
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setReportedOrder("first");
                    }
                  }}
                >
                  Reported
                  {reportedOrder === "recent" ? (
                    <ArrowDown size={13} aria-hidden="true" />
                  ) : (
                    <ArrowUp size={13} aria-hidden="true" />
                  )}
                </button>
              </th>
              <th>Source</th>
              <th>Type</th>
              <th>Status</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => {
              const analysis = analysisByFeedback.get(item.id);
              const reviewedProblem = reviewedProblems[item.id];
              const reportedAt = formatFeedbackReportedAt(item.observedAt);
              const linkedProblem = item.problemId
                ? problemById.get(item.problemId)
                : undefined;
              const subject = feedbackInboxSubject(item, analysis, reviewedProblem ?? linkedProblem);
              const problemId = reviewedProblem?.id ?? item.problemId;
              return (
                <tr key={item.id}>
                  <td>
                    <label className="feedback-select-control">
                      <input
                        type="checkbox"
                        checked={selected.includes(item.id)}
                        onChange={() => toggle(item.id)}
                        aria-label={`Select feedback: ${subject}, ${item.customer}, ${reportedAt.date}${reportedAt.time ? ` ${reportedAt.time}` : ""}`}
                      />
                    </label>
                  </td>
                  <td>
                    <strong className="feedback-inbox-subject">{subject}</strong>
                  </td>
                  <td className="feedback-reported-date">
                    <time dateTime={item.observedAt} title={reportedAt.time ?? undefined}>
                      <strong>{reportedAt.date}</strong>
                    </time>
                  </td>
                  <td>
                    <StatusBadge>{item.source}</StatusBadge>
                  </td>
                  <td>
                    {analysis?.reviewStatus !== "Rejected" ? analysis?.classification ?? item.type : item.type}
                  </td>
                  <td>
                    <span className={`badge${analysis?.reviewStatus === "Proposed" ? " brand" : ""}`}>
                      {analysis?.reviewStatus === "Proposed" ? "Needs review" : analysis?.reviewStatus ?? "Not analyzed"}
                    </span>
                  </td>
                  <td>
                    <div className="feedback-inbox-actions">
                      <button type="button" className="feedback-expand-button" aria-label={`${analysis?.reviewStatus === "Proposed" ? "Review" : "Details for"} ${subject}`} onClick={() => openFeedbackDetails(item.id)}>
                        {analysis?.reviewStatus === "Proposed" ? "Review" : "Details"} <ChevronRight size={13} />
                      </button>
                      {problemId && <Link className="text-link" href={`/problems/${problemId}`} aria-label={`View issue: ${subject}`}>View issue</Link>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!visible.length && (
          <div className="empty">
            <strong>No matching feedback</strong>
            <p>Try clearing one or more filters.</p>
          </div>
        )}
      </section>
    </>
  );
}
