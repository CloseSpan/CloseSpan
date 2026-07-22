"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Activity,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Database,
  Filter,
  GitBranch,
  Info,
  List,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { calculateImpact } from "@/lib/domain";
import { launchPricingNote } from "@/lib/plans";
import type { DemoState } from "@/lib/store";
import { FeedbackVolumeChart } from "./feedback-volume-chart";
import { IntegrationSyncStatus } from "./integration-sync-status";
import { PipedreamAccountManager } from "./pipedream-account-manager";
import { IntegrationProviderIcon } from "./integration-provider-icon";
import { IntegrationCopilot } from "./integration-copilot";
import { IntegrationSuggestionsView } from "./integration-suggestions-view";
import {
  formatTrend,
  type OverviewAnalytics,
} from "@/lib/overview-analytics";
import { isPipedreamConnectorId } from "@/lib/pipedream-connectors";
import {
  isFeedbackSourceIntegration,
  isIntegrationAvailable,
} from "@/lib/integration-catalog";
import {
  getIntegrationExperience,
  getIntegrationGroup,
  isSimulatedConnectedState,
  type IntegrationFilter,
  type IntegrationGroup,
} from "@/lib/integration-ui";
import type { IntegrationConnectionState } from "@/lib/integration-client";
import type { PipedreamConnectState } from "./pipedream-connect-button";
import type { RecommendedConnector } from "@/lib/onboarding-repository";
import {
  buildIntegrationSuggestions,
  type IntegrationSuggestionPipedreamActivity,
} from "@/lib/integration-suggestions";
import type {
  CustomerView,
  IntegrationView,
  InvestigationQueueItem,
  SettingsView,
} from "@/lib/workspace-repository";
import type {
  FeedbackItem,
  ProductProblem,
  Recommendation,
} from "@/lib/domain";

const money = (value: number) => `$${Math.round(value / 1000)}k`;
const compactMoney = (value: number) =>
  value >= 1_000_000
    ? `$${(value / 1_000_000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}m`
    : money(value);

export function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p className="subtle">{description}</p>
      </div>
      {action}
    </div>
  );
}

function EmptyWorkspaceState({
  title,
  description,
  actionHref,
  actionLabel,
}: {
  title: string;
  description: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <section className="card empty-state">
      <Info size={28} />
      <h2>{title}</h2>
      <p className="subtle">{description}</p>
      <Link className="btn primary" href={actionHref}>
        {actionLabel}
      </Link>
    </section>
  );
}

export function OverviewScreen({
  analytics,
  firstName,
  organizationName,
}: {
  analytics: OverviewAnalytics;
  firstName: string;
  organizationName: string;
}) {
  const { metrics, themes, problems } = analytics;
  const empty =
    analytics.feedbackTotal === 0 &&
    themes.length === 0 &&
    problems.length === 0;
  const metricCards = [
    [
      "New feedback",
      String(metrics.newFeedback),
      `${metrics.awaitingAnalysis} awaiting analysis`,
    ],
    [
      "Active problems",
      String(metrics.activeProblems),
      `${metrics.needsReview} need review`,
    ],
    [
      "Revenue affected",
      compactMoney(metrics.affectedRevenue),
      `Across ${metrics.affectedAccounts} accounts`,
    ],
    [
      "Avg. signal → resolution",
      metrics.averageResolutionDays > 0
        ? `${metrics.averageResolutionDays}d`
        : "No data",
      metrics.averageResolutionDays > 0
        ? `${metrics.resolutionImprovementDays}d faster`
        : "No resolved samples",
    ],
  ];
  return (
    <>
      <PageTitle
        eyebrow={organizationName}
        title={`Welcome, ${firstName}`}
        description="Here is where customer signals need attention today."
        action={
          <Link className="btn primary" href={empty ? "/integrations" : "/approvals"}>
            {empty ? "Connect feedback" : "Review approvals"}{" "}
            <ChevronRight size={14} />
          </Link>
        }
      />
      {empty ? (
        <EmptyWorkspaceState
          title="Your production workspace is ready"
          description="No feedback, customer records, or product problems have been added. Connect an approved source when you are ready to begin."
          actionHref="/integrations"
          actionLabel="Review integrations"
        />
      ) : (
        <>
      <div className="grid cols-4">
        {metricCards.map(([label, value, delta]) => (
          <div className="card metric" key={label}>
            <div className="metric-label">{label}</div>
            <div className="metric-value">{value}</div>
            <div className="metric-delta">{delta}</div>
          </div>
        ))}
      </div>
      <div className="dashboard-grid section-gap">
        <FeedbackVolumeChart analytics={analytics} />
        <section className="card">
          <div className="card-head">
            <h2>Emerging themes</h2>
            <span className="badge brand">
              <Sparkles size={12} /> AI grouped
            </span>
          </div>
          <div className="card-body">
            {themes.length ? (
              themes.map((theme) => (
                <div className="rank-row" key={theme.name}>
                  <div>
                    <strong>{theme.name}</strong>
                    <p className="subtle">{theme.currentSignals} signals</p>
                  </div>
                  <span
                    className="badge"
                    title={`${theme.currentSignals} signals this period versus ${theme.previousSignals} previously`}
                  >
                    {formatTrend(theme.trend)}
                  </span>
                </div>
              ))
            ) : (
              <p className="subtle">No themes have been detected yet.</p>
            )}
          </div>
        </section>
      </div>
      <section className="card section-gap">
        <div className="card-head">
          <div>
            <h2>High-impact problems</h2>
            <p className="subtle">
              Ranked by your organization’s prioritization policy
            </p>
          </div>
          <Link href="/prioritization" className="btn">
            View board
          </Link>
        </div>
        <ProblemTable problems={problems} />
      </section>
        </>
      )}
    </>
  );
}

interface FeedbackAnalysisView {
  feedbackId: string;
  classification: string;
  severity: string;
  redactedSummary: string;
  proposedProblemId: string | null;
  classificationConfidence: number;
  clusterConfidence: number;
  rationale: string;
  evidence: string[];
  reviewStatus: "Proposed" | "Approved" | "Rejected";
}

