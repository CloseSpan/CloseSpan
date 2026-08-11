"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Activity,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Cloud,
  Copy,
  Database,
  Filter,
  GitBranch,
  Info,
  MonitorCheck,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { launchPricingNote } from "@/lib/plans";
import type { DemoState } from "@/lib/store";
import { FeedbackVolumeChart } from "./feedback-volume-chart";
import { FitText } from "./fit-text";
import { CustomSelect } from "./custom-select";
import {
  CUSTOM_RETENTION_OPTION,
  CustomRetentionInput,
  initialRetentionSelection,
  isValidCustomRetention,
} from "./custom-retention-input";
import { IntegrationSyncStatus } from "./integration-sync-status";
import { PipedreamAccountManager } from "./pipedream-account-manager";
import { IntegrationProviderIcon } from "./integration-provider-icon";
import { IntegrationCopilot } from "./integration-copilot";
import { IntegrationSuggestionsView } from "./integration-suggestions-view";
import {
  formatTrend,
  THEME_RANGE_OPTIONS,
  type OverviewAnalytics,
  type ThemeRange,
} from "@/lib/overview-analytics";
import {
  PROBLEM_TABLE_TRENDS,
  countActiveProblemTableFilterColumns,
  countActiveProblemTableFiltersByColumn,
  createEmptyProblemTableFilters,
  filterProblems,
  type ProblemTableFilterColumn,
  type ProblemTableFilters,
  type ProblemTableTrend,
} from "@/lib/problem-table-filters";
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
import type { PromptDraftReadiness } from "@/lib/automated-prompt-draft-repository";
import {
  buildIntegrationSuggestions,
  type IntegrationSuggestionPipedreamActivity,
} from "@/lib/integration-suggestions";
import type {
  CustomerView,
  IntegrationView,
  SettingsView,
} from "@/lib/workspace-repository";
import type { InvestigationWorkspaceItem } from "@/lib/investigation-repository";
import type { EngineeringWorkflowView } from "@/lib/engineering-workflow-repository";
import type { FinalExecutionApprovalView } from "@/lib/final-execution-repository";
import type {
  FeedbackType,
  FeedbackItem,
  ProductProblem,
} from "@/lib/domain";

const money = (value: number) => `$${Math.round(value / 1000)}k`;
const compactMoney = (value: number) =>
  value >= 1_000_000
    ? `$${(value / 1_000_000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}m`
    : money(value);
const prioritizationStages = [
  "Detected",
  "Needs review",
  "Approved",
  "Planned",
  "In progress",
  "Released",
  "Verified",
  "Closed",
] as const;
const problemViews = ["problems", "classification", "board"] as const;
type ProblemView = (typeof problemViews)[number];

const MODAL_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getModalFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" &&
      !element.closest("[aria-hidden='true']") &&
      (element.offsetWidth > 0 ||
        element.offsetHeight > 0 ||
        element.getClientRects().length > 0),
  );
}