export function FeedbackScreen({
  feedbackItems,
  orgId,
  providerLabel,
  initialAnalyses = [],
  problemOptions = [],
}: {
  feedbackItems: FeedbackItem[];
  orgId: string;
  providerLabel: string;
  initialAnalyses?: FeedbackAnalysisView[];
  problemOptions?: Array<{ id: string; title: string; stage: string }>;
}) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("All");
  const [severity, setSeverity] = useState("All");
  const [tier, setTier] = useState("All");
  const [selected, setSelected] = useState<string[]>([]);
  const [openFeedbackId, setOpenFeedbackId] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null);
  const [pullingFeedback, setPullingFeedback] = useState(false);
  const [analyses, setAnalyses] =
    useState<FeedbackAnalysisView[]>(initialAnalyses);
  const [reviewProblemByFeedback, setReviewProblemByFeedback] = useState<
    Record<string, string>
  >({});
  const [reviewedProblems, setReviewedProblems] = useState<
    Record<string, { id: string; title: string; stage: string }>
  >({});
  const router = useRouter();
  const visible = useMemo(
    () =>
      feedbackItems.filter(
        (item) =>
          (source === "All" || item.source === source) &&
          (severity === "All" || item.severity === severity) &&
          (tier === "All" || item.accountTier === tier) &&
          `${item.customer} ${item.quote}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [feedbackItems, query, source, severity, tier],
  );
  const analysisByFeedback = useMemo(
    () => new Map(analyses.map((analysis) => [analysis.feedbackId, analysis])),
    [analyses],
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
  const proposedAnalyses = analyses.filter(
    (analysis) => analysis.reviewStatus === "Proposed",
  );
  useEffect(() => {
    if (!openFeedbackId) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenFeedbackId(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [openFeedbackId]);
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
            ? `${payload.createdProblem ? "Created" : "Linked"} product problem “${payload.problem?.title ?? "Needs review"}”. The overview and problem board now use this reviewed feedback.`
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
      const response = await fetch("/api/integrations/pipedream/pull", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-org-id": orgId,
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        failed?: number;
        results?: Array<{ fetched: number; created: number; updated: number }>;
      };
      if (!response.ok) throw new Error(payload.error || "Feedback could not be pulled.");
      const totals = (payload.results ?? []).reduce(
        (sum, result) => ({
          fetched: sum.fetched + result.fetched,
          created: sum.created + result.created,
          updated: sum.updated + result.updated,
        }),
        { fetched: 0, created: 0, updated: 0 },
      );
      setNotice({
        kind: payload.failed ? "error" : "success",
        text: `Pull complete: ${totals.created} new, ${totals.updated} updated (${totals.fetched} fetched).${payload.failed ? ` ${payload.failed} account failed and can be retried from Integrations.` : ""}`,
      });
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Feedback could not be pulled." });
    } finally {
      setPullingFeedback(false);
    }
  }
  if (feedbackItems.length === 0) {
    return (
      <>
        <PageTitle
          title="Unified feedback inbox"
          description="Review normalized customer signals across every connected source."
          action={
            <button type="button" className="btn primary" disabled={pullingFeedback} onClick={() => void pullFeedback()}>
              <RefreshCw className={pullingFeedback ? "spin" : ""} size={14} />
              {pullingFeedback ? "Pulling feedback..." : "Pull feedback now"}
            </button>
          }
        />
        {notice && <p className={`toast ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
        <EmptyWorkspaceState
          title="No feedback has been imported"
          description="This workspace has no customer signals. Connect an approved source before running classification or clustering."
          actionHref="/integrations"
          actionLabel="Review integrations"
        />
      </>
    );
  }
  return (
    <>
      <PageTitle
        title="Unified feedback inbox"
        description="Review normalized customer signals across every connected source."
        action={<div className="page-title-actions">
          <button type="button" className="btn" disabled={pullingFeedback} onClick={() => void pullFeedback()}>
            <RefreshCw className={pullingFeedback ? "spin" : ""} size={14} />
            {pullingFeedback ? "Pulling..." : "Pull feedback"}
          </button>
          <button type="button" className="btn primary" disabled={!selected.length || busy} onClick={() => void classify()}>
            <Sparkles size={14} /> {busy ? "Analyzing…" : `Analyze with ${providerLabel} ${selected.length || ""}`}
          </button>
        </div>}
      />
      <div className="toolbar">
        <label className="searchbox">
          <Search size={15} />
          <span className="sr-only">Search feedback</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search customer feedback…"
          />
        </label>
        <select
          value={source}
          onChange={(event) => setSource(event.target.value)}
          aria-label="Filter by source"
        >
          <option>All</option>
          {[...new Set(feedbackItems.map((item) => item.source))].map(
            (item) => (
              <option key={item}>{item}</option>
            ),
          )}
        </select>
        <button
          type="button"
          className="btn"
          aria-expanded={advanced}
          onClick={() => setAdvanced((value) => !value)}
        >
          <Filter size={14} /> More filters
        </button>
      </div>
      {advanced && (
        <div className="filter-panel">
          <label>
            Severity
            <select
              value={severity}
              onChange={(event) => setSeverity(event.target.value)}
            >
              <option>All</option>
              <option>Critical</option>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
          </label>
          <label>
            Customer tier
            <select
              value={tier}
              onChange={(event) => setTier(event.target.value)}
            >
              <option>All</option>
              <option>Enterprise</option>
              <option>Growth</option>
              <option>Starter</option>
            </select>
          </label>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setQuery("");
              setSource("All");
              setSeverity("All");
              setTier("All");
            }}
          >
            Clear filters
          </button>
        </div>
      )}
      {notice && (
        <p
          className={`toast ${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      )}
      {analyses.length > 0 && (
        <section
          className="callout grok-result"
          aria-label="Latest AI recommendations"
        >
          <div className="split">
            <div>
              <div className="callout-title">
                <Sparkles size={13} /> {providerLabel} recommendations
              </div>
              <p className="subtle">
                Classification confidence = 50% clarity + 35% evidence quality +
                15% inverse ambiguity. Cluster confidence uses 65% semantic
                match + 20% evidence quality + 15% inverse ambiguity.
              </p>
            </div>
            <span className="badge brand">
              {proposedAnalyses.length} awaiting review
            </span>
          </div>
        </section>
      )}
      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <span className="sr-only">Select</span>
              </th>
              <th>Customer signal</th>
              <th>Source</th>
              <th>Type</th>
              <th>Severity</th>
              <th>Account</th>
              <th>Problem</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => {
              const analysis = analysisByFeedback.get(item.id);
              const reviewedProblem = reviewedProblems[item.id];
              return (
                <tr key={item.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={() => toggle(item.id)}
                      aria-label={`Select feedback from ${item.customer}`}
                    />
                  </td>
                  <td>
                    <div className="feedback-signal-heading">
                      <strong>{item.customer}</strong>
                      <button
                        type="button"
                        className="feedback-expand-button"
                        aria-expanded={openFeedbackId === item.id}
                        aria-controls={`feedback-detail-${item.id}`}
                        onClick={() => setOpenFeedbackId(item.id)}
                      >
                        View details <ChevronRight size={13} />
                      </button>
                    </div>
                    <p className="truncate">{item.quote}</p>
                    <small>
                      {item.observedAt} ·{" "}
                      {analysis
                        ? `${Math.round(analysis.classificationConfidence * 100)}% AI classification proposal`
                        : `${Math.round(item.confidence * 100)}% classification confidence`}{" "}
                      · {item.redacted ? "PII redacted" : "PII scan clear"}
                    </small>
                    {analysis && (
                      <details className="ai-evidence">
                        <summary>Why the model suggested this</summary>
                        <p>{analysis.rationale}</p>
                        <ul>
                          {analysis.evidence.map((evidence) => (
                            <li key={evidence}>{evidence}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                  <td>
                    <span className="badge">{item.source}</span>
                  </td>
                  <td>
                    {analysis ? (
                      <>
                        <span>{analysis.classification}</span>
                        <small>{analysis.reviewStatus}</small>
                      </>
                    ) : (
                      item.type
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge ${(analysis?.severity ?? item.severity).toLowerCase()}`}
                    >
                      {analysis?.severity ?? item.severity}
                    </span>
                  </td>
                  <td>
                    {item.accountTier}
                    <small>{money(item.arr)} ARR</small>
                  </td>
                  <td>
                    {reviewedProblem ? (
                      <>
                        <Link className="text-link" href={`/problems/${reviewedProblem.id}`}>
                          {reviewedProblem.title}
                        </Link>
                        <small>Reviewed link</small>
                      </>
                    ) : item.problemId ? (
                      <Link
                        className="text-link"
                        href={`/problems/${item.problemId}`}
                      >
                        {item.problemId}
                      </Link>
                    ) : analysis?.proposedProblemId && analysis.reviewStatus === "Proposed" ? (
                      <>
                        <Link
                          className="text-link"
                          href={`/problems/${analysis.proposedProblemId}`}
                        >
                          {analysis.proposedProblemId}
                        </Link>
                        <small>
                          {Math.round(analysis.clusterConfidence * 100)}%
                          proposed match
                        </small>
                      </>
                    ) : (
                      <span className="subtle">Unclustered</span>
                    )}
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
      {openFeedback && (
        <div
          className="feedback-drawer-layer"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setOpenFeedbackId(null);
          }}
        >
          <aside
            className="feedback-drawer"
            id={`feedback-detail-${openFeedback.id}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-detail-title"
          >
            <header className="feedback-drawer-head">
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
                <span>{openFeedback.source} feedback</span>
                <h2 id="feedback-detail-title">{openFeedback.customer}</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close feedback details"
                autoFocus
                onClick={() => setOpenFeedbackId(null)}
              >
                <X size={18} />
              </button>
            </header>

            <div className="feedback-drawer-body">
              <section className="feedback-detail-section">
                <div className="feedback-detail-label">Full feedback</div>
                <blockquote className="feedback-full-message">
                  {openFeedback.quote}
                </blockquote>
              </section>

              <dl className="feedback-detail-grid">
                <div>
                  <dt>Received</dt>
                  <dd>{openFeedback.observedAt}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{openFeedback.source}</dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd>{openAnalysis?.classification ?? openFeedback.type}</dd>
                </div>
                <div>
                  <dt>Severity</dt>
                  <dd>{openAnalysis?.severity ?? openFeedback.severity}</dd>
                </div>
                <div>
                  <dt>Account</dt>
                  <dd>{openFeedback.accountTier} · {money(openFeedback.arr)} ARR</dd>
                </div>
                <div>
                  <dt>Privacy</dt>
                  <dd>{openFeedback.redacted ? "PII redacted" : "PII scan clear"}</dd>
                </div>
                <div className="feedback-detail-wide">
                  <dt>Source context</dt>
                  <dd>{openFeedback.environment}</dd>
                </div>
              </dl>

              {openAnalysis && (
                <section className="feedback-detail-section feedback-analysis-card">
                  <div className="split">
                    <div>
                      <div className="feedback-detail-label">AI recommendation</div>
                      <h3>{openAnalysis.redactedSummary}</h3>
                    </div>
                    <span className={`badge ${openAnalysis.reviewStatus === "Approved" ? "success" : "brand"}`}>
                      {openAnalysis.reviewStatus === "Proposed"
                        ? `${Math.round(openAnalysis.classificationConfidence * 100)}% confidence`
                        : openAnalysis.reviewStatus}
                    </span>
                  </div>
                  <p>{openAnalysis.rationale}</p>
                  {openAnalysis.evidence.length > 0 && (
                    <ul>
                      {openAnalysis.evidence.map((evidence) => (
                        <li key={evidence}>{evidence}</li>
                      ))}
                    </ul>
                  )}
                  {openAnalysis.proposedProblemId && openAnalysis.reviewStatus === "Proposed" && (
                    <div className="feedback-proposed-match">
                      <span>Suggested existing problem</span>
                      <strong>{openAnalysis.proposedProblemId}</strong>
                      <small>{Math.round(openAnalysis.clusterConfidence * 100)}% proposed match · human review required</small>
                    </div>
                  )}
                </section>
              )}

              <section className="feedback-journey" aria-labelledby="feedback-journey-title">
                <div>
                  <div className="feedback-detail-label">Workflow</div>
                  <h3 id="feedback-journey-title">Where this feedback goes</h3>
                </div>
                <ol>
                  <li className="done">
                    <span><Check size={12} /></span>
                    <div><strong>Feedback collected</strong><small>Stored in the shared inbox from {openFeedback.source}.</small></div>
                  </li>
                  <li className={openAnalysis || openFeedback.problemId ? "done" : "current"}>
                    <span>{openAnalysis || openFeedback.problemId ? <Check size={12} /> : "2"}</span>
                    <div><strong>Analyze the signal</strong><small>Classify it and look for a matching product problem.</small></div>
                  </li>
                  <li className={openFeedback.problemId || openLinkedProblem || (openAnalysis && openAnalysis.reviewStatus !== "Proposed") ? "done" : openAnalysis ? "current" : "future"}>
                    <span>{openFeedback.problemId || openLinkedProblem || (openAnalysis && openAnalysis.reviewStatus !== "Proposed") ? <Check size={12} /> : "3"}</span>
                    <div>
                      <strong>Review the product problem</strong>
                      <small>
                        {openAnalysis?.reviewStatus === "Rejected"
                          ? "The proposal was rejected; this signal remains unclustered."
                          : openFeedback.problemId || openLinkedProblem
                            ? "A person approved this feedback-to-problem link."
                            : "A person confirms the evidence before any action is taken."}
                      </small>
                    </div>
                  </li>
                  <li className="future">
                    <span>4</span>
                    <div><strong>Approve an engineering action</strong><small>Approved work can then route to GitHub and follow-up.</small></div>
                  </li>
                </ol>
              </section>
            </div>

            <footer className="feedback-drawer-footer">
              <div className="feedback-drawer-navigation" aria-label="Browse feedback">
                <button
                  type="button"
                  className="btn"
                  disabled={openFeedbackIndex <= 0}
                  onClick={() => setOpenFeedbackId(visible[openFeedbackIndex - 1]?.id ?? null)}
                >
                  <ChevronLeft size={14} /> Previous
                </button>
                <span>{openFeedbackIndex >= 0 ? `${openFeedbackIndex + 1} of ${visible.length}` : "Filtered item"}</span>
                <button
                  type="button"
                  className="btn"
                  disabled={openFeedbackIndex < 0 || openFeedbackIndex >= visible.length - 1}
                  onClick={() => setOpenFeedbackId(visible[openFeedbackIndex + 1]?.id ?? null)}
                >
                  Next <ChevronRight size={14} />
                </button>
              </div>
              {openLinkedProblem || openFeedback.problemId ? (
                <Link className="btn primary full-width" href={`/problems/${openLinkedProblem?.id ?? openFeedback.problemId}#evidence`}>
                  Open linked product problem <ChevronRight size={14} />
                </Link>
              ) : openAnalysis?.reviewStatus === "Proposed" ? (
                <div className="feedback-review-actions">
                  <label>
                    Review destination
                    <select
                      value={reviewProblemByFeedback[openFeedback.id] ?? openAnalysis.proposedProblemId ?? "__new__"}
                      onChange={(event) =>
                        setReviewProblemByFeedback((current) => ({
                          ...current,
                          [openFeedback.id]: event.target.value,
                        }))
                      }
                    >
                      <option value="__new__">Create a new product problem</option>
                      {openAnalysis.proposedProblemId && !problemOptions.some((problem) => problem.id === openAnalysis.proposedProblemId) && (
                        <option value={openAnalysis.proposedProblemId}>Suggested problem · {openAnalysis.proposedProblemId}</option>
                      )}
                      {problemOptions
                        .filter((problem) => problem.stage !== "Closed")
                        .map((problem) => (
                          <option value={problem.id} key={problem.id}>
                            {problem.id === openAnalysis.proposedProblemId ? "Suggested · " : ""}{problem.title}
                          </option>
                        ))}
                    </select>
                  </label>
                  <p>
                    Approval creates a reviewed evidence link. Choose “Create” when this is a new problem, or select an existing problem to add the signal there.
                  </p>
                  <div>
                    <button
                      type="button"
                      className="btn"
                      disabled={reviewBusyId === openFeedback.id}
                      onClick={() => void reviewAnalysis(openFeedback.id, "reject")}
                    >
                      Reject proposal
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={reviewBusyId === openFeedback.id}
                      onClick={() => void reviewAnalysis(openFeedback.id, "approve")}
                    >
                      {reviewBusyId === openFeedback.id
                        ? "Saving review…"
                        : (reviewProblemByFeedback[openFeedback.id] ?? openAnalysis.proposedProblemId ?? "__new__") === "__new__"
                          ? "Approve & create problem"
                          : "Approve & link problem"}
                    </button>
                  </div>
                </div>
              ) : openAnalysis?.reviewStatus === "Rejected" ? (
                <button
                  type="button"
                  className="btn primary full-width"
                  disabled={busy}
                  onClick={() => void classify([openFeedback.id])}
                >
                  <Sparkles size={14} /> {busy ? "Analyzing..." : "Analyze again"}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn primary full-width"
                  disabled={busy}
                  onClick={() => void classify([openFeedback.id])}
                >
                  <Sparkles size={14} /> {busy ? "Analyzing..." : `Analyze this signal with ${providerLabel}`}
                </button>
              )}
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}

function RevenueCell({
  problemId,
  revenue,
  accounts,
}: {
  problemId: string;
  revenue: number;
  accounts: OverviewAnalytics["problems"][number]["accounts"];
}) {
  const breakdownId = `revenue-breakdown-${problemId}`;
  return (
    <div className="revenue-with-info">
      {money(revenue)}
      {accounts.length > 0 && (
        <details className="revenue-details">
          <summary
            className="revenue-info"
            aria-label={`Show affected account revenue breakdown for ${problemId}`}
          >
            <Info size={13} />
          </summary>
          <div className="revenue-breakdown" id={breakdownId}>
            <strong>Affected account ARR</strong>
            {accounts.map((account) => (
              <div key={account.accountId}>
                {account.accountName} <b>{money(account.arr)}</b>
              </div>
            ))}
            <div className="revenue-total">
              Total <b>{money(revenue)}</b>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}

function ProblemTable({
  problems,
}: {
  problems: OverviewAnalytics["problems"];
}) {
  if (problems.length === 0) {
    return (
      <div className="empty">
        <strong>No product problems</strong>
        <p>Reviewed problem clusters will appear here.</p>
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Product problem</th>
            <th>Signals</th>
            <th>Revenue</th>
            <th>Severity</th>
            <th>Trend</th>
            <th>Confidence</th>
            <th>Stage</th>
          </tr>
        </thead>
        <tbody>
          {problems.map((problem) => (
            <tr key={problem.id}>
              <td>
                <Link className="row-link" href={`/problems/${problem.id}`}>
                  <strong>{problem.title}</strong>
                  <small>{problem.productArea}</small>
                </Link>
              </td>
              <td>{problem.count}</td>
              <td>
                <RevenueCell
                  problemId={problem.id}
                  revenue={problem.revenue}
                  accounts={problem.accounts}
                />
              </td>
              <td>
                <span className={`badge ${problem.severity.toLowerCase()}`}>
                  {problem.severity}
                </span>
              </td>
              <td
                className="trend"
                title={`${problem.currentSignals} signals this period versus ${problem.previousSignals} previously`}
              >
                {formatTrend(problem.trend)}
              </td>
              <td>{problem.confidence}%</td>
              <td>
                <span className="badge brand">{problem.stage}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProblemsScreen({
  analytics,
}: {
  analytics: OverviewAnalytics;
}) {
  const uncertain = analytics.problems.filter(
    (problem) => problem.confidence < 80,
  ).length;
  const high = analytics.problems.filter((problem) =>
    ["High", "Critical"].includes(problem.severity),
  ).length;
  const reviewProblem =
    analytics.problems.find((problem) => problem.stage === "Needs review") ??
    analytics.problems[0];
  return (
    <>
      <PageTitle
        title="Product problems"
        description="Persistent clusters that connect repeated feedback to business and engineering context."
        action={reviewProblem ? (
          <Link className="btn" href={`/problems/${reviewProblem.id}#evidence`}>
            <Sparkles size={14} /> Review clustering suggestion
          </Link>
        ) : undefined}
      />
      {analytics.problems.length === 0 ? (
        <EmptyWorkspaceState
          title="No product problems yet"
          description="Problems will appear after feedback is imported and reviewed. No placeholder clusters have been created."
          actionHref="/feedback"
          actionLabel="Open feedback inbox"
        />
      ) : (
        <>
      <div className="grid cols-4 page-metrics">
        {[
          ["Needs review", analytics.metrics.needsReview],
          ["High or critical", high],
          ["Uncertain clusters", uncertain],
          ["Active problems", analytics.metrics.activeProblems],
        ].map(([label, value]) => (
          <div className="card metric" key={label}>
            <div className="metric-label">{label}</div>
            <div className="metric-value">{value}</div>
          </div>
        ))}
      </div>
      <section className="card">
        <div className="card-head">
          <h2>All product problems</h2>
          <span className="badge">
            {analytics.metrics.activeProblems} active
          </span>
        </div>
        <ProblemTable problems={analytics.problems} />
      </section>
        </>
      )}
    </>
  );
}

export function PrioritizationScreen({
  analytics,
  focusProblem,
}: {
  analytics: OverviewAnalytics;
  focusProblem: ProductProblem | null;
}) {
  const [view, setView] = useState<"board" | "ranked">("board");
  const impact = focusProblem
    ? calculateImpact(focusProblem.impactFactors)
    : null;
  const rows = analytics.problems;
  return (
    <>
      <PageTitle
        title="Prioritization"
        description="An explainable ranking based on customer impact and product strategy."
        action={
          <div className="segmented">
            <button
              type="button"
              className={view === "board" ? "active" : ""}
              onClick={() => setView("board")}
            >
              Board
            </button>
            <button
              type="button"
              className={view === "ranked" ? "active" : ""}
              onClick={() => setView("ranked")}
            >
              <List size={13} /> Ranked
            </button>
          </div>
        }
      />
      {rows.length === 0 ? (
        <EmptyWorkspaceState
          title="Nothing to prioritize"
          description="The prioritization board is empty because this workspace has no product problems."
          actionHref="/feedback"
          actionLabel="Review feedback"
        />
      ) : (
        <>
      {view === "ranked" ? (
        <section className="card">
          <ProblemTable problems={rows} />
        </section>
      ) : (
        <div className="board">
          {[
            "Detected",
            "Needs review",
            "Approved",
            "Planned",
            "In progress",
            "Released",
            "Verified",
            "Closed",
          ].map((stage) => (
            <section className="board-col" key={stage}>
              <div className="board-head">
                <strong>{stage}</strong>
                <span>
                  {rows.filter((problem) => problem.stage === stage).length}
                </span>
              </div>
              {rows
                .filter((problem) => problem.stage === stage)
                .map((problem) => (
                  <Link
                    className="problem-card"
                    href={`/problems/${problem.id}`}
                    key={problem.id}
                  >
                    <div className="split">
                      <span
                        className={`badge ${problem.severity.toLowerCase()}`}
                      >
                        {problem.severity}
                      </span>
                      {problem.id === focusProblem?.id && impact ? (
                        <strong className="score-small">{impact.score}</strong>
                      ) : null}
                    </div>
                    <h3>{problem.title}</h3>
                    <p className="subtle">
                      {problem.count} signals · {money(problem.revenue)} ARR
                    </p>
                    <div className="mini-bar">
                      <span style={{ width: `${problem.confidence}%` }} />
                    </div>
                    <small>{problem.confidence}% evidence confidence</small>
                  </Link>
                ))}
            </section>
          ))}
        </div>
      )}
      <div className="callout section-gap">
        <div className="callout-title">Scoring policy</div>
        <p className="subtle">
          Frequency, severity, and revenue each contribute 20%. Churn risk
          contributes 15%; customer tier 10%; strategy, SLA, and engineering
          effort 5% each. Engineering effort is treated as a cost, so higher
          effort reduces priority.
        </p>
        <Link className="text-link" href="/settings#priority">
          Configure policy
        </Link>
      </div>
        </>
      )}
    </>
  );
}

export function InvestigationsScreen({
  problem,
  investigation,
  queue = [],
}: {
  problem: ProductProblem | null;
  investigation: Recommendation | null;
  queue?: InvestigationQueueItem[];
}) {
  if (!problem) {
    return (
      <>
        <PageTitle
          title="AI investigations"
          description="Code-aware recommendations with evidence, assumptions, and uncertainty."
        />
        <EmptyWorkspaceState
          title="No problems to investigate"
          description="Create a reviewed product problem from customer feedback before preparing an investigation."
          actionHref="/feedback"
          actionLabel="Open feedback inbox"
        />
      </>
    );
  }
  if (!investigation) {
    return (
      <>
        <PageTitle
          title="AI investigations"
          description="Code-aware recommendations with evidence, assumptions, and uncertainty."
        />
        <EmptyWorkspaceState
          title="No investigation is ready"
          description={`The problem “${problem.title}” exists, but no investigation or recommendation has been prepared.`}
          actionHref={`/problems/${problem.id}`}
          actionLabel="Review product problem"
        />
      </>
    );
  }
  return (
    <>
      <PageTitle
        title="AI investigations"
        description="Code-aware recommendations with evidence, assumptions, and uncertainty."
        action={<span className="badge brand">Observe & recommend</span>}
      />
      <div className="grid cols-3">
        <section className="card span-2">
          <div className="card-head">
            <div>
              <h2>{problem.title}</h2>
              <p className="subtle">
                {problem.suspectedRepository} · {problem.team}
              </p>
            </div>
            <span className="badge medium">
              {Math.round(investigation.confidence * 100)}% confidence
            </span>
          </div>
          <div className="card-body">
            <div className="callout warning">
              <div className="callout-title">
                <AlertTriangle size={13} /> Hypothesis, not confirmed
              </div>
              <p className="subtle">{investigation.hypothesis}</p>
            </div>
            <div className="grid cols-3 section-gap">
              <InfoBlock
                title="Suspected files"
                items={problem.suspectedFiles}
              />
              <InfoBlock
                title="Missing evidence"
                items={investigation.missingInformation}
              />
              <InfoBlock
                title="Recommended tests"
                items={investigation.tests}
              />
            </div>
            <div className="split section-gap">
              <Link className="btn" href={`/problems/${problem.id}`}>
                Review evidence
              </Link>
              <Link className="btn primary" href="/approvals">
                Open approval <ChevronRight size={14} />
              </Link>
            </div>
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <h2>Queue</h2>
            <span className="badge">{queue.length} items</span>
          </div>
          <div className="card-body">
            {queue.length ? (
              queue.map((item) => (
                <div className="rank-row" key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <p className="subtle">Repository investigation</p>
                  </div>
                  <span className="badge">{item.status}</span>
                </div>
              ))
            ) : (
              <p className="subtle">No other investigations are queued.</p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
function InfoBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3>{title}</h3>
      <ul className="list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

async function workflowMutation(
  path: string,
  orgId: string,
): Promise<DemoState> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "x-org-id": orgId,
      "idempotency-key": crypto.randomUUID(),
      "x-request-id": crypto.randomUUID(),
    },
  });
  const payload = (await response.json()) as {
    state?: DemoState;
    error?: string;
  };
  if (!response.ok || !payload.state)
    throw new Error(payload.error ?? "Action failed");
  return payload.state;
}

export function ApprovalsScreen({
  initialState,
  problem,
  investigation,
  queue,
}: {
  initialState: DemoState | null;
  problem: ProductProblem | null;
  investigation: Recommendation | null;
  queue: InvestigationQueueItem[];
}) {
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  }>();
  const [editing, setEditing] = useState(false);
  const [proposal, setProposal] = useState(
    investigation?.proposedAction ?? "",
  );
  if (!state || !problem || !investigation) {
    return (
      <>
        <PageTitle
          title="Approval center"
          description="Review every meaningful agent action before it affects external systems."
        />
        <EmptyWorkspaceState
          title="No approval workflow exists"
          description="This workspace has no prepared recommendation awaiting a decision. No placeholder approval was created."
          actionHref={problem ? `/problems/${problem.id}` : "/feedback"}
          actionLabel={problem ? "Review product problem" : "Open feedback inbox"}
        />
      </>
    );
  }
  const activeProblem = problem;
  async function decide(action: "approve" | "reject") {
    setBusy(true);
    setNotice(undefined);
    try {
      setState(
        await workflowMutation(`/api/workflow/${action}`, activeProblem.orgId),
      );
      setNotice({
        kind: "success",
        text: `Proposal ${action === "approve" ? "approved" : "rejected"}; the audited workflow state is updated.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Action failed",
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title="Approval center"
        description="Review every meaningful agent action before it affects external systems."
        action={
          <span
            className={`badge ${state.approval.status === "Pending" ? "medium" : "success"}`}
          >
            {state.approval.status === "Pending"
              ? "1 awaiting review"
              : "Queue reviewed"}
          </span>
        }
      />
      <div className="approval-layout">
        <section className="card">
          <div className="card-head">
            <h2>Queue</h2>
            <span className="badge">Risk ordered</span>
          </div>
          <button
            type="button"
            className="queue-item selected"
            aria-pressed="true"
          >
            <div>
              <strong>{state.approval.action}</strong>
              <p className="subtle">{problem.id} · Proposed by agent</p>
            </div>
            <span className="badge">{state.approval.risk}</span>
          </button>
          {queue.map((item) => (
            <div className="queue-item disabled" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <p className="subtle">{item.status}</p>
              </div>
              <span className="badge">Queued</span>
            </div>
          ))}
        </section>
        <section className="card">
          <div className="card-head">
            <div>
              <h2>{state.approval.action}</h2>
              <p className="subtle">
                {problem.suspectedRepository} · {problem.id}
              </p>
            </div>
            <span
              className={`badge ${state.approval.status === "Approved" ? "success" : state.approval.status === "Rejected" ? "high" : "medium"}`}
            >
              {state.approval.status}
            </span>
          </div>
          <div className="card-body">
            <p>{proposal}</p>
            {editing && (
              <label className="field section-gap-sm">
                Proposed action
                <textarea
                  rows={5}
                  value={proposal}
                  onChange={(event) => setProposal(event.target.value)}
                />
              </label>
            )}
            <div className="approval-facts">
              <Fact
                icon={<Sparkles />}
                label="Reason"
                value={state.approval.reason}
              />
              <Fact
                icon={<ShieldCheck />}
                label="Risk & reversibility"
                value={`${state.approval.risk} risk · ${state.approval.reversible ? "Reversible" : "Not reversible"}`}
              />
              <Fact
                icon={<GitBranch />}
                label="Systems affected"
                value={state.approval.systems.join(", ")}
              />
              <Fact
                icon={<Users />}
                label="Data shared"
                value={state.approval.dataShared.join(", ")}
              />
            </div>
            <div className="callout warning">
              <div className="callout-title">
                {Math.round(investigation.confidence * 100)}% confidence
              </div>
              <p className="subtle">
                The root-cause statement is a hypothesis.{" "}
                {investigation.missingInformation.length} evidence gaps remain
                and will be included in the issue.
              </p>
            </div>
            {state.approval.status === "Pending" ? (
              <div className="approval-actions">
                <button
                  type="button"
                  className="btn danger"
                  disabled={busy}
                  onClick={() => decide("reject")}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setEditing((value) => !value)}
                >
                  {editing ? "Save draft" : "Edit proposal"}
                </button>
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy}
                  onClick={() => decide("approve")}
                >
                  Approve simulated external action <Check size={14} />
                </button>
              </div>
            ) : (
              <div className="success-panel">
                <Check size={16} /> Decision recorded in the shared audit trail.
              </div>
            )}
            {notice && (
              <p
                className={`toast ${notice.kind}`}
                role={notice.kind === "error" ? "alert" : "status"}
              >
                {notice.text}
              </p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
function Fact({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="fact">
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

export function IntegrationsScreen({
  integrations,
  orgId,
  focusedIntegrationId = null,
  productName,
  recommendedConnectors,
  initialIntegrationActivity,
  initialView,
}: {
  integrations: IntegrationView[];
  orgId: string;
  focusedIntegrationId?: string | null;
  productName: string | null;
  recommendedConnectors: RecommendedConnector[];
  initialIntegrationActivity: Array<{
    integrationId: string;
    accountName: string | null;
    state: "Connected" | "Needs reconnect" | "Disconnected";
    healthy: boolean | null;
    lastImportAt: string | null;
    lastImportStatus: "Running" | "Succeeded" | "Failed" | null;
    lastImportCount: number;
  }>;
  initialView: "suggestions" | "connections";
}) {
  const focusedCardRef = useRef<HTMLElement | null>(null);
  const suggestionsTabRef = useRef<HTMLButtonElement | null>(null);
  const connectionsTabRef = useRef<HTMLButtonElement | null>(null);
  const simulated = integrations.some((item) =>
    isSimulatedConnectedState(item.state),
  );
  const [connectedIds, setConnectedIds] = useState(() =>
    integrations
      .filter(
        (integration) =>
          integration.state === "Connected" ||
          isSimulatedConnectedState(integration.state),
      )
      .map((integration) => integration.id),
  );
  const [connectionStates, setConnectionStates] = useState<
    Partial<Record<string, IntegrationConnectionState>>
  >(() =>
    Object.fromEntries(
      integrations
        .filter(
          (integration) =>
            isPipedreamConnectorId(integration.id) &&
            ["Connected", "Needs reconnect", "Disconnected"].includes(
              integration.state,
            ),
        )
        .map((integration) => [
          integration.id,
          integration.state as Exclude<IntegrationConnectionState, null>,
        ]),
    ),
  );
  const [activeView, setActiveView] = useState(initialView);
  const [connectionProgress, setConnectionProgress] = useState<
    Partial<Record<string, PipedreamConnectState>>
  >({});
  const [integrationActivity, setIntegrationActivity] = useState(
    initialIntegrationActivity,
  );
  const [lastSyncOverrides, setLastSyncOverrides] = useState<
    Partial<Record<string, string>>
  >({});
  const [webhookBusy, setWebhookBusy] = useState(false);
  const [webhookError, setWebhookError] = useState<string | null>(null);
  const [webhookCredentials, setWebhookCredentials] = useState<{
    webhookUrl: string;
    signingSecret: string;
  } | null>(null);
  const [webhookCopied, setWebhookCopied] = useState<"url" | "secret" | null>(
    null,
  );
  const [activeFilter, setActiveFilter] = useState<IntegrationFilter>("All");
  const [selectedIntegrationId, setSelectedIntegrationId] = useState<
    string | null
  >(null);

  const connectorRows = integrations.map((item) => {
    const progress = connectionProgress[item.id];
    const itemWithLiveState = {
      ...item,
      state:
        progress === "opening" || progress === "waiting"
          ? "Pending setup"
          : progress === "error"
            ? "Connection failed"
            : progress === "connected"
              ? "Connected"
              : item.state,
      lastSync: lastSyncOverrides[item.id] ?? item.lastSync,
    };
    const observedConnectionState = connectionStates[item.id];
    const demonstration = isSimulatedConnectedState(itemWithLiveState.state);
    const connected =
      observedConnectionState === undefined
        ? connectedIds.includes(item.id)
        : observedConnectionState === "Connected";
    const available = isIntegrationAvailable(item.id);
    return {
      item: itemWithLiveState,
      observedConnectionState,
      demonstration,
      connected,
      available,
      experience: getIntegrationExperience({
        id: item.id,
        provider: item.name,
        category: item.category,
      }),
      group: getIntegrationGroup({ connected, available }),
    };
  });
  const visibleRows = connectorRows.filter(
    (row) => activeFilter === "All" || row.experience.filter === activeFilter,
  );
  const selectedRow = connectorRows.find(
    (row) => row.item.id === selectedIntegrationId,
  );
  const connectedFeedbackSources = connectorRows.filter(
    (row) => row.connected && isFeedbackSourceIntegration(row.item.id),
  );
  const connectedActionDestinations = connectorRows.filter(
    (row) =>
      row.connected &&
      row.available &&
      !isFeedbackSourceIntegration(row.item.id),
  );
  const reconnectCount = connectorRows.filter(
    (row) => row.observedConnectionState === "Needs reconnect",
  ).length;
  const latestImport = connectorRows
    .map((row) => row.item.lastSync)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
  const pipedreamActivity: IntegrationSuggestionPipedreamActivity[] =
    integrationActivity.map((activity) => ({
      integrationId: activity.integrationId,
      connectionState: activity.state,
      lastImportStatus: activity.lastImportStatus,
      lastImportAt: activity.lastImportAt,
      lastImportCount: activity.lastImportCount,
    }));
  const suggestionItems = buildIntegrationSuggestions({
    orgId,
    connectors: connectorRows.map((row) => ({
      id: row.item.id,
      name: row.item.name,
      available: row.available,
      connected: row.connected,
      feedbackSource: isFeedbackSourceIntegration(row.item.id),
      state: row.item.state,
      lastSync: row.item.lastSync,
      filter: row.experience.filter,
      summary: row.experience.summary,
    })),
    recommendations: recommendedConnectors,
    pipedreamActivity,
  });
  const attentionSuggestionCount = suggestionItems.filter(
    (item) => item.section === "Suggested" || item.section === "Review",
  ).length;

  function updateConnectionState(
    integrationId: string,
    nextState: IntegrationConnectionState,
  ): void {
    setConnectionStates((previous) => ({
      ...previous,
      [integrationId]: nextState,
    }));
    setConnectedIds((previous) =>
      nextState === "Connected"
        ? previous.includes(integrationId)
          ? previous
          : [...previous, integrationId]
        : previous.filter((id) => id !== integrationId),
    );
    setIntegrationActivity((previous) => {
      if (!nextState) return previous;
      if (previous.some((activity) => activity.integrationId === integrationId)) {
        return previous.map((activity) =>
          activity.integrationId === integrationId
            ? { ...activity, state: nextState }
            : activity,
        );
      }
      return [
        ...previous,
        {
          integrationId,
          accountName: null,
          state: nextState,
          healthy: nextState === "Connected" ? true : null,
          lastImportAt: null,
          lastImportStatus: null,
          lastImportCount: 0,
        },
      ];
    });
  }

  function selectIntegrationView(nextView: "suggestions" | "connections") {
    setActiveView(nextView);
    const url = new URL(window.location.href);
    url.searchParams.set("view", nextView);
    if (nextView === "suggestions") url.searchParams.delete("focus");
    window.history.replaceState(window.history.state, "", url);
  }

  function handleViewTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
      return;
    event.preventDefault();
    const nextView =
      event.key === "ArrowRight" || event.key === "End"
        ? "connections"
        : "suggestions";
    selectIntegrationView(nextView);
    window.requestAnimationFrame(() =>
      (nextView === "suggestions"
        ? suggestionsTabRef.current
        : connectionsTabRef.current
      )?.focus(),
    );
  }

  async function createWebhook() {
    if (webhookBusy) return;
    setWebhookBusy(true);
    setWebhookError(null);
    try {
      const response = await fetch("/api/integrations/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-org-id": orgId,
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
      });
      const payload = (await response.json().catch(() => ({}))) as {
        webhookUrl?: unknown;
        signingSecret?: unknown;
      };
      if (
        !response.ok ||
        typeof payload.webhookUrl !== "string" ||
        typeof payload.signingSecret !== "string"
      ) {
        throw new Error("webhook_unavailable");
      }
      setWebhookCredentials({
        webhookUrl: payload.webhookUrl,
        signingSecret: payload.signingSecret,
      });
      updateConnectionState("int_webhook", "Connected");
    } catch {
      setWebhookError(
        "The webhook could not be created right now. Try again or connect another source.",
      );
    } finally {
      setWebhookBusy(false);
    }
  }

  async function copyWebhookValue(
    label: "url" | "secret",
    value: string,
  ) {
    await navigator.clipboard.writeText(value);
    setWebhookCopied(label);
    window.setTimeout(() => setWebhookCopied(null), 1500);
  }

  useEffect(() => {
    const card = focusedCardRef.current;
    if (!focusedIntegrationId || !card) return;

    const frame = window.requestAnimationFrame(() => {
      card.focus({ preventScroll: true });
      card.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "center",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedIntegrationId]);

  useEffect(() => {
    if (!selectedIntegrationId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedIntegrationId(null);
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedIntegrationId]);

  return (
    <>
      <PageTitle
        title="Integrations"
        description="Let Closespan recommend the next source, or manage every connection directly."
        action={
          <div
            className="integration-view-tabs"
            role="tablist"
            aria-label="Integration views"
          >
            <button
              id="integration-suggestions-tab"
              ref={suggestionsTabRef}
              type="button"
              role="tab"
              aria-selected={activeView === "suggestions"}
              aria-controls="integration-suggestions-panel"
              tabIndex={activeView === "suggestions" ? 0 : -1}
              className={activeView === "suggestions" ? "active" : ""}
              onClick={() => selectIntegrationView("suggestions")}
              onKeyDown={handleViewTabKeyDown}
            >
              <Sparkles size={15} aria-hidden="true" />
              Suggestions
              <span>{attentionSuggestionCount}</span>
            </button>
            <button
              id="integration-connections-tab"
              ref={connectionsTabRef}
              type="button"
              role="tab"
              aria-selected={activeView === "connections"}
              aria-controls="integration-connections-panel"
              tabIndex={activeView === "connections" ? 0 : -1}
              className={activeView === "connections" ? "active" : ""}
              onClick={() => selectIntegrationView("connections")}
              onKeyDown={handleViewTabKeyDown}
            >
              <Database size={15} aria-hidden="true" />
              Connections
              <span>{connectedIds.length}</span>
            </button>
          </div>
        }
      />
      {integrations.length === 0 ? (
        <EmptyWorkspaceState
          title="No integrations are configured"
          description="No connector has completed authorization and a health check. Review governance settings before enabling an approved ingestion path."
          actionHref="/settings"
          actionLabel="Review data policy"
        />
      ) : (
        <div className="integration-experience">
          <section
            id="integration-suggestions-panel"
            className="integration-suggestions-panel"
            role="tabpanel"
            aria-labelledby="integration-suggestions-tab"
            hidden={activeView !== "suggestions"}
          >
            <div className="integration-suggestions-agent">
              <IntegrationCopilot
                orgId={orgId}
                connectors={connectorRows.map((row) => ({
                  id: row.item.id,
                  name: row.item.name,
                  connected: row.connected,
                  available: row.available,
                  summary: row.experience.summary,
                  importedData: row.experience.importedData,
                  requestedPermissions: row.experience.requestedPermissions,
                }))}
                onInspect={setSelectedIntegrationId}
                onConnected={(integrationId) =>
                  updateConnectionState(integrationId, "Connected")
                }
                onConnectionProgressChange={(integrationId, state) =>
                  setConnectionProgress((previous) => ({
                    ...previous,
                    [integrationId]: state,
                  }))
                }
              />
            </div>
            <IntegrationSuggestionsView
              items={suggestionItems}
              productName={productName}
              onInspect={setSelectedIntegrationId}
            />
          </section>

          <section
            id="integration-connections-panel"
            className="integration-catalog-shell"
            role="tabpanel"
            aria-labelledby="integration-connections-tab"
            hidden={activeView !== "connections"}
          >
          <section className="integration-summary" aria-label="Integration health summary">
            <div className="integration-summary-card">
              <span><Database size={17} aria-hidden="true" /></span>
              <div><strong>{connectedFeedbackSources.length}</strong><small>Feedback sources</small></div>
            </div>
            <div className="integration-summary-card">
              <span><GitBranch size={17} aria-hidden="true" /></span>
              <div><strong>{connectedActionDestinations.length}</strong><small>Action destinations</small></div>
            </div>
            <div className="integration-summary-card">
              <span><Activity size={17} aria-hidden="true" /></span>
              <div>
                <strong>{reconnectCount > 0 ? `${reconnectCount} needs attention` : "Healthy"}</strong>
                <small>Synchronization health</small>
              </div>
            </div>
            <div className="integration-summary-card">
              <span><Clock3 size={17} aria-hidden="true" /></span>
              <div>
                <strong>{latestImport ? new Date(latestImport).toLocaleString() : "No imports yet"}</strong>
                <small>Last successful import</small>
              </div>
            </div>
          </section>

          <div className="integration-filterbar" aria-label="Filter integrations">
            {(["All", "Feedback", "Engineering", "Analytics", "Support"] as const).map((filter) => {
              const count = connectorRows.filter(
                (row) => filter === "All" || row.experience.filter === filter,
              ).length;
              return (
                <button
                  key={filter}
                  type="button"
                  className={activeFilter === filter ? "active" : ""}
                  aria-pressed={activeFilter === filter}
                  onClick={() => setActiveFilter(filter)}
                >
                  {filter}<span>{count}</span>
                </button>
              );
            })}
          </div>

          {(["Connected", "Recommended", "Coming soon"] as IntegrationGroup[]).map((group) => {
            const rows = visibleRows.filter((row) => row.group === group);
            if (rows.length === 0) return null;
            return (
              <section className="integration-group" key={group} aria-labelledby={`integration-group-${group.replace(" ", "-")}`}>
                <div className="integration-group-heading">
                  <div>
                    <h2 id={`integration-group-${group.replace(" ", "-")}`}>{group}</h2>
                    <p>{group === "Connected" ? "Active tools in this workspace." : group === "Recommended" ? "Available connectors selected for this workflow." : "More native connections planned for Closespan."}</p>
                  </div>
                  <span>{rows.length}</span>
                </div>
                <div className="integrations-grid">
                  {rows.map(({ item, connected, available, experience, observedConnectionState, demonstration }) => {
                    const focused = item.id === focusedIntegrationId;
                    const headingId = `integration-title-${item.id}`;
                    return (
                      <article
                        className={`card integration${focused ? " focused" : ""}`}
                        id={`integration-${item.id}`}
                        key={item.id}
                        ref={focused ? focusedCardRef : undefined}
                        tabIndex={focused ? -1 : undefined}
                        aria-labelledby={headingId}
                      >
                        <div className="split">
                          <IntegrationProviderIcon integrationId={item.id} className="provider-icon" />
                          <span className={`badge${connected ? " success" : ""}`}>
                            {connected ? "Connected" : available ? experience.filter : "Coming soon"}
                          </span>
                        </div>
                        <h3 id={headingId}>{item.name}</h3>
                        <p className="integration-card-summary">{experience.summary}</p>
                        <div className="integration-card-footer">
                          <span>
                            {connected && !isFeedbackSourceIntegration(item.id)
                              ? "Ready for approved actions"
                              : connected && item.lastSync
                                ? `Synced ${new Date(item.lastSync).toLocaleDateString()}`
                                : connected
                                  ? "Waiting for first import"
                                  : available
                                    ? "Ready to connect"
                                    : "Not yet available"}
                          </span>
                          <button className="btn" type="button" onClick={() => setSelectedIntegrationId(item.id)}>
                            {connected ? "View details" : available ? "Review & connect" : "View details"}
                          </button>
                        </div>
                        {connected && !demonstration && isPipedreamConnectorId(item.id) && isFeedbackSourceIntegration(item.id) && (
                          <IntegrationSyncStatus
                            orgId={orgId}
                            integrationId={item.id}
                            active
                            onConnectionStateChange={(nextState) =>
                              updateConnectionState(item.id, nextState)
                            }
                          />
                        )}
                        {observedConnectionState === "Needs reconnect" && (
                          <p className="integration-import failed"><AlertTriangle size={13} aria-hidden="true" />Reconnect required</p>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {visibleRows.length === 0 && <p className="integration-filter-empty">No connectors match this filter.</p>}
          </section>
        </div>
      )}

      {selectedRow && (
        <div className="integration-drawer-layer" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedIntegrationId(null);
        }}>
          <aside className="integration-drawer" role="dialog" aria-modal="true" aria-labelledby="integration-drawer-title">
            <div className="integration-drawer-head">
              <IntegrationProviderIcon integrationId={selectedRow.item.id} size={22} />
              <div><span>{selectedRow.experience.filter}</span><h2 id="integration-drawer-title">{selectedRow.connected ? selectedRow.item.name : `Connect ${selectedRow.item.name}`}</h2></div>
              <button type="button" className="icon-button" aria-label="Close connector details" autoFocus onClick={() => setSelectedIntegrationId(null)}><X size={18} /></button>
            </div>
            <p className="integration-drawer-summary">{selectedRow.experience.summary}</p>
            <section className="integration-drawer-section">
              <h3>Data Closespan will use</h3>
              <ul>{selectedRow.experience.importedData.map((value) => <li key={value}><Check size={14} aria-hidden="true" />{value}</li>)}</ul>
            </section>
            <section className="integration-drawer-section">
              <h3>Permissions requested</h3>
              <ul>{selectedRow.experience.requestedPermissions.map((value) => <li key={value}><ShieldCheck size={14} aria-hidden="true" />{value}</li>)}</ul>
              <p>Closespan requests least-privilege access. Agent actions still require your approval.</p>
            </section>
            {selectedRow.connected && selectedRow.item.permissions.length > 0 && (
              <section className="integration-drawer-section"><h3>Currently granted</h3><p>{selectedRow.item.permissions.join(", ")}</p></section>
            )}
            <div className="integration-drawer-actions">
              {selectedRow.demonstration ? (
                <div className="integration-demo-connection">
                  <span className="badge success">Demo connection</span>
                  <p>This presentation account is simulated; no OAuth credential or external request is used.</p>
                </div>
              ) : !selectedRow.available ? (
                <button className="btn" type="button" disabled>Coming soon</button>
              ) : isPipedreamConnectorId(selectedRow.item.id) ? (
                <PipedreamAccountManager
                  orgId={orgId}
                  integrationId={selectedRow.item.id}
                  onConnectionStateChange={(nextState) =>
                    updateConnectionState(selectedRow.item.id, nextState)
                  }
                  onImportComplete={(completedAt, processed) => {
                    setLastSyncOverrides((previous) => ({
                      ...previous,
                      [selectedRow.item.id]: completedAt,
                    }));
                    setIntegrationActivity((previous) => [
                      {
                        integrationId: selectedRow.item.id,
                        accountName: null,
                        state: "Connected",
                        healthy: true,
                        lastImportAt: completedAt,
                        lastImportStatus: "Succeeded",
                        lastImportCount: processed,
                      },
                      ...previous,
                    ]);
                  }}
                />
              ) : selectedRow.item.id === "int_webhook" && !selectedRow.connected ? (
                <button className="btn primary" type="button" disabled={webhookBusy} onClick={() => void createWebhook()}>{webhookBusy ? "Creating endpoint..." : "Create webhook"}</button>
              ) : (
                <span className="badge success">Connected</span>
              )}
              {webhookError && selectedRow.item.id === "int_webhook" && <p className="integration-import failed"><AlertTriangle size={13} />{webhookError}</p>}
            </div>
            {selectedRow.item.id === "int_webhook" && webhookCredentials && (
              <div className="setup-credentials integration-webhook-credentials">
                <label>Webhook URL</label><code className="credential-value">{webhookCredentials.webhookUrl}</code>
                <button type="button" className="btn" onClick={() => void copyWebhookValue("url", webhookCredentials.webhookUrl)}><Copy size={13} />{webhookCopied === "url" ? "Copied" : "Copy URL"}</button>
                <label>Signing secret (shown once)</label><code className="credential-value">{webhookCredentials.signingSecret}</code>
                <button type="button" className="btn" onClick={() => void copyWebhookValue("secret", webhookCredentials.signingSecret)}><Copy size={13} />{webhookCopied === "secret" ? "Copied" : "Copy secret"}</button>
              </div>
            )}
          </aside>
        </div>
      )}
      {simulated && (
        <div className="callout section-gap">
          <div className="callout-title">Simulation disclosure</div>
          <p className="subtle">
            These demonstration connector records are not live. No OAuth
            handshake, synchronization, or external request is performed.
          </p>
        </div>
      )}
    </>
  );
}

export function FollowUpScreen({
  initialState,
  problem,
  feedbackItems,
}: {
  initialState: DemoState | null;
  problem: ProductProblem | null;
  feedbackItems: FeedbackItem[];
}) {
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  if (!state || !problem) {
    return (
      <>
        <PageTitle
          title="Customer follow-up"
          description="Close the loop after a verified deployment, always with human approval."
        />
        <EmptyWorkspaceState
          title="No follow-up workflow exists"
          description="Customer drafts appear only after a real product problem has a reviewed workflow and a verified resolution."
          actionHref={problem ? `/problems/${problem.id}` : "/feedback"}
          actionLabel={problem ? "Review product problem" : "Open feedback inbox"}
        />
      </>
    );
  }
  const activeProblem = problem;
  const available =
    ["Verified", "Closed"].includes(state.problemStage) &&
    state.notifications !== "Not drafted";
  async function approveDrafts() {
    setBusy(true);
    try {
      setState(await workflowMutation("/api/workflow/notify", activeProblem.orgId));
      setNotice(
        "Customer drafts approved in the audited workflow; no external message was sent.",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }
  const affected = feedbackItems.filter(
    (item) => item.problemId === problem.id,
  );
  return (
    <>
      <PageTitle
        title="Customer follow-up"
        description="Close the loop after a verified deployment, always with human approval."
        action={
          <span className={`badge ${available ? "success" : ""}`}>
            {available ? "Verified resolution" : "Waiting for verification"}
          </span>
        }
      />
      {!available ? (
        <section className="card empty-state">
          <ShieldCheck size={28} />
          <h2>No drafts ready yet</h2>
          <p className="subtle">
            Move {problem.id} through Released and Verified before customer
            follow-up can be drafted.
          </p>
          <Link className="btn primary" href={`/problems/${problem.id}`}>
            Open product problem
          </Link>
        </section>
      ) : (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>{problem.title}</h2>
              <p className="subtle">
                Verified release · deployment evidence recorded
              </p>
            </div>
            <span className="badge brand">{affected.length} drafts</span>
          </div>
          <div className="card-body">
            {affected.map((customer) => (
              <article className="follow-card" key={customer.id}>
                <div className="split">
                  <div>
                    <strong>{customer.customer}</strong>
                    <p className="subtle">
                      Original conversation · {customer.source}
                    </p>
                  </div>
                  <span
                    className={`badge ${state.notifications === "Approved" ? "success" : ""}`}
                  >
                    {state.notifications === "Approved" ? "Approved" : "Draft"}
                  </span>
                </div>
                <p>
                  Hi {customer.customer}, we’ve resolved{" "}
                  {problem.title.toLowerCase()}. The verified fix is now
                  available.
                </p>
                <small>
                  No sensitive data included · simulated delivery only
                </small>
              </article>
            ))}
            <button
              type="button"
              className="btn primary"
              disabled={busy || state.notifications === "Approved"}
              onClick={approveDrafts}
            >
              {state.notifications === "Approved"
                ? "Drafts approved"
                : "Approve all drafts"}
            </button>
            {notice && (
              <p className="toast success" role="status">
                {notice}
              </p>
            )}
          </div>
        </section>
      )}
    </>
  );
}

export function CustomersScreen({ customers }: { customers: CustomerView[] }) {
  return (
    <>
      <PageTitle
        title="Customers"
        description="Business context connected to feedback, problems, and resolutions."
      />
      {customers.length === 0 ? (
        <EmptyWorkspaceState
          title="No customer accounts"
          description="This workspace has no customer or revenue records. Accounts appear only after an approved data source imports them."
          actionHref="/integrations"
          actionLabel="Review integrations"
        />
      ) : (
      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Tier</th>
              <th>ARR</th>
              <th>Signals</th>
              <th>Open problems</th>
              <th>Churn risk</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id}>
                <td>
                  <strong>{customer.name}</strong>
                  <small>Customer since {customer.customerSince}</small>
                </td>
                <td>
                  <span className="badge">{customer.tier}</span>
                </td>
                <td>{money(customer.arr)}</td>
                <td>{customer.signals}</td>
                <td>{customer.openProblems}</td>
                <td>
                  <span
                    className={`badge ${customer.churnRisk === "Elevated" ? "medium" : ""}`}
                  >
                    {customer.churnRisk}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      )}
    </>
  );
}

export function SettingsScreen({
  settings,
}: {
  settings: SettingsView;
}) {
  const [weights, setWeights] = useState<Record<string, number>>(
    settings.priorityWeights,
  );
  const [autonomy, setAutonomy] = useState(settings.autonomyLevel);
  const [pii, setPii] = useState(settings.piiRedaction);
  const [saved, setSaved] = useState(false);
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const labels: Record<string, string> = {
    frequency: "Frequency",
    severity: "Severity",
    revenue: "Revenue",
    churnRisk: "Churn risk",
    customerTier: "Customer tier",
    strategicAlignment: "Strategic alignment",
    sla: "SLA",
    engineeringEffort: "Effort",
  };
  return (
    <>
      <PageTitle
        title="Settings & governance"
        description="Define permissions, data controls, model policies, and spending boundaries."
        action={
          <button
            type="button"
            className="btn primary"
            disabled={total !== 100}
            onClick={() => setSaved(true)}
          >
            Save demo policy
          </button>
        }
      />
      {saved && (
        <p className="toast success" role="status">
          Policy draft saved for this browser session. Server-side policy
          mutation is the next connector boundary.
        </p>
      )}
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          <a className="active" href="#agent">
            Agent autonomy
          </a>
          <a href="#model">AI model</a>
          <a href="#priority">Prioritization</a>
          <a href="#data">Data & privacy</a>
          <a href="#members">Members & roles</a>
          <a href="#billing">Plan & billing</a>
          <a href="#usage">Usage limits</a>
        </nav>
        <div className="detail-stack">
          <section className="card" id="agent">
            <div className="card-head">
              <div>
                <h2>Agent autonomy</h2>
                <p className="subtle">Default policy for all agent workflows</p>
              </div>
            </div>
            <div className="card-body">
              <label className="field">
                Autonomy level
                <select
                  value={autonomy}
                  onChange={(event) => {
                    setAutonomy(event.target.value);
                    setSaved(false);
                  }}
                >
                  <option>Observe</option>
                  <option>Recommend</option>
                  <option>Organize</option>
                  <option>Execute with approval</option>
                  <option>Limited autonomy</option>
                </select>
              </label>
              <div className="callout section-gap-sm">
                <div className="callout-title">Protected actions</div>
                <p className="subtle">
                  Production code merges and deployments always require a human.
                  This cannot be overridden by workspace autonomy.
                </p>
              </div>
            </div>
          </section>
          <section className="card" id="model">
            <div className="card-head">
              <div>
                <h2>AI model</h2>
                <p className="subtle">
                  Server-only provider configuration and prompt provenance
                </p>
              </div>
              <span
                className={`badge ${settings.ai.configured ? "success" : "medium"}`}
              >
                {settings.ai.configured ? "Configured" : "Key required"}
              </span>
            </div>
            <div className="card-body">
              <div className="grid cols-3">
                <div>
                  <div className="metric-label">Provider</div>
                  <strong>{settings.ai.provider}</strong>
                </div>
                <div>
                  <div className="metric-label">Model</div>
                  <strong>{settings.ai.model}</strong>
                </div>
                <div>
                  <div className="metric-label">Prompt</div>
                  <strong>
                    Feedback intelligence {settings.ai.promptVersion}
                  </strong>
                </div>
              </div>
              <div
                className={`callout section-gap-sm ${settings.ai.configured ? "" : "warning"}`}
              >
                <div className="callout-title">
                  {settings.ai.configured
                    ? "Ready for governed analysis"
                    : "Add your xAI key"}
                </div>
                <p className="subtle">
                  {settings.ai.configured
                    ? "Grok calls use strict structured outputs, no tools, provider storage disabled, PII preprocessing, and review-only cluster recommendations."
                    : "Set XAI_API_KEY in .env.local, then restart the app. The key is read only by the server and is never returned to the browser."}
                </p>
              </div>
              {settings.ai.lastRunStatus && (
                <p className="subtle section-gap-sm">
                  Last model run: {settings.ai.lastRunStatus} ·{" "}
                  {settings.ai.lastRunAt
                    ? new Date(settings.ai.lastRunAt).toLocaleString()
                    : "time unavailable"}
                </p>
              )}
            </div>
          </section>
          <section className="card" id="priority">
            <div className="card-head">
              <h2>Prioritization weights</h2>
              <span className={`badge ${total === 100 ? "success" : "high"}`}>
                {total}% allocated
              </span>
            </div>
            <div className="card-body">
              {Object.entries(weights).map(([key, weight]) => (
                <label className="weight-row" key={key}>
                  <span>{labels[key] ?? key}</span>
                  <input
                    type="range"
                    min="0"
                    max="40"
                    value={weight}
                    onChange={(event) => {
                      setWeights((value) => ({
                        ...value,
                        [key]: Number(event.target.value),
                      }));
                      setSaved(false);
                    }}
                  />
                  <strong>{weight}%</strong>
                </label>
              ))}
            </div>
          </section>
          <section className="card" id="data">
            <div className="card-head">
              <h2>Data protection</h2>
            </div>
            <div className="card-body">
              <label className="toggle-row">
                <div>
                  <strong>PII redaction</strong>
                  <p className="subtle">
                    Redact sensitive values before model processing
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={pii}
                  onChange={(event) => {
                    setPii(event.target.checked);
                    setSaved(false);
                  }}
                />
              </label>
              <label className="field">
                Feedback retention
                <select defaultValue={`${settings.retentionDays} days`}>
                  <option>90 days</option>
                  <option>365 days</option>
                  <option>Custom policy</option>
                </select>
              </label>
            </div>
          </section>
          <section className="card" id="members">
            <div className="card-head">
              <h2>Members & roles</h2>
              <span className="badge">{settings.members.length} members</span>
            </div>
            <div className="card-body">
              {settings.members.map((member) => (
                <div className="rank-row" key={member.id}>
                  <div>
                    <strong>{member.name}</strong>
                    <p className="subtle">
                      {member.email} · {member.team}
                    </p>
                  </div>
                  <span
                    className={`badge ${member.role === "Admin" ? "brand" : ""}`}
                  >
                    {member.role}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section className="card" id="billing">
            <div className="card-head">
              <div>
                <h2>Plan & billing</h2>
                <p className="subtle">
                  Transparent sandbox boundary and early-access packaging
                </p>
              </div>
              <span className="badge brand">{settings.planName}</span>
            </div>
            <div className="card-body">
              <div className="split plan-summary">
                <div>
                  <div className="metric-label">Current price</div>
                  <strong>{settings.planPrice}</strong>
                  <p className="subtle">
                    Seeded workspace · no live customer data · no external
                    writes
                  </p>
                </div>
                <Link className="btn" href="/#pricing">
                  View early-access pricing
                </Link>
              </div>
              <div className="callout section-gap-sm">
                <div className="callout-title">No automatic upgrades</div>
                <p className="subtle">
                  {launchPricingNote} Production usage limits stop processing at
                  the configured cap instead of creating surprise charges.
                </p>
              </div>
            </div>
          </section>
          <section className="card" id="usage">
            <div className="card-head">
              <h2>Usage & cost limits</h2>
              <span className="badge success">Within policy</span>
            </div>
            <div className="card-body">
              <div className="grid cols-3">
                <div>
                  <div className="metric-label">Monthly model budget</div>
                  <strong>${settings.monthlyModelBudget}</strong>
                </div>
                <div>
                  <div className="metric-label">Used this month</div>
                  <strong>${settings.usedModelCost}</strong>
                </div>
                <div>
                  <div className="metric-label">Hard stop</div>
                  <strong>{settings.hardStop ? "Enabled" : "Disabled"}</strong>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export function GenericProblemScreen({
  problem,
}: {
  problem: OverviewAnalytics["problems"][number];
}) {
  return (
    <>
      <PageTitle
        eyebrow={`Product problem · ${problem.id.replace("prob_", "CS-").toUpperCase()}`}
        title={problem.title}
        description="Database-backed problem summary with explicit limited-evidence state."
        action={
          <span className={`badge ${problem.severity.toLowerCase()}`}>
            {problem.severity}
          </span>
        }
      />
      <div className="grid cols-3">
        <section className="card span-2">
          <div className="card-head">
            <h2>Available evidence</h2>
            <span className="badge brand">
              {problem.confidence}% confidence
            </span>
          </div>
          <div className="card-body">
            <p className="summary">
              This cluster has {problem.count} related signals representing{" "}
              {money(problem.revenue)} in affected ARR.
            </p>
            <div className="callout warning section-gap">
              <div className="callout-title">
                Investigation not yet prepared
              </div>
              <p className="subtle">
                Repository, ownership, and root-cause evidence have not been
                generated for this record. No engineering action can be approved
                yet.
              </p>
            </div>
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <h2>Lifecycle</h2>
          </div>
          <div className="card-body">
            <span className="badge brand">{problem.stage}</span>
            <p className="subtle section-gap-sm">
              Trend {formatTrend(problem.trend)} · {problem.count} signals
            </p>
            <Link className="btn full-width" href="/problems">
              Back to problems
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