function containModalFocus(
  event: KeyboardEvent,
  container: HTMLElement,
  onClose: () => void,
) {
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return;
  }
  if (event.key !== "Tab") return;

  const focusableElements = getModalFocusableElements(container);
  if (!focusableElements.length) {
    event.preventDefault();
    container.focus({ preventScroll: true });
    return;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];
  const activeElement = document.activeElement;
  const activeElementIsFocusable =
    activeElement instanceof HTMLElement &&
    focusableElements.includes(activeElement);
  if (
    event.shiftKey &&
    (activeElement === firstElement || !activeElementIsFocusable)
  ) {
    event.preventDefault();
    lastElement.focus();
  } else if (
    !event.shiftKey &&
    (activeElement === lastElement || !activeElementIsFocusable)
  ) {
    event.preventDefault();
    firstElement.focus();
  }
}

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
  const { metrics, problems } = analytics;
  const [themeRange, setThemeRange] = useState<ThemeRange>("7d");
  const themes = analytics.themeRanges?.[themeRange] ?? analytics.themes;
  const activeThemeRange = THEME_RANGE_OPTIONS.find(
    ({ value }) => value === themeRange,
  ) ?? THEME_RANGE_OPTIONS.find(({ value }) => value === "30d")!;
  const currentThemePeriod =
    activeThemeRange.value === "7d"
      ? "the last week"
      : `the last ${activeThemeRange.label}`;
  const previousThemePeriod =
    activeThemeRange.value === "7d"
      ? "the preceding week"
      : `the preceding ${activeThemeRange.label}`;
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
        <div className="overview-themes-slot">
          <section className="card overview-themes-card">
            <div className="card-head overview-themes-head">
              <div className="overview-themes-title-row">
                <div className="overview-themes-heading">
                  <h2>{themeRange === "6m" ? "Theme trends" : "Emerging themes"}</h2>
                  <span className="overview-themes-ai-note">
                    AI grouped
                  </span>
                </div>
                <CustomSelect
                  className="overview-theme-range-filter"
                  ariaLabel="Filter themes by comparison period"
                  leadingIcon={<Filter aria-hidden="true" size={15} />}
                  value={themeRange}
                  onValueChange={(value) => setThemeRange(value as ThemeRange)}
                  options={THEME_RANGE_OPTIONS}
                />
              </div>
            </div>
            <div
              className="card-body overview-themes-scroll"
              data-empty={themes.length === 0 ? "true" : "false"}
              role="region"
              aria-label={`${themeRange === "6m" ? "Theme trends" : "Emerging themes"} for ${currentThemePeriod}`}
              aria-live="polite"
              tabIndex={themes.length > 4 ? 0 : undefined}
            >
              {themes.length ? (
                themes.map((theme) => (
                  <div className="rank-row" key={theme.name}>
                    <div>
                      <strong>{theme.name}</strong>
                      <p className="subtle">{theme.currentSignals} signals</p>
                    </div>
                    <span
                      className="badge"
                      title={`${theme.currentSignals} signals in ${currentThemePeriod} versus ${theme.previousSignals} in ${previousThemePeriod}`}
                    >
                      {formatTrend(theme.trend)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="overview-themes-empty" role="status">
                  <strong>No themes in {currentThemePeriod}</strong>
                  <p className="subtle">
                    Reviewed feedback has not added signals to a grouped theme
                    during this period.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
      <section className="card section-gap overview-attention-card">
        <div className="card-head">
          <div>
            <h2>Needs attention</h2>
            <p className="subtle">The most important exceptions to review today.</p>
          </div>
          <Link href="/problems" className="btn">
            Open problem inventory
          </Link>
        </div>
        <div className="overview-attention-list">
          {problems.length ? [...problems]
            .sort((left, right) => {
              const reviewDelta =
                Number(right.stage === "Needs review") -
                Number(left.stage === "Needs review");
              if (reviewDelta) return reviewDelta;
              const severityWeight = (severity: string) =>
                severity === "Critical" ? 4 : severity === "High" ? 3 : severity === "Medium" ? 2 : 1;
              return (
                severityWeight(right.severity) - severityWeight(left.severity) ||
                right.revenue - left.revenue
              );
            })
            .slice(0, 4)
            .map((problem) => {
              const action =
                problem.stage === "Needs review"
                  ? "Review cluster"
                  : problem.confidence < 80
                    ? "Check evidence"
                    : "Open problem";
              return (
                <Link
                  className="overview-attention-row"
                  href={`/problems/${problem.id}`}
                  key={problem.id}
                >
                  <span className={`overview-attention-signal ${problem.severity.toLowerCase()}`} aria-hidden="true" />
                  <span className="overview-attention-copy">
                    <strong>{problem.title}</strong>
                    <small>
                      {problem.stage} · {problem.count} {problem.count === 1 ? "signal" : "signals"} · {compactMoney(problem.revenue)} ARR
                    </small>
                  </span>
                  <span className={`badge ${problem.severity.toLowerCase()}`}>{problem.severity}</span>
                  <span className="overview-attention-action">
                    {action} <ChevronRight size={14} aria-hidden="true" />
                  </span>
                </Link>
              );
            }) : (
              <div className="overview-attention-empty" role="status">
                <strong>No problem exceptions</strong>
                <p>Reviewed feedback has not produced a problem that needs attention.</p>
              </div>
            )}
        </div>
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
  connectedPullSources = [],
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
}) {
  const reduceMotion = useReducedMotion();
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
  const [selectedPullSource, setSelectedPullSource] = useState("__all__");
  const [analyses, setAnalyses] =
    useState<FeedbackAnalysisView[]>(initialAnalyses);
  const [reviewProblemByFeedback, setReviewProblemByFeedback] = useState<
    Record<string, string>
  >({});
  const [reviewedProblems, setReviewedProblems] = useState<
    Record<string, { id: string; title: string; stage: string }>
  >({});
  const feedbackDrawerRef = useRef<HTMLElement | null>(null);
  const feedbackDrawerCloseRef = useRef<HTMLButtonElement | null>(null);
  const feedbackDrawerTriggerRef = useRef<HTMLElement | null>(null);
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
  const feedbackDrawerOpen = Boolean(openFeedback);
  useEffect(() => {
    if (!feedbackDrawerOpen) return;
    const drawer = feedbackDrawerRef.current;
    if (!drawer) return;
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = feedbackDrawerTriggerRef.current;
    const focusFrame = window.requestAnimationFrame(() => {
      (feedbackDrawerCloseRef.current ?? getModalFocusableElements(drawer)[0] ?? drawer).focus({
        preventScroll: true,
      });
    });
    const handleDrawerKeyDown = (event: KeyboardEvent) => {
      containModalFocus(event, drawer, () => setOpenFeedbackId(null));
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleDrawerKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleDrawerKeyDown);
      if (previouslyFocused?.isConnected) {
        window.requestAnimationFrame(() => {
          previouslyFocused.focus({ preventScroll: true });
        });
      }
    };
  }, [feedbackDrawerOpen]);
  function openFeedbackDetails(feedbackId: string) {
    if (!openFeedbackId) {
      feedbackDrawerTriggerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    setOpenFeedbackId(feedbackId);
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
            ? `${payload.createdProblem ? "Created" : "Linked"} product problem “${payload.problem?.title ?? "Needs review"}”.${payload.investigation ? " Its investigation is ready for review." : " The workflow will continue automatically."}`
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
          title="Unified feedback inbox"
          description="Review normalized customer signals across every connected source."
          action={pullControls(true)}
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
          {pullControls()}
          <button type="button" className="btn primary feedback-analyze-button" disabled={!selected.length || busy} onClick={() => void classify()}>
            <Sparkles size={14} /> {busy ? "Analyzing…" : `Analyze with ${providerLabel} ${selected.length || ""}`}
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
            placeholder="Search customer feedback…"
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
        <button
          type="button"
          className="btn"
          aria-expanded={advanced}
          aria-controls="feedback-advanced-filters"
          onClick={() => setAdvanced((value) => !value)}
        >
          <Filter size={14} /> More filters
        </button>
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
          <caption className="sr-only">Customer feedback signals</caption>
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
                    <label className="feedback-select-control">
                      <input
                        type="checkbox"
                        checked={selected.includes(item.id)}
                        onChange={() => toggle(item.id)}
                        aria-label={`Select feedback from ${item.customer}`}
                      />
                    </label>
                  </td>
                  <td>
                    <div className="feedback-signal-heading">
                      <strong>{item.customer}</strong>
                      <button
                        type="button"
                        className="feedback-expand-button"
                        aria-expanded={openFeedbackId === item.id}
                        aria-controls={`feedback-detail-${item.id}`}
                        onClick={() => openFeedbackDetails(item.id)}
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
      <AnimatePresence initial={false}>
      {openFeedback && (
        <motion.div
          key={openFeedback.id}
          className="feedback-drawer-layer"
          role="presentation"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setOpenFeedbackId(null);
          }}
        >
          <motion.aside
            ref={feedbackDrawerRef}
            className="feedback-drawer"
            id={`feedback-detail-${openFeedback.id}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-detail-title"
            tabIndex={-1}
            initial={reduceMotion ? false : { x: 28, opacity: 0.72 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 28, opacity: 0.72 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
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
                ref={feedbackDrawerCloseRef}
                type="button"
                className="icon-button"
                aria-label="Close feedback details"
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
                        { value: "__new__", label: "Create a new product problem" },
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
          </motion.aside>
        </motion.div>
      )}
      </AnimatePresence>
    </>
  );
}

function RevenueCell({
  problemId,
  problemTitle,
  revenue,
  accounts,
}: {
  problemId: string;
  problemTitle: string;
  revenue: number;
  accounts: OverviewAnalytics["problems"][number]["accounts"];
}) {
  const breakdownId = `revenue-breakdown-${problemId}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;

      const triggerRect = trigger.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const viewportGutter = 12;
      const popoverGap = 8;
      const centeredLeft =
        triggerRect.left + triggerRect.width / 2 - panelRect.width / 2;
      const left = Math.min(
        Math.max(viewportGutter, centeredLeft),
        window.innerWidth - panelRect.width - viewportGutter,
      );
      const below = triggerRect.bottom + popoverGap;
      const top =
        below + panelRect.height <= window.innerHeight - viewportGutter
          ? below
          : Math.max(
              viewportGutter,
              triggerRect.top - panelRect.height - popoverGap,
            );

      setPosition({ left, top });
    };

    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    updatePosition();
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [accounts.length, open]);

  return (
    <div className="revenue-with-info">
      {money(revenue)}
      {accounts.length > 0 && (
        <div className="revenue-popover">
          <button
            ref={triggerRef}
            type="button"
            className="revenue-info"
            aria-label={`${open ? "Hide" : "Show"} affected account revenue breakdown for ${problemTitle}`}
            aria-controls={breakdownId}
            aria-expanded={open}
            aria-haspopup="dialog"
            onClick={() => setOpen((current) => !current)}
          >
            <Info size={13} aria-hidden="true" />
          </button>
          {open &&
            typeof document !== "undefined" &&
            createPortal(
              <div
                ref={panelRef}
                className="revenue-breakdown revenue-breakdown-popover"
                id={breakdownId}
                role="dialog"
                aria-label={`Affected account revenue for ${problemTitle}`}
                style={{
                  left: position?.left ?? 0,
                  top: position?.top ?? 0,
                  visibility: position ? "visible" : "hidden",
                }}
              >
                <strong>Affected account ARR</strong>
                {accounts.map((account) => (
                  <div key={account.accountId}>
                    {account.accountName} <b>{money(account.arr)}</b>
                  </div>
                ))}
                <div className="revenue-total">
                  Total <b>{money(revenue)}</b>
                </div>
              </div>,
              document.body,
            )}
        </div>
      )}
    </div>
  );
}

const PROBLEM_FILTER_LABELS: Record<ProblemTableFilterColumn, string> = {
  title: "Product problem",
  signals: "Signals",
  revenue: "Revenue",
  severity: "Severity",
  trend: "Trend",
  confidence: "Confidence",
  stage: "Stage",
};

const PROBLEM_TREND_LABELS: Record<ProblemTableTrend, string> = {
  new: "New",
  rising: "Rising",
  flat: "Flat",
  falling: "Falling",
};

const PREFERRED_SEVERITY_ORDER = ["Critical", "High", "Medium", "Low"];
const PREFERRED_STAGE_ORDER = [
  "Detected",
  "Needs review",
  "Approved",
  "Planned",
  "In progress",
  "Released",
  "Verified",
  "Closed",
];

function orderedProblemFilterValues(
  values: string[],
  preferredOrder: string[],
): string[] {
  const uniqueValues = Array.from(new Set(values));
  const knownValues = preferredOrder.filter((value) =>
    uniqueValues.includes(value),
  );
  const customValues = uniqueValues
    .filter((value) => !preferredOrder.includes(value))
    .sort((left, right) => left.localeCompare(right));
  return [...knownValues, ...customValues];
}

function toggleProblemFilterValue<T extends string>(
  values: readonly T[],
  value: T,
): T[] {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}

function clearProblemFilterColumn(
  filters: ProblemTableFilters,
  column: ProblemTableFilterColumn,
): ProblemTableFilters {
  switch (column) {
    case "title":
      return { ...filters, title: "" };
    case "signals":
      return { ...filters, signalsMin: "", signalsMax: "" };
    case "revenue":
      return { ...filters, revenueMin: "", revenueMax: "" };
    case "severity":
      return { ...filters, severities: [] };
    case "trend":
      return { ...filters, trends: [] };
    case "confidence":
      return { ...filters, confidenceMin: "", confidenceMax: "" };
    case "stage":
      return { ...filters, stages: [] };
  }
}

function ProblemColumnFilterPopover({
  column,
  filters,
  filterCount,
  severityOptions,
  stageOptions,
  dialogId,
  position,
  panelRef,
  onFiltersChange,
  onClear,
  onClose,
}: {
  column: ProblemTableFilterColumn;
  filters: ProblemTableFilters;
  filterCount: number;
  severityOptions: string[];
  stageOptions: string[];
  dialogId: string;
  position: { left: number; top: number; maxHeight: number } | null;
  panelRef: React.RefObject<HTMLDivElement | null>;
  onFiltersChange: (filters: ProblemTableFilters) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const headingId = `${dialogId}-heading`;
  const label = PROBLEM_FILTER_LABELS[column];
  const numberValue = (value: ProblemTableFilters["signalsMin"]) =>
    value === null || value === undefined ? "" : String(value);

  return (
    <div
      ref={panelRef}
      id={dialogId}
      className="problem-column-filter-popover"
      role="dialog"
      aria-modal="false"
      aria-labelledby={headingId}
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        maxHeight: position ? `${position.maxHeight}px` : undefined,
        visibility: position ? "visible" : "hidden",
      }}
    >
      <div className="problem-column-filter-popover-head">
        <div>
          <span>Filter column</span>
          <strong id={headingId}>{label}</strong>
        </div>
        <button
          type="button"
          className="problem-column-filter-close"
          aria-label={`Close ${label} filter`}
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="problem-column-filter-popover-body">
        {column === "title" && (
          <label className="problem-column-filter-field">
            <span>Problem contains</span>
            <input
              data-autofocus="true"
              type="search"
              value={filters.title}
              placeholder="Search problem titles"
              onChange={(event) =>
                onFiltersChange({ ...filters, title: event.target.value })
              }
            />
          </label>
        )}

        {column === "signals" && (
          <div className="problem-column-filter-range">
            <label className="problem-column-filter-field">
              <span>Minimum signals</span>
              <input
                data-autofocus="true"
                type="number"
                min="0"
                inputMode="numeric"
                value={numberValue(filters.signalsMin)}
                placeholder="0"
                onChange={(event) =>
                  onFiltersChange({
                    ...filters,
                    signalsMin: event.target.value,
                  })
                }
              />
            </label>
            <label className="problem-column-filter-field">
              <span>Maximum signals</span>
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={numberValue(filters.signalsMax)}
                placeholder="Any"
                onChange={(event) =>
                  onFiltersChange({
                    ...filters,
                    signalsMax: event.target.value,
                  })
                }
              />
            </label>
          </div>
        )}

        {column === "revenue" && (
          <div className="problem-column-filter-range">
            <label className="problem-column-filter-field">
              <span>Minimum ARR ($k)</span>
              <input
                data-autofocus="true"
                type="number"
                min="0"
                inputMode="decimal"
                value={numberValue(filters.revenueMin)}
                placeholder="0"
                onChange={(event) =>
                  onFiltersChange({
                    ...filters,
                    revenueMin: event.target.value,
                  })
                }
              />
            </label>
            <label className="problem-column-filter-field">
              <span>Maximum ARR ($k)</span>
              <input
                type="number"
                min="0"
                inputMode="decimal"
                value={numberValue(filters.revenueMax)}
                placeholder="Any"
                onChange={(event) =>
                  onFiltersChange({
                    ...filters,
                    revenueMax: event.target.value,
                  })
                }
              />
            </label>
          </div>
        )}

        {column === "severity" && (
          <fieldset className="problem-column-filter-options">
            <legend>Include severity</legend>
            {severityOptions.map((severity, index) => (
              <label key={severity}>
                <input
                  data-autofocus={index === 0 ? "true" : undefined}
                  type="checkbox"
                  checked={filters.severities.includes(severity)}
                  onChange={() =>
                    onFiltersChange({
                      ...filters,
                      severities: toggleProblemFilterValue(
                        filters.severities,
                        severity,
                      ),
                    })
                  }
                />
                <span>{severity}</span>
              </label>
            ))}
          </fieldset>
        )}

        {column === "trend" && (
          <fieldset className="problem-column-filter-options">
            <legend>Include trend</legend>
            {PROBLEM_TABLE_TRENDS.map((trend, index) => (
              <label key={trend}>
                <input
                  data-autofocus={index === 0 ? "true" : undefined}
                  type="checkbox"
                  checked={filters.trends.includes(trend)}
                  onChange={() =>
                    onFiltersChange({
                      ...filters,
                      trends: toggleProblemFilterValue(filters.trends, trend),
                    })
                  }
                />
                <span>{PROBLEM_TREND_LABELS[trend]}</span>
              </label>
            ))}
          </fieldset>
        )}

        {column === "confidence" && (
          <div className="problem-column-filter-range">
            <label className="problem-column-filter-field">
              <span>Minimum confidence</span>
              <div className="problem-column-filter-affix">
                <input
                  data-autofocus="true"
                  type="number"
                  min="0"
                  max="100"
                  inputMode="numeric"
                  value={numberValue(filters.confidenceMin)}
                  placeholder="0"
                  onChange={(event) =>
                    onFiltersChange({
                      ...filters,
                      confidenceMin: event.target.value,
                    })
                  }
                />
                <span aria-hidden="true">%</span>
              </div>
            </label>
            <label className="problem-column-filter-field">
              <span>Maximum confidence</span>
              <div className="problem-column-filter-affix">
                <input
                  type="number"
                  min="0"
                  max="100"
                  inputMode="numeric"
                  value={numberValue(filters.confidenceMax)}
                  placeholder="100"
                  onChange={(event) =>
                    onFiltersChange({
                      ...filters,
                      confidenceMax: event.target.value,
                    })
                  }
                />
                <span aria-hidden="true">%</span>
              </div>
            </label>
          </div>
        )}

        {column === "stage" && (
          <fieldset className="problem-column-filter-options">
            <legend>Include stage</legend>
            {stageOptions.map((stage, index) => (
              <label key={stage}>
                <input
                  data-autofocus={index === 0 ? "true" : undefined}
                  type="checkbox"
                  checked={filters.stages.includes(stage)}
                  onChange={() =>
                    onFiltersChange({
                      ...filters,
                      stages: toggleProblemFilterValue(filters.stages, stage),
                    })
                  }
                />
                <span>{stage}</span>
              </label>
            ))}
          </fieldset>
        )}
      </div>

      <div className="problem-column-filter-popover-actions">
        <button
          type="button"
          className="problem-column-filter-clear"
          disabled={filterCount === 0}
          onClick={onClear}
        >
          Clear this filter
        </button>
        <button
          type="button"
          className="problem-column-filter-done"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>
  );
}

function ProblemTable({
  problems,
  view,
}: {
  problems: OverviewAnalytics["problems"];
  view: "problems" | "classification";
}) {
  const filterIdPrefix = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<
    Partial<Record<ProblemTableFilterColumn, HTMLButtonElement | null>>
  >({});
  const [filters, setFilters] = useState<ProblemTableFilters>(() =>
    createEmptyProblemTableFilters(),
  );
  const [openFilter, setOpenFilter] =
    useState<ProblemTableFilterColumn | null>(null);
  const [filterPosition, setFilterPosition] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);
  const isClassification = view === "classification";
  const filteredProblems = useMemo(
    () => (isClassification ? problems : filterProblems(problems, filters)),
    [filters, isClassification, problems],
  );
  const filterCounts = useMemo(
    () => countActiveProblemTableFiltersByColumn(filters),
    [filters],
  );
  const activeFilterColumns = useMemo(
    () => countActiveProblemTableFilterColumns(filters),
    [filters],
  );
  const severityOptions = useMemo(
    () =>
      orderedProblemFilterValues(
        [
          ...problems.map((problem) => problem.severity),
          ...filters.severities,
        ],
        PREFERRED_SEVERITY_ORDER,
      ),
    [filters.severities, problems],
  );
  const stageOptions = useMemo(
    () =>
      orderedProblemFilterValues(
        [...problems.map((problem) => problem.stage), ...filters.stages],
        PREFERRED_STAGE_ORDER,
      ),
    [filters.stages, problems],
  );

  useLayoutEffect(() => {
    if (!openFilter) return;

    const updatePosition = () => {
      const trigger = triggerRefs.current[openFilter];
      const panel = panelRef.current;
      if (!trigger || !panel) return;

      const triggerRect = trigger.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const visualViewport = window.visualViewport;
      const viewportLeft = visualViewport?.offsetLeft ?? 0;
      const viewportTop = visualViewport?.offsetTop ?? 0;
      const viewportWidth = visualViewport?.width ?? window.innerWidth;
      const viewportHeight = visualViewport?.height ?? window.innerHeight;
      const viewportRight = viewportLeft + viewportWidth;
      const viewportBottom = viewportTop + viewportHeight;
      const viewportGutter = 12;
      const popoverGap = 8;
      const maxHeight = Math.max(0, viewportHeight - viewportGutter * 2);
      const visiblePanelHeight = Math.min(panelRect.height, maxHeight);
      const preferredLeft = triggerRect.left;
      const left = Math.min(
        Math.max(viewportLeft + viewportGutter, preferredLeft),
        viewportRight - panelRect.width - viewportGutter,
      );
      const below = triggerRect.bottom + popoverGap;
      const top =
        below + visiblePanelHeight <= viewportBottom - viewportGutter
          ? below
          : Math.max(
              viewportTop + viewportGutter,
              triggerRect.top - visiblePanelHeight - popoverGap,
            );

      setFilterPosition({ left, top, maxHeight });
    };

    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !triggerRefs.current[openFilter]?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpenFilter(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenFilter(null);
        triggerRefs.current[openFilter]?.focus();
      }
    };

    updatePosition();
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [openFilter]);

  useEffect(() => {
    if (!openFilter) return;
    const frame = window.requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLElement>("[data-autofocus='true']")
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [openFilter]);

  if (problems.length === 0) {
    return (
      <div className="empty">
        <strong>No product problems</strong>
        <p>Reviewed problem clusters will appear here.</p>
      </div>
    );
  }

  const closeOpenFilter = () => {
    const trigger = openFilter ? triggerRefs.current[openFilter] : null;
    setOpenFilter(null);
    window.requestAnimationFrame(() => trigger?.focus());
  };
  const clearAllFilters = () =>
    setFilters(createEmptyProblemTableFilters());
  const dialogId = openFilter
    ? `${filterIdPrefix}-problem-filter-${openFilter}`
    : "";
  const renderFilterHeader = (
    column: ProblemTableFilterColumn,
    label = PROBLEM_FILTER_LABELS[column],
  ) => {
    const count = filterCounts[column];
    const isOpen = openFilter === column;
    return (
      <th scope="col">
        <button
          ref={(node) => {
            triggerRefs.current[column] = node;
          }}
          type="button"
          className="problem-column-filter-trigger"
          data-active={count > 0 ? "true" : undefined}
          aria-label={`Filter by ${label}${count > 0 ? `, ${count} active` : ""}`}
          aria-controls={`${filterIdPrefix}-problem-filter-${column}`}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          onClick={() => {
            setFilterPosition(null);
            setOpenFilter((current) =>
              current === column ? null : column,
            );
          }}
        >
          <span>{label}</span>
          <Filter size={13} aria-hidden="true" />
          {count > 0 && (
            <span className="problem-column-filter-count" aria-hidden="true">
              {count}
            </span>
          )}
        </button>
      </th>
    );
  };

  return (
    <div className="problem-table-region">
      {!isClassification && activeFilterColumns > 0 && (
        <div className="problem-table-filter-summary" role="status" aria-live="polite">
          <span>
            Showing <strong>{filteredProblems.length}</strong> of {problems.length}
            {" "}problems · {activeFilterColumns} filtered {activeFilterColumns === 1 ? "column" : "columns"}
          </span>
          <button type="button" onClick={clearAllFilters}>
            Clear all
          </button>
        </div>
      )}
      <div className="table-wrap problem-table-wrap">
        <table className="problem-table">
          <caption className="sr-only">
            {isClassification
              ? "Product problem classification"
              : "Product problem prioritization metrics"}
          </caption>
          <thead>
            <tr>
              {isClassification ? (
                <th scope="col">Product problem</th>
              ) : (
                renderFilterHeader("title")
              )}
              {isClassification ? (
                <>
                  <th scope="col">Product area</th>
                  <th scope="col">Feedback type</th>
                  <th scope="col">Severity</th>
                  <th scope="col">Confidence</th>
                </>
              ) : (
                <>
                  {renderFilterHeader("signals")}
                  {renderFilterHeader("revenue")}
                  {renderFilterHeader("severity")}
                  {renderFilterHeader("trend")}
                  {renderFilterHeader("confidence")}
                  {renderFilterHeader("stage")}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {filteredProblems.length > 0 ? (
              filteredProblems.map((problem) => (
                <tr key={problem.id}>
                  <td>
                    <Link className="row-link" href={`/problems/${problem.id}`}>
                      <FitText as="strong" minFontSize={11} maxLines={2}>
                        {problem.title}
                      </FitText>
                    </Link>
                  </td>
                  {isClassification ? (
                    <>
                      <td><span className="problem-taxonomy">{problem.productArea}</span></td>
                      <td><span className="problem-taxonomy">{problem.type}</span></td>
                      <td>
                        <span className={`badge ${problem.severity.toLowerCase()}`}>
                          {problem.severity}
                        </span>
                      </td>
                      <td>{problem.confidence}%</td>
                    </>
                  ) : (
                    <>
                      <td>{problem.count}</td>
                      <td>
                        <RevenueCell
                          problemId={problem.id}
                          problemTitle={problem.title}
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
                    </>
                  )}
                </tr>
              ))
            ) : (
              <tr>
                <td className="problem-table-filter-empty-cell" colSpan={7}>
                  <div className="problem-table-filter-empty">
                    <strong>No problems match these filters</strong>
                    <p>Adjust a column filter or clear them to show the ranked list.</p>
                    <button type="button" onClick={clearAllFilters}>
                      Clear all filters
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!isClassification &&
        openFilter &&
        typeof document !== "undefined" &&
        createPortal(
          <ProblemColumnFilterPopover
            column={openFilter}
            filters={filters}
            filterCount={filterCounts[openFilter]}
            severityOptions={severityOptions}
            stageOptions={stageOptions}
            dialogId={dialogId}
            position={filterPosition}
            panelRef={panelRef}
            onFiltersChange={setFilters}
            onClear={() =>
              setFilters((current) =>
                clearProblemFilterColumn(current, openFilter),
              )
            }
            onClose={closeOpenFilter}
          />,
          document.body,
        )}
    </div>
  );
}

function ProblemLifecycleBoard({
  problems,
}: {
  problems: OverviewAnalytics["problems"];
}) {
  return (
    <div className="board" aria-label="Problems by lifecycle stage">
      {prioritizationStages.map((stage) => {
        const stageProblems = problems.filter(
          (problem) => problem.stage === stage,
        );
        return (
          <section className="board-col" key={stage}>
            <div className="board-head">
              <div>
                <strong>{stage === "Approved" ? "Approval" : stage}</strong>
                <small>
                  {stage === "Approved" ? "Human decision" : "Agent managed"}
                </small>
              </div>
              <span>{stageProblems.length}</span>
            </div>
            {stageProblems.length === 0 ? (
              <p className="problem-board-empty">No problems</p>
            ) : (
              stageProblems.map((problem) => (
                <Link
                  className="problem-card"
                  href={`/problems/${problem.id}`}
                  key={problem.id}
                >
                  <div className="ticket-badges">
                    <span className="badge">{problem.type}</span>
                    <span
                      className={`badge ${problem.severity.toLowerCase()}`}
                    >
                      {problem.severity}
                    </span>
                  </div>
                  <h3>{problem.title}</h3>
                  <p className="subtle">
                    {problem.count} {problem.count === 1 ? "signal" : "signals"}
                    {" · "}
                    {money(problem.revenue)} ARR
                  </p>
                  <div className="mini-bar" aria-hidden="true">
                    <span style={{ width: `${problem.confidence}%` }} />
                  </div>
                  <small>{problem.confidence}% evidence confidence</small>
                </Link>
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}

export function ProblemsScreen({ analytics }: { analytics: OverviewAnalytics }) {
  const reduceMotion = useReducedMotion();
  const [tableView, setTableView] = useState<ProblemView>("problems");
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
    if (view === "problems") return "Inventory";
    if (view === "classification") return "Classification";
    return "Board";
  };

  return (
    <>
      <PageTitle
        title="Product problems"
        description="Persistent clusters that connect repeated feedback to business and engineering context."
        action={
          reviewProblem ? (
            <Link
              className="btn"
              href={`/problems/${reviewProblem.id}#evidence`}
            >
              <Sparkles size={14} /> Review clustering suggestion
            </Link>
          ) : undefined
        }
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
            <div className="card-head problem-table-head">
              <div>
                <h2>
                  {tableView === "board"
                    ? "Problem workflow"
                    : "Problem inventory"}
                </h2>
                <p>
                  {tableView === "problems"
                    ? "Decision metrics for each persistent problem."
                    : tableView === "classification"
                      ? "Product area and feedback taxonomy for each problem."
                      : "Lifecycle status from detection through verification and closure."}
                </p>
              </div>
              <div
                className="problem-view-tabs"
                data-view={tableView}
                role="tablist"
                aria-label="Product problem view"
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
            </div>
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
                {tableView === "board" ? (
                  <div className="problem-board-panel">
                    <ProblemLifecycleBoard problems={analytics.problems} />
                  </div>
                ) : (
                  <ProblemTable
                    problems={analytics.problems}
                    view={tableView}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </section>
        </>
      )}
    </>
  );
}

export function PrioritizationScreen({
  analytics,
}: {
  analytics: OverviewAnalytics;
}) {
  const [typeFilter, setTypeFilter] = useState<"All" | FeedbackType>("All");
  const allRows = analytics.problems;
  const rows =
    typeFilter === "All"
      ? allRows
      : allRows.filter((problem) => problem.type === typeFilter);

  return (
    <>
      <PageTitle
        title="Prioritization"
        description="Decide what to solve next using visible customer and business impact."
        action={
          <CustomSelect
            className="prioritization-type-filter"
            ariaLabel="Filter prioritization by type"
            leadingIcon={<Filter aria-hidden="true" size={14} />}
            value={typeFilter}
            onValueChange={(value) =>
              setTypeFilter(value as "All" | FeedbackType)
            }
            options={[
              { value: "All", label: "All types" },
              { value: "Bug", label: "Bugs" },
              { value: "Feature request", label: "Features" },
              { value: "Usability", label: "Usability" },
              { value: "Incident", label: "Incidents" },
              { value: "Question", label: "Questions" },
            ]}
          />
        }
      />
      {allRows.length === 0 ? (
        <EmptyWorkspaceState
          title="Nothing to prioritize"
          description="The decision queue is empty because this workspace has no product problems."
          actionHref="/feedback"
          actionLabel="Review feedback"
        />
      ) : (
        <>
          <div className="prioritization-summary" role="status">
            <div>
              <span>Decision queue</span>
              <strong>{rows.length}</strong>
              <small>
                {typeFilter === "All"
                  ? "ranked problems"
                  : `${typeFilter.toLowerCase()} problems`}
              </small>
            </div>
            <div>
              <span>Revenue represented</span>
              <strong>
                {compactMoney(
                  rows.reduce(
                    (total, problem) => total + problem.revenue,
                    0,
                  ),
                )}
              </strong>
              <small>customer ARR connected to this queue</small>
            </div>
            <div>
              <span>Needs evidence review</span>
              <strong>
                {
                  rows.filter(
                    (problem) =>
                      problem.stage === "Needs review" ||
                      problem.confidence < 80,
                  ).length
                }
              </strong>
              <small>before a confident roadmap decision</small>
            </div>
          </div>
          {rows.length === 0 ? (
            <section className="card section-gap">
              <div className="card-body">
                <p className="subtle">
                  No {typeFilter.toLowerCase()} problems match this filter.
                </p>
              </div>
            </section>
          ) : (
            <section className="prioritization-workspace">
              <div className="prioritization-queue-head">
                <div>
                  <h2>Impact review queue</h2>
                  <p>
                    Ordered by affected revenue, with the other decision
                    drivers kept visible.
                  </p>
                </div>
                <Link className="text-link" href="/settings#priority">
                  Review policy settings
                </Link>
              </div>
              <ol className="prioritization-decision-list">
                {rows.map((problem, index) => {
                  const trendLabel = formatTrend(problem.trend);
                  const evidenceNeedsReview =
                    problem.stage === "Needs review" ||
                    problem.confidence < 80;
                  return (
                    <li
                      className="prioritization-decision-row"
                      key={problem.id}
                    >
                      <span
                        className="prioritization-rank"
                        aria-label={`Rank ${index + 1}`}
                      >
                        {index + 1}
                      </span>
                      <div className="prioritization-decision-main">
                        <div className="prioritization-decision-title">
                          <Link href={`/problems/${problem.id}`}>
                            {problem.title}
                          </Link>
                          <span
                            className={`badge ${problem.severity.toLowerCase()}`}
                          >
                            {problem.severity}
                          </span>
                        </div>
                        <div
                          className="prioritization-drivers"
                          aria-label="Priority drivers"
                        >
                          <span>
                            <strong>{compactMoney(problem.revenue)}</strong> ARR
                          </span>
                          <span>
                            <strong>{problem.count}</strong>{" "}
                            {problem.count === 1 ? "signal" : "signals"}
                          </span>
                          <span>
                            <strong>{trendLabel}</strong> trend
                          </span>
                          <span>
                            <strong>{problem.confidence}%</strong> evidence
                          </span>
                        </div>
                      </div>
                      <div className="prioritization-decision-state">
                        <span className="badge brand">{problem.stage}</span>
                        {evidenceNeedsReview ? (
                          <small>Evidence review required</small>
                        ) : (
                          <small>Ready to compare</small>
                        )}
                      </div>
                      <Link
                        className="prioritization-review-link"
                        href={`/problems/${problem.id}#evidence`}
                      >
                        Review evidence{" "}
                        <ChevronRight size={14} aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
          <div className="prioritization-policy-note section-gap">
            <Info size={16} aria-hidden="true" />
            <p>
              Affected revenue sets the current queue order. Signal volume,
              severity, trend, and evidence confidence remain visible so ARR
              never becomes an automatic roadmap decision.
            </p>
          </div>
        </>
      )}
    </>
  );
}

function investigationStatusLabel(status: string) {
  return status === "Ready for approval" ? "Ready for review" : status;
}

function investigationStatusTone(status: string) {
  const label = investigationStatusLabel(status).toLowerCase();
  if (label.includes("ready")) return "success";
  if (label.includes("gather") || label.includes("context")) return "medium";
  return "";
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

export function InvestigationsScreen({
  investigations,
  selectedInvestigationId,
}: {
  investigations: InvestigationWorkspaceItem[];
  selectedInvestigationId: string | null;
}) {
  const selected = investigations.find(
    (item) => item.id === selectedInvestigationId,
  );

  if (!selected) {
    return (
      <>
        <PageTitle
          title="Investigations"
          description="Turn reviewed product problems into evidence-backed engineering recommendations."
        />
        <EmptyWorkspaceState
          title="No engineering investigations yet"
          description="Investigations appear after a product problem has enough reviewed evidence for engineering analysis."
          actionHref="/problems"
          actionLabel="Review product problems"
        />
      </>
    );
  }

  const confidence = Math.round(selected.confidence * 100);
  const updatedAt = new Date(selected.updatedAt);
  const updatedLabel = Number.isNaN(updatedAt.getTime())
    ? "Recently updated"
    : `Updated ${updatedAt.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })}`;

  return (
    <>
      <PageTitle
        title="Investigations"
        description="Review hypotheses, close evidence gaps, and return a test-ready recommendation to the product problem."
        action={
          <span className="badge brand">
            {investigations.length} active investigation
            {investigations.length === 1 ? "" : "s"}
          </span>
        }
      />

      <div className="investigation-workspace">
        <aside className="card investigation-queue-card">
          <div className="card-head investigation-queue-head">
            <div>
              <h2>Engineering queue</h2>
              <p className="subtle">Select a problem to investigate.</p>
            </div>
            <span className="badge">{investigations.length}</span>
          </div>
          <nav
            className="investigation-queue-list"
            aria-label="Engineering investigations"
          >
            {investigations.map((item) => {
              const active = item.id === selected.id;
              const status = investigationStatusLabel(item.status);
              return (
                <Link
                  key={item.id}
                  href={`/investigations/${encodeURIComponent(item.id)}`}
                  className={`investigation-queue-item${active ? " selected" : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="investigation-queue-copy">
                    <strong>{item.problemTitle}</strong>
                    <span>{item.productArea} · {item.team}</span>
                  </span>
                  <span className="investigation-queue-meta">
                    <span className={`badge ${investigationStatusTone(item.status)}`}>
                      {status}
                    </span>
                    <span>{Math.round(item.confidence * 100)}%</span>
                  </span>
                </Link>
              );
            })}
          </nav>
          <div className="investigation-queue-foot">
            <Link className="text-link" href="/problems">
              View all product problems <ChevronRight size={13} />
            </Link>
          </div>
        </aside>

        <article className="card investigation-detail-card">
          <header className="investigation-detail-head">
            <div className="investigation-detail-heading">
              <div className="investigation-detail-kicker">
                <span>{selected.productArea}</span>
                <span aria-hidden="true">·</span>
                <span>{selected.severity} severity</span>
              </div>
              <h2>{selected.problemTitle}</h2>
              <p>{selected.title}</p>
            </div>
            <div className="investigation-detail-status">
              <span className={`badge ${investigationStatusTone(selected.status)}`}>
                {investigationStatusLabel(selected.status)}
              </span>
              <span className="subtle">{updatedLabel}</span>
            </div>
          </header>

          <div className="investigation-detail-body">
            <section className="investigation-readiness" aria-label="Investigation readiness">
              <div>
                <span>Investigation confidence</span>
                <strong>{confidence}%</strong>
              </div>
              <div>
                <span>Evidence gaps</span>
                <strong>{selected.missingInformation.length}</strong>
              </div>
              <div>
                <span>Validation checks</span>
                <strong>{selected.recommendedTests.length}</strong>
              </div>
            </section>

            <section className="callout warning investigation-hypothesis">
              <div className="callout-title">
                <AlertTriangle size={14} /> Hypothesis—not confirmed
              </div>
              <p>{selected.hypothesis}</p>
            </section>

            <div className="investigation-detail-grid">
              <InvestigationList
                title="Evidence to collect"
                items={selected.missingInformation}
                emptyLabel="No evidence gaps are recorded."
              />
              <InvestigationList
                title="Recommended validation"
                items={selected.recommendedTests}
                emptyLabel="No validation checks are recorded."
              />
              <InvestigationList
                title="Suspected code paths"
                items={selected.suspectedFiles}
                emptyLabel="No code paths are suspected yet."
              />
              <InvestigationList
                title="Working assumptions"
                items={selected.assumptions}
                emptyLabel="No assumptions are recorded."
              />
            </div>

            <section className="investigation-next-step">
              <div>
                <h3>Recommended next step</h3>
                <p>{selected.proposedAction}</p>
                <span className="subtle">
                  Prompt drafting and PDD testing continue in the product problem after this evidence is reviewed.
                </span>
              </div>
              <Link className="btn primary" href={`/problems/${selected.problemId}`}>
                Open product problem <ChevronRight size={14} />
              </Link>
            </section>

            <footer className="investigation-context-line">
              <GitBranch size={15} aria-hidden="true" />
              <span>{selected.repository}</span>
              <span aria-hidden="true">·</span>
              <span>{selected.team}</span>
              <span aria-hidden="true">·</span>
              <span>{Math.round(selected.signalConfidence * 100)}% signal match</span>
            </footer>
          </div>
        </article>
      </div>
    </>
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
  problem,
  problemTitles,
  initialEngineeringWorkflows,
  orgId,
}: {
  problem: ProductProblem | null;
  problemTitles: Record<string, string>;
  initialEngineeringWorkflows: EngineeringWorkflowView[];
  orgId: string;
}) {
  const [engineeringWorkflows, setEngineeringWorkflows] = useState(
    initialEngineeringWorkflows,
  );
  const approvalItems: ApprovalItem[] = engineeringWorkflows.flatMap((workflow) => [
    workflow.approval
      ? { key: `engineering:${workflow.problemId}`, kind: "engineering" as const, workflow }
      : null,
    workflow.finalApproval
      ? { key: `final:${workflow.problemId}`, kind: "final" as const, workflow }
      : null,
  ].filter(Boolean) as ApprovalItem[]);
  const initialPendingItems = approvalItems.filter((item) =>
    item.kind === "engineering"
      ? item.workflow.approval?.status === "Pending"
      : item.workflow.finalApproval?.status === "Pending",
  );
  const [tab, setTab] = useState<ApprovalTab>(() =>
    initialPendingItems.length > 0 ? "pending" : "history",
  );
  const [selected, setSelected] = useState<string>(() =>
    initialPendingItems[0]?.key ?? approvalItems[0]?.key ?? "",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  }>();

  const pendingItems = approvalItems.filter((item) =>
    item.kind === "engineering"
      ? item.workflow.approval?.status === "Pending"
      : item.workflow.finalApproval?.status === "Pending",
  );
  const historyItems = approvalItems.filter((item) =>
    item.kind === "engineering"
      ? item.workflow.approval?.status !== "Pending"
      : item.workflow.finalApproval?.status !== "Pending",
  );
  const visibleItems = tab === "pending" ? pendingItems : historyItems;
  const selectedItem = visibleItems.find((item) => item.key === selected) ?? visibleItems[0];
  const engineeringWorkflow = selectedItem?.workflow ?? null;
  const engineeringApproval = engineeringWorkflow?.approval;
  const finalApproval = engineeringWorkflow?.finalApproval;
  const selectedKind = selectedItem?.kind;

  function replaceWorkflow(next: EngineeringWorkflowView) {
    setEngineeringWorkflows((current) =>
      current.map((workflow) => workflow.problemId === next.problemId ? next : workflow),
    );
  }

  function selectTab(nextTab: ApprovalTab) {
    const nextItems = nextTab === "pending" ? pendingItems : historyItems;
    setTab(nextTab);
    if (!nextItems.some((item) => item.key === selected) && nextItems[0]) {
      setSelected(nextItems[0].key);
    }
    setNotice(undefined);
  }

  if (approvalItems.length === 0) {
    return (
      <>
        <PageTitle
          title="Execution approvals"
          description="Human authorization for agent implementation and final code execution."
        />
        <EmptyWorkspaceState
          title="No approval requests"
          description="Agent-run and final-execution requests appear here when they are ready for a human decision."
          actionHref={problem ? `/problems/${problem.id}` : "/feedback"}
          actionLabel={problem ? "Review product problem" : "Open feedback inbox"}
        />
      </>
    );
  }
  async function decideEngineering(action: "approve" | "reject") {
    if (!engineeringApproval) return;
    if (!selectedItem) return;
    setBusy(selectedItem.key);
    setNotice(undefined);
    try {
      const response = await fetch(
        `/api/engineering-approvals/${engineeringApproval.id}/${action}`,
        {
          method: "POST",
          headers: {
            "x-org-id": orgId,
            "idempotency-key": crypto.randomUUID(),
            "x-request-id": crypto.randomUUID(),
          },
        },
      );
      const payload = (await response.json()) as {
        workflow?: EngineeringWorkflowView;
        error?: string;
      };
      if (!response.ok || !payload.workflow) {
        throw new Error(payload.error ?? "Approval action failed");
      }
      replaceWorkflow(payload.workflow);
      setTab("history");
      setSelected(selectedItem.key);
      setNotice({
        kind: "success",
        text:
          action === "approve"
            ? "Coding run approved and queued. Track execution and verification in Agent runs."
            : "Coding run rejected. The decision is recorded in the audit trail.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Approval action failed",
      });
    } finally {
      setBusy(null);
    }
  }

  async function decideFinalExecution(action: "approve" | "reject") {
    if (!finalApproval) return;
    if (!selectedItem) return;
    setBusy(selectedItem.key);
    setNotice(undefined);
    try {
      const response = await fetch(
        `/api/final-execution-approvals/${finalApproval.id}/${action}`,
        {
          method: "POST",
          headers: {
            "x-org-id": orgId,
            "idempotency-key": crypto.randomUUID(),
            "x-request-id": crypto.randomUUID(),
          },
        },
      );
      const payload = (await response.json()) as {
        approval?: FinalExecutionApprovalView;
        error?: string;
      };
      if (!response.ok || !payload.approval) {
        throw new Error(payload.error ?? "Final execution approval failed");
      }
      replaceWorkflow({ ...selectedItem.workflow, finalApproval: payload.approval });
      setTab("history");
      setSelected(selectedItem.key);
      const executionFailed =
        payload.approval.attempt?.status === "Failed"
        || payload.approval.status === "Superseded";
      setNotice({
        kind: executionFailed ? "error" : "success",
        text:
          action === "approve"
            ? executionFailed
              ? payload.approval.attempt?.failureMessage ?? "GitHub could not merge the reviewed commit."
              : payload.approval.attempt?.status === "Queued"
                ? "The reviewed commit was approved and queued for execution."
                : "The reviewed commit was approved. Release verification remains automatic."
            : "Final execution was rejected. The draft PR remains unchanged.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Final execution approval failed",
      });
    } finally {
      setBusy(null);
    }
  }

  const itemTitle = (item: ApprovalItem) => {
    if (item.kind === "engineering") {
      return `Authorize agent · ${problemTitles[item.workflow.problemId] ?? item.workflow.problemId}`;
    }
    if (item.kind === "final") {
      return `Merge PR #${item.workflow.finalApproval?.pullRequestNumber ?? ""} · ${problemTitles[item.workflow.problemId] ?? item.workflow.problemId}`;
    }
    return "Final execution";
  };

  const itemStatus = (item: ApprovalItem) => {
    if (item.kind === "engineering") return item.workflow.approval?.status ?? "Pending";
    if (item.kind === "final") {
      return item.workflow.finalApproval?.attempt?.status ?? item.workflow.finalApproval?.status ?? "Pending";
    }
    return "Pending";
  };

  return (
    <>
      <PageTitle
        title="Execution approvals"
        description="Two human gates protect code changes: authorize the agent, then authorize the reviewed result."
        action={
          <span className={`badge ${pendingItems.length ? "medium" : "success"}`}>
            {pendingItems.length
              ? `${pendingItems.length} awaiting review`
              : "No pending decisions"}
          </span>
        }
      />
      <div className="approval-tabs" role="group" aria-label="Approval status">
        {(["pending", "history"] as const).map((item) => (
          <button
            type="button"
            aria-pressed={tab === item}
            className={tab === item ? "active" : ""}
            onClick={() => selectTab(item)}
            key={item}
          >
            {item === "pending" ? "Pending" : "History"}
            <span>{item === "pending" ? pendingItems.length : historyItems.length}</span>
          </button>
        ))}
      </div>
      <div className="approval-layout">
        <section className="card approval-queue-card">
          <div className="card-head">
            <div>
              <h2>{tab === "pending" ? "Awaiting your decision" : "Decision history"}</h2>
              <p className="subtle">
                {tab === "pending"
                  ? "Only agent-run and final-code decisions appear here."
                  : "Completed execution decisions remain available for traceability."}
              </p>
            </div>
          </div>
          {visibleItems.length ? (
            <div className="approval-request-list">
              {visibleItems.map((item) => (
                <button
                  type="button"
                  className={`queue-item approval-queue-button${selected === item.key ? " selected" : ""}`}
                  aria-current={selected === item.key ? "true" : undefined}
                  onClick={() => {
                    setSelected(item.key);
                    setNotice(undefined);
                  }}
                  key={item.key}
                >
                  <div>
                    <strong>{itemTitle(item)}</strong>
                    <p className="subtle">
                      {item.kind === "engineering"
                        ? `${item.workflow.approval?.repository ?? "Repository"} · One-run authorization`
                        : `${item.workflow.finalApproval?.repository ?? "Repository"} · Exact commit`}
                    </p>
                  </div>
                  <span
                    className={`badge queue-item-badge ${["Approved", "Succeeded"].includes(itemStatus(item)) ? "success" : ["Rejected", "Failed", "Superseded", "Expired"].includes(itemStatus(item)) ? "high" : "medium"}`}
                  >
                    {itemStatus(item)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="approval-queue-empty">
              <strong>
                {tab === "pending"
                  ? "No execution decisions await you"
                  : "No decisions recorded yet"}
              </strong>
              <p className="subtle">
                {tab === "pending"
                  ? "Agent activity continues automatically until it reaches one of the two human gates."
                  : "Completed agent-run and final-execution approvals will appear here."}
              </p>
            </div>
          )}
        </section>
        {visibleItems.length ? (
          <section
            className="card approval-detail-card"
            id={`approval-${selectedKind === "engineering" ? engineeringApproval?.id : finalApproval?.id}`}
          >
            {selectedKind === "engineering" && engineeringApproval && engineeringWorkflow?.prompt ? (
              <>
                <div className="card-head">
                  <div>
                    <h2>Authorize one coding run</h2>
                    <p className="subtle">Bound to an immutable prompt, repository, and base commit.</p>
                  </div>
                  <span
                    className={`badge ${engineeringApproval.status === "Approved" ? "success" : engineeringApproval.status === "Rejected" ? "high" : "medium"}`}
                  >
                    {engineeringApproval.status}
                  </span>
                </div>
                <div className="card-body">
                  <p>
                    Approving starts one isolated coding run. Independent
                    verification starts automatically after implementation.
                  </p>
                  <div className="approval-facts">
                    <Fact
                      icon={<Sparkles />}
                      label="Prompt"
                      value={`Revision ${engineeringWorkflow.prompt.revision} · ${engineeringApproval.promptHash}`}
                    />
                    <Fact
                      icon={<GitBranch />}
                      label="Destination"
                      value={`${engineeringApproval.repository} · ${engineeringApproval.baseBranch}@${engineeringApproval.baseSha}`}
                    />
                    <Fact
                      icon={<ShieldCheck />}
                      label="Allowed capabilities"
                      value={engineeringApproval.allowedCapabilities.join(", ")}
                    />
                    <Fact
                      icon={<Clock3 />}
                      label="Authorization expires"
                      value={new Date(engineeringApproval.expiresAt).toLocaleString()}
                    />
                  </div>
                  {engineeringApproval.status === "Pending" ? (
                    <div className="approval-actions">
                      <button
                        type="button"
                        className="btn danger"
                        disabled={busy !== null}
                        onClick={() => decideEngineering("reject")}
                      >
                        Reject run
                      </button>
                      <button
                        type="button"
                        className="btn primary"
                        disabled={busy !== null}
                        onClick={() => decideEngineering("approve")}
                      >
                        Approve one run <Check size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="approval-result-actions">
                      <div className="success-panel">
                        <Check size={16} /> Decision recorded in the shared audit trail.
                      </div>
                      {engineeringWorkflow.run ? (
                        <Link className="btn" href={`/agent-runs/${engineeringWorkflow.run.id}`}>
                          View authorized run
                        </Link>
                      ) : null}
                    </div>
                  )}
                </div>
              </>
            ) : selectedKind === "final" && finalApproval ? (
              <>
                <div className="card-head">
                  <div>
                    <h2>Approve final PR execution</h2>
                    <p className="subtle">
                      The last human gate before GitHub merges the reviewed commit.
                    </p>
                  </div>
                  <span
                    className={`badge ${finalApproval.attempt?.status === "Succeeded" || finalApproval.status === "Approved" ? "success" : finalApproval.attempt?.status === "Failed" || finalApproval.status === "Rejected" || finalApproval.status === "Superseded" ? "high" : "medium"}`}
                  >
                    {selectedItem ? itemStatus(selectedItem) : finalApproval.status}
                  </span>
                </div>
                <div className="card-body">
                  <p>
                    Independent verification passed. Approving will make the
                    draft ready for review and squash-merge only the commit
                    shown below. It does not mark the problem released without
                    a separate deployment signal.
                  </p>
                  {finalApproval.autoDeployOnMerge ? (
                    <div className="callout warning">
                      <div className="callout-title">Production consequence</div>
                      <p>Merging this PR will automatically deploy to production.</p>
                    </div>
                  ) : null}
                  <div className="approval-facts final-execution-facts">
                    <Fact
                      icon={<GitBranch />}
                      label="Pull request"
                      value={`${finalApproval.repository} · #${finalApproval.pullRequestNumber} → ${finalApproval.baseBranch}`}
                    />
                    <Fact
                      icon={<ShieldCheck />}
                      label="Commit lock"
                      value={finalApproval.headSha}
                    />
                    <Fact
                      icon={<Check />}
                      label="Verification"
                      value={`${finalApproval.testSummary.passed} tests passed · ${finalApproval.acceptanceSummary.passed} acceptance checks passed`}
                    />
                    {finalApproval.releaseVerification ? (
                      <>
                        <Fact
                          icon={<ShieldCheck />}
                          label="Production verification contract"
                          value={`${finalApproval.releaseVerification.backendChecks} backend check${finalApproval.releaseVerification.backendChecks === 1 ? "" : "s"} · ${finalApproval.releaseVerification.frontendJourneys} frontend journey${finalApproval.releaseVerification.frontendJourneys === 1 ? "" : "s"} · ${finalApproval.releaseVerification.planHash.slice(0, 8)}`}
                        />
                        <Fact
                          icon={<GitBranch />}
                          label="PR scope classification"
                          value={(() => {
                            const assessment = finalApproval.releaseVerification.scopeAssessment;
                            const observed = [
                              assessment.observed.backend ? "backend" : null,
                              assessment.observed.frontend ? "frontend" : null,
                              assessment.observed.unknown ? "unknown" : null,
                            ].filter(Boolean).join(" + ") || "non-production files only";
                            return `${observed} · ${assessment.compatible ? "matches approved contract" : "contract revision required"}`;
                          })()}
                        />
                      </>
                    ) : null}
                    {finalApproval.uiBaseline ? (
                      <Fact
                        icon={<MonitorCheck />}
                        label="Approved UI baseline"
                        value={`${finalApproval.uiBaseline.captureCount} responsive capture${finalApproval.uiBaseline.captureCount === 1 ? "" : "s"} · ${finalApproval.uiBaseline.planHash.slice(0, 8)}`}
                      />
                    ) : null}
                    <Fact
                      icon={<AlertTriangle />}
                      label="Remaining risks"
                      value={
                        finalApproval.remainingRisks.length
                          ? finalApproval.remainingRisks.join(" · ")
                          : "No unresolved risks reported"
                      }
                    />
                    {finalApproval.targetEnvironment ? (
                      <Fact
                        icon={<Cloud />}
                        label="Deployment target"
                        value={finalApproval.targetEnvironment}
                      />
                    ) : null}
                    {finalApproval.rollbackPlan ? (
                      <Fact
                        icon={<RotateCcw />}
                        label="Rollback"
                        value={finalApproval.rollbackPlan}
                      />
                    ) : null}
                  </div>
                  {finalApproval.releaseVerification?.scopeAssessment.compatible === false ? (
                    <div className="callout warning" role="alert">
                      <div className="callout-title">Verification scope changed</div>
                      <p>
                        This PR touches a production surface outside the approved PDD contract.
                        Final execution is locked until the PDD is revised and a new agent run is reviewed.
                      </p>
                      <ul>
                        {finalApproval.releaseVerification.scopeAssessment.mismatches.map((mismatch) => (
                          <li key={mismatch}>{mismatch}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div className="callout warning final-execution-lock">
                    <div className="callout-title">
                      Approval applies only to {finalApproval.headSha.slice(0, 8)}
                    </div>
                    <p>
                      If the PR receives another commit or changes its target
                      branch, this authorization cannot merge it.
                    </p>
                  </div>
                  {finalApproval.status === "Pending" ? (
                    <div className="approval-actions">
                      <button
                        type="button"
                        className="btn danger"
                        disabled={busy !== null}
                        onClick={() => decideFinalExecution("reject")}
                      >
                        {busy === selectedItem?.key ? "Recording…" : "Reject merge"}
                      </button>
                      {finalApproval.releaseVerification?.scopeAssessment.compatible === false ? (
                        <Link className="btn primary" href={`/problems/${finalApproval.problemId}`}>
                          Revise PDD contract
                          <ChevronRight size={14} />
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="btn primary"
                          disabled={busy !== null}
                          onClick={() => decideFinalExecution("approve")}
                        >
                          {busy === selectedItem?.key
                            ? "Queueing execution…"
                            : finalApproval.executionAction === "deploy"
                              ? "Approve production deployment"
                              : "Approve and merge PR"}
                          {busy !== selectedItem?.key ? <Check size={14} /> : null}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="approval-result-actions">
                      <div
                        className={
                          finalApproval.attempt?.status === "Failed"
                            ? "callout warning"
                            : "success-panel"
                        }
                      >
                        {finalApproval.attempt?.status === "Failed" ? (
                          <>
                            <AlertTriangle size={16} /> Merge failed: {finalApproval.attempt.failureMessage}
                          </>
                        ) : (
                          <>
                            <Check size={16} />
                            {finalApproval.status === "Rejected"
                              ? "Merge rejected; the draft PR was not changed."
                              : finalApproval.status === "Superseded"
                                ? "Approval invalidated because the reviewed PR changed."
                                : finalApproval.status === "Expired"
                                  ? "Approval expired before the reviewed commit was merged."
                                  : finalApproval.attempt?.status === "Succeeded"
                                    ? "Reviewed commit merged and recorded in the audit trail."
                                    : "Final execution decision recorded."}
                          </>
                        )}
                      </div>
                      <div className="top-actions">
                        {finalApproval.status === "Approved" && finalApproval.attempt?.status === "Failed" ? (
                          <button
                            type="button"
                            className="btn primary"
                            disabled={busy !== null}
                            onClick={() => decideFinalExecution("approve")}
                          >
                            {busy === selectedItem?.key ? "Queueing retry…" : "Retry approved merge"}
                          </button>
                        ) : null}
                        <a
                          className="btn"
                          href={finalApproval.pullRequestUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open pull request
                        </a>
                        <Link className="btn" href={`/agent-runs/${finalApproval.agentRunId}`}>
                          View verified run
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : null}
            {notice ? (
              <p
                className={`toast ${notice.kind}`}
                role={notice.kind === "error" ? "alert" : "status"}
              >
                {notice.text}
              </p>
            ) : null}
          </section>
        ) : (
          <section className="card approval-detail-empty">
            <ShieldCheck aria-hidden="true" size={28} />
            <h2>{tab === "pending" ? "You are all caught up" : "No approval selected"}</h2>
            <p className="subtle">
              {tab === "pending"
                ? "Agent activity that does not require authorization continues automatically and appears in Agent runs."
                : "Resolved decisions will appear here when they are available."}
            </p>
            <Link className="btn" href="/agent-runs">
              Open Agent runs
            </Link>
          </section>
        )}
      </div>
    </>
  );
}

type ApprovalTab = "pending" | "history";
type ApprovalKind = "engineering" | "final";
interface ApprovalItem {
  key: string;
  kind: ApprovalKind;
  workflow: EngineeringWorkflowView;
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
  const reduceMotion = useReducedMotion();
  const focusedCardRef = useRef<HTMLElement | null>(null);
  const suggestionsTabRef = useRef<HTMLButtonElement | null>(null);
  const connectionsTabRef = useRef<HTMLButtonElement | null>(null);
  const integrationDrawerRef = useRef<HTMLElement | null>(null);
  const integrationDrawerCloseRef = useRef<HTMLButtonElement | null>(null);
  const integrationDrawerTriggerRef = useRef<HTMLElement | null>(null);
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
  const integrationDrawerOpen = Boolean(selectedRow);
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
    const views = ["suggestions", "connections"] as const;
    const currentIndex = views.indexOf(activeView);
    const nextView =
      event.key === "Home"
        ? views[0]
        : event.key === "End"
          ? views[views.length - 1]
          : views[
              (currentIndex +
                (event.key === "ArrowRight" ? 1 : -1) +
                views.length) %
                views.length
            ];
    selectIntegrationView(nextView);
    window.requestAnimationFrame(() =>
      (nextView === "suggestions"
        ? suggestionsTabRef.current
        : connectionsTabRef.current
      )?.focus(),
    );
  }

  function openIntegrationDetails(integrationId: string) {
    if (!selectedIntegrationId) {
      integrationDrawerTriggerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    setSelectedIntegrationId(integrationId);
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
    if (!integrationDrawerOpen) return;
    const drawer = integrationDrawerRef.current;
    if (!drawer) return;
    const previouslyFocused = integrationDrawerTriggerRef.current;
    const focusFrame = window.requestAnimationFrame(() => {
      (
        integrationDrawerCloseRef.current ??
        getModalFocusableElements(drawer)[0] ??
        drawer
      ).focus({ preventScroll: true });
    });
    const handleDrawerKeyDown = (event: KeyboardEvent) => {
      containModalFocus(event, drawer, () =>
        setSelectedIntegrationId(null),
      );
    };
    document.addEventListener("keydown", handleDrawerKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleDrawerKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) {
        window.requestAnimationFrame(() => {
          previouslyFocused.focus({ preventScroll: true });
        });
      }
    };
  }, [integrationDrawerOpen]);

  return (
    <>
      <PageTitle
        title="Integrations"
        description="Let CloseSpan recommend the next source, or manage every connection directly."
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
            tabIndex={0}
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
                onInspect={openIntegrationDetails}
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
              onInspect={openIntegrationDetails}
            />
          </section>

          <section
            id="integration-connections-panel"
            className="integration-catalog-shell"
            role="tabpanel"
            aria-labelledby="integration-connections-tab"
            tabIndex={0}
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

          <div className="integration-filterbar" role="group" aria-label="Filter integrations">
            {(["All", "Feedback", "Engineering", "Analytics", "Support"] as const).map((filter) => {
              const count = connectorRows.filter(
                (row) => filter === "All" || row.experience.filter === filter,
              ).length;
              return (
                <button
                  key={filter}
                  type="button"
                  className={activeFilter === filter ? "active" : ""}
                  aria-label={`${filter === "All" ? "All integrations" : `${filter} integrations`}, ${count}`}
                  aria-pressed={activeFilter === filter}
                  onClick={() => setActiveFilter(filter)}
                >
                  {filter}<span aria-hidden="true">{count}</span>
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
                    <p>{group === "Connected" ? "Active tools in this workspace." : group === "Recommended" ? "Available connectors selected for this workflow." : "More native connections planned for CloseSpan."}</p>
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
                        <FitText as="h3" id={headingId} minFontSize={13} maxLines={2}>
                          {item.name}
                        </FitText>
                        <p className="integration-card-summary">{experience.summary}</p>
                        <div className="integration-card-footer">
                          {observedConnectionState === "Needs reconnect" ? (
                            <p className="integration-import failed"><AlertTriangle size={13} aria-hidden="true" />Reconnect required</p>
                          ) : connected && !demonstration && isPipedreamConnectorId(item.id) && isFeedbackSourceIntegration(item.id) ? (
                            <IntegrationSyncStatus
                              orgId={orgId}
                              integrationId={item.id}
                              active
                              onConnectionStateChange={(nextState) =>
                                updateConnectionState(item.id, nextState)
                              }
                            />
                          ) : null}
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
                          <button className="btn" type="button" onClick={() => openIntegrationDetails(item.id)}>
                            {connected ? "View details" : available ? "Review & connect" : "View details"}
                          </button>
                        </div>
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

      <AnimatePresence initial={false}>
      {selectedRow && (
        <motion.div
          key={selectedRow.item.id}
          className="integration-drawer-layer"
          role="presentation"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
          onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedIntegrationId(null);
        }}>
          <motion.aside
            ref={integrationDrawerRef}
            className="integration-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="integration-drawer-title"
            tabIndex={-1}
            initial={reduceMotion ? false : { x: 28, opacity: 0.72 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 28, opacity: 0.72 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="integration-drawer-head">
              <IntegrationProviderIcon integrationId={selectedRow.item.id} size={22} />
              <div><span>{selectedRow.experience.filter}</span><h2 id="integration-drawer-title">{selectedRow.connected ? selectedRow.item.name : `Connect ${selectedRow.item.name}`}</h2></div>
              <button ref={integrationDrawerCloseRef} type="button" className="icon-button" aria-label="Close connector details" onClick={() => setSelectedIntegrationId(null)}><X size={18} /></button>
            </div>
            <p className="integration-drawer-summary">{selectedRow.experience.summary}</p>
            <section className="integration-drawer-section">
              <h3>Data CloseSpan will use</h3>
              <ul>{selectedRow.experience.importedData.map((value) => <li key={value}><Check size={14} aria-hidden="true" />{value}</li>)}</ul>
            </section>
            <section className="integration-drawer-section">
              <h3>Permissions requested</h3>
              <ul>{selectedRow.experience.requestedPermissions.map((value) => <li key={value}><ShieldCheck size={14} aria-hidden="true" />{value}</li>)}</ul>
              <p>CloseSpan requests least-privilege access. Agent actions still require your approval.</p>
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
              ) : selectedRow.item.id === "int_github" ? (
                <div>
                  <p>
                    CloseSpan uses its GitHub App so you choose the exact
                    repositories available for testing and approved pull requests.
                  </p>
                  <Link
                    className="btn primary"
                    href="/integrations?view=connections&focus=int_github"
                  >
                    Select repositories
                  </Link>
                </div>
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
          </motion.aside>
        </motion.div>
      )}
      </AnimatePresence>
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
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
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
  const affected = Array.from(
    feedbackItems
      .filter((item) => item.problemId === problem.id)
      .reduce((recipients, item) => {
        const customerKey = item.customer.trim().toLocaleLowerCase() || item.id;
        if (!recipients.has(customerKey)) recipients.set(customerKey, item);
        return recipients;
      }, new Map<string, FeedbackItem>())
      .values(),
  );
  async function approveDrafts() {
    if (affected.length === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      setState(await workflowMutation("/api/workflow/notify", activeProblem.orgId));
      setNotice({
        kind: "success",
        text: "Customer drafts approved in the audited workflow; no external message was sent.",
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
            {affected.length === 0 ? (
              <div className="callout" role="status">
                <div className="callout-title">No recipients found</div>
                <p className="subtle">
                  This resolution has no distinct customer recipients yet.
                  Draft approval will become available after linked feedback is
                  imported.
                </p>
              </div>
            ) : (
              affected.map((customer) => (
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
              ))
            )}
            <button
              type="button"
              className="btn primary"
              disabled={busy || affected.length === 0 || state.notifications === "Approved"}
              onClick={approveDrafts}
            >
              {state.notifications === "Approved"
                ? "Drafts approved"
                : "Approve all drafts"}
            </button>
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
          <caption className="sr-only">Customer accounts</caption>
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
                  <small>
                    {customer.customerSinceKnown
                      ? `Customer since ${customer.customerSince}`
                      : "Customer since not available"}
                    {customer.origin === "demo"
                      ? " · Demo account"
                      : customer.sourceNames.length > 0
                        ? ` · Imported from ${customer.sourceNames.join(", ")}`
                        : " · Manually managed"}
                  </small>
                </td>
                <td>
                  <span className="badge">{customer.tier}</span>
                </td>
                <td>
                  {customer.arrSource === "unknown"
                    ? <span className="subtle">Not available</span>
                    : money(customer.arr)}
                </td>
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
  const initialRetention = initialRetentionSelection(settings.retentionDays);
  const [retention, setRetention] = useState(initialRetention.option);
  const [customRetention, setCustomRetention] = useState(
    initialRetention.customValue,
  );
  const [pii, setPii] = useState(settings.piiRedaction);
  const [saved, setSaved] = useState(false);
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const retentionValid =
    retention !== CUSTOM_RETENTION_OPTION ||
    isValidCustomRetention(customRetention);
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
            disabled={total !== 100 || !retentionValid}
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
              <div className="field">
                <span>Autonomy level</span>
                <CustomSelect
                  ariaLabel="Autonomy level"
                  value={autonomy}
                  options={[
                    "Observe",
                    "Recommend",
                    "Organize",
                    "Execute with approval",
                    "Limited autonomy",
                  ]}
                  onValueChange={(value) => {
                    setAutonomy(value);
                    setSaved(false);
                  }}
                />
              </div>
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
                    : `Add your ${settings.ai.providerLabel} key`}
                </div>
                <p className="subtle">
                  {settings.ai.configured
                    ? `${settings.ai.providerLabel} calls use strict structured outputs, no tools, provider storage disabled, PII preprocessing, and review-only cluster recommendations.`
                    : "Add the provider key in AI settings or configure the matching server environment secret, then restart the app. Credentials are read only by the server and are never returned to the browser."}
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
          <section className="card settings-data-card" id="data">
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
              <div className="field">
                <span>Feedback retention</span>
                <CustomSelect
                  ariaLabel="Feedback retention"
                  className="settings-retention-select"
                  inlineMenu
                  value={retention}
                  options={["90 days", "365 days", CUSTOM_RETENTION_OPTION]}
                  onValueChange={(value) => {
                    setRetention(value);
                    setSaved(false);
                  }}
                />
                <CustomRetentionInput
                  open={retention === CUSTOM_RETENTION_OPTION}
                  value={customRetention}
                  onValueChange={(value) => {
                    setCustomRetention(value);
                    setSaved(false);
                  }}
                />
              </div>
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
  promptDraftReadiness,
}: {
  problem: OverviewAnalytics["problems"][number];
  promptDraftReadiness: PromptDraftReadiness;
}) {
  const router = useRouter();
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [startingInvestigation, setStartingInvestigation] = useState(false);
  const [promptActionError, setPromptActionError] = useState<string>();

  async function generateSuggestedPrompt() {
    setGeneratingPrompt(true);
    setPromptActionError(undefined);
    try {
      const response = await fetch(`/api/problems/${problem.id}/engineering/draft`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The suggested prompt could not be generated.");
      router.refresh();
    } catch (cause) {
      setPromptActionError(cause instanceof Error ? cause.message : "The suggested prompt could not be generated.");
    } finally {
      setGeneratingPrompt(false);
    }
  }

  async function startInvestigation() {
    setStartingInvestigation(true);
    setPromptActionError(undefined);
    try {
      const response = await fetch(`/api/problems/${problem.id}/investigation`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
      });
      const payload = await response.json() as {
        error?: string;
        result?: { investigationId?: string | null };
      };
      if (!response.ok && response.status !== 409) {
        throw new Error(payload.error ?? "The investigation could not be started.");
      }
      router.refresh();
    } catch (cause) {
      setPromptActionError(cause instanceof Error ? cause.message : "The investigation could not be started.");
    } finally {
      setStartingInvestigation(false);
    }
  }

  const investigationPercent = promptDraftReadiness.investigationConfidence === null
    ? null
    : Math.round(promptDraftReadiness.investigationConfidence * 100);
  const requiredPercent = Math.round(promptDraftReadiness.requiredConfidence * 100);
  const needsInvestigationReview = investigationPercent === null || investigationPercent < requiredPercent;
  const promptBlockedReason = needsInvestigationReview
    ? investigationPercent === null
      ? `Complete the investigation and reach ${requiredPercent}% confidence before generating a prompt.`
      : `Investigation confidence is ${investigationPercent}%. Reach ${requiredPercent}% before generating a prompt.`
    : promptDraftReadiness.reason;

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
          </div>
          <div className="card-body detail-stack">
            <p className="summary">
              This cluster has {problem.count} related signals representing{" "}
              {money(problem.revenue)} in affected ARR.
            </p>
            <div className="prompt-readiness-grid" aria-label="Prompt drafting confidence">
              <div className="prompt-readiness-metric">
                <strong>{problem.confidence}%</strong>
                <span>Signal match confidence</span>
              </div>
              <div className="prompt-readiness-metric">
                <strong>{investigationPercent === null ? "Not ready" : `${investigationPercent}%`}</strong>
                <span>Investigation confidence</span>
              </div>
              <div className="prompt-readiness-metric prompt-readiness-threshold">
                <strong>{requiredPercent}%</strong>
                <span>Required for prompt drafting</span>
              </div>
            </div>
            <div className={`callout prompt-readiness-callout ${promptDraftReadiness.canGenerate ? "success" : "warning"}`}>
              <div className="callout-title">
                {promptDraftReadiness.canGenerate
                  ? "Ready to create a suggested prompt"
                  : needsInvestigationReview
                    ? "Investigation required"
                    : "Prompt context needs review"}
              </div>
              <p className="subtle" id="prompt-generation-status">
                {promptBlockedReason}
              </p>
              <div className="top-actions prompt-readiness-actions">
                {!promptDraftReadiness.canGenerate && (
                  investigationPercent === null ? (
                    <button
                      type="button"
                      className="btn primary"
                      disabled={startingInvestigation}
                      onClick={startInvestigation}
                    >
                      {startingInvestigation ? "Starting investigation…" : "Start investigation"}
                    </button>
                  ) : (
                    <Link
                      className="btn primary"
                      href={needsInvestigationReview && promptDraftReadiness.investigationId
                        ? `/investigations/${encodeURIComponent(promptDraftReadiness.investigationId)}`
                        : "/settings#execution-profiles"}
                    >
                      {needsInvestigationReview ? "Review investigation" : "Review prompt context"}
                    </Link>
                  )
                )}
                <button
                  type="button"
                  className={promptDraftReadiness.canGenerate ? "btn primary" : "btn secondary"}
                  disabled={!promptDraftReadiness.canGenerate || generatingPrompt}
                  onClick={generateSuggestedPrompt}
                  aria-describedby={!promptDraftReadiness.canGenerate ? "prompt-generation-status" : undefined}
                  title={!promptDraftReadiness.canGenerate ? promptBlockedReason : undefined}
                >
                  <Sparkles size={16} />
                  {generatingPrompt ? "Generating…" : "Generate suggested prompt"}
                </button>
              </div>
            </div>
            {promptActionError && <p className="toast error" role="alert">{promptActionError}</p>}
          </div>
        </section>
        <section className="card problem-lifecycle-card">
          <div className="card-head">
            <h2>Lifecycle</h2>
          </div>
          <div className="card-body problem-lifecycle-body">
            <span className="badge brand">{problem.stage}</span>
            <p className="subtle">
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
