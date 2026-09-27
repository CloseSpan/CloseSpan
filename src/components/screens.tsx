"use client";

import {
  useCallback,
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
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  Boxes,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Database,
  ExternalLink,
  Filter,
  GitBranch,
  GripVertical,
  Info,
  LoaderCircle,
  MessageSquare,
  MonitorCheck,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { autonomyDescription, autonomyLevels, type AutonomyLevel } from "@/lib/autonomy-policy";
import type { DemoState } from "@/lib/store";
import { feedbackProblemTitle, normalizeProblemSubject } from "@/lib/problem-subject";
import { FeedbackVolumeChart } from "./feedback-volume-chart";
import { FitText } from "./fit-text";
import { CustomSelect } from "./custom-select";
import { IssueList, IssueViewControls } from "./issue-list";
import {
  CUSTOM_RETENTION_OPTION,
  CustomRetentionInput,
  initialRetentionSelection,
  isValidCustomRetention,
} from "./custom-retention-input";
import { IntegrationSyncStatus } from "./integration-sync-status";
import { PipedreamAccountManager } from "./pipedream-account-manager";
import { DiscordConnectionManager } from "./discord-connection-manager";
import { RetellConnectionManager } from "./retell-connection-manager";
import { IntegrationProviderIcon } from "./integration-provider-icon";
import { IntegrationCopilot } from "./integration-copilot";
import { IntegrationSuggestionsView } from "./integration-suggestions-view";
import {
  formatTrend,
  THEME_RANGE_OPTIONS,
  type OverviewAnalytics,
  type ThemeRange,
} from "@/lib/overview-analytics";
import { EMPTY_ISSUE_FILTERS, filterIssues, groupIssues, issueProductArea, type IssueFilters, type IssueGrouping } from "@/lib/issue-views";
import { isPipedreamConnectorId } from "@/lib/pipedream-connectors";
import { startGithubInstallationPopup } from "@/lib/github-installation-client";
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
import type { GithubRepositoryAuthorization } from "@/lib/github-repository-allowlist";
import type { PipedreamConnectState } from "./pipedream-connect-button";
import type { RecommendedConnector } from "@/lib/onboarding-repository";
import type { PromptDraftReadiness } from "@/lib/automated-prompt-draft-repository";
import {
  buildIntegrationSuggestions,
  type IntegrationActivityItem,
  type IntegrationInspectionMode,
  type IntegrationSuggestionPipedreamActivity,
} from "@/lib/integration-suggestions";
import type {
  CustomerView,
  IntegrationView,
  SettingsView,
} from "@/lib/workspace-repository";
import type {
  InvestigationVerificationMethod,
  InvestigationVerificationStatus,
  InvestigationWorkspaceItem,
} from "@/lib/investigation-repository";
import type { EngineeringWorkflowView } from "@/lib/engineering-workflow-repository";
import type { ProductProblemEvidenceBundle } from "@/lib/problem-evidence-bundle";
import {
  ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MS,
  ISSUE_RUNTIME_VERIFICATION_RUNNING_TIMEOUT_MS,
} from "@/lib/issue-runtime-verification-policy";
import type { IssueRuntimeVerificationRunView } from "@/lib/issue-runtime-verification";
import { investigationStatusCopy } from "@/lib/investigation-status-copy";
import { isProductCodeReference } from "@/lib/repository-path-policy";
import type { FinalExecutionApprovalView } from "@/lib/final-execution-repository";
import type {
  FeedbackType,
  FeedbackItem,
  ProductProblem,
  Stage,
} from "@/lib/domain";
import { announcePendingApprovalCountChange } from "@/lib/pending-approval-count-client";
import {
  isProductProblemStage,
  problemStageTransitionPreview,
  PRODUCT_PROBLEM_STAGES,
} from "@/lib/problem-stage-transition";
import {
  isProblemActiveWork,
  type ProblemActiveWork,
  type ProblemActiveWorkStatus,
} from "@/lib/problem-active-work";
import { useOptionalBackgroundPromptTests } from "./background-prompt-tests";
import { WORKSPACE_LABELS } from "@/lib/workspace-labels";
import {
  EngineeringPreparationSteps,
  engineeringPreparationSteps,
} from "./engineering-ticket-panel";

const money = (value: number) => `$${Math.round(value / 1000)}k`;
const compactMoney = (value: number) =>
  value >= 1_000_000
    ? `$${(value / 1_000_000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}m`
    : money(value);
const prioritizationStages = PRODUCT_PROBLEM_STAGES;
const problemViews = ["problems", "board"] as const;
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
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
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
}: {
  analytics: OverviewAnalytics;
  firstName: string;
  organizationName: string;
}) {
  const { metrics, problems } = analytics;
  const attentionProblems = problems.filter((problem) =>
    !problem.activeWork
    && problem.stage !== "Released"
    && problem.stage !== "Verified"
    && (problem.stage === "Needs review" || problem.confidence < 80),
  );
  const workingProblems = problems.filter((problem) => problem.activeWork);
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
      "Active issues",
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
        title={`Welcome, ${firstName}`}
        action={
          <Link className="btn primary" href={empty ? "/integrations" : "/approvals"}>
            {empty ? "Connect feedback" : "Review approvals"}{" "}
            <ChevronRight size={14} />
          </Link>
        }
      />
      {empty ? (
        <EmptyWorkspaceState
          title="Start with customer feedback"
          description="Connect a feedback source to start tracking customer issues."
          actionHref="/integrations"
          actionLabel="Connect a source"
        />
      ) : (
        <>
      <section className="card section-gap overview-attention-card">
        <div className="card-head">
          <div>
            <h2>Needs attention</h2>
          </div>
          <Link href="/problems" className="btn">
            View issues
          </Link>
        </div>
        <div className="overview-attention-list">
          {attentionProblems.length ? [...attentionProblems]
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
                  ? "Review issue"
                  : problem.confidence < 80
                    ? "Check evidence"
                    : "View issue";
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
                <strong>No issues need review</strong>
                <p>Check Action approvals for any pending execution or release decisions.</p>
              </div>
            )}
        </div>
      </section>
      {workingProblems.length > 0 && (
        <section className="card section-gap">
          <div className="card-head">
            <div>
              <h2>In progress</h2>
            </div>
            <Link className="btn" href="/agent-runs">View agent activity</Link>
          </div>
          <div className="overview-attention-list">
            {workingProblems.slice(0, 4).map((problem) => (
              <Link className="overview-attention-row overview-progress-row" href={`/problems/${problem.id}`} key={problem.id}>
                <span className="overview-attention-copy"><strong>{problem.title}</strong></span>
                <span className="badge">{problem.activeWork?.status}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
      <section className="overview-insights section-gap" aria-label="Analytics and trends">
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
          kind: "success",
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
          <span className="badge">
            {openAnalysis?.classification ?? openFeedback.type}
          </span>
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
            <Link className="btn primary" href={`/problems/${linkedProblemId}#evidence`}>
              Open {linkedProblemTitle} <ChevronRight size={14} />
            </Link>
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
              className="btn primary"
              disabled={busy}
              onClick={() => void classify([openFeedback.id])}
            >
              <Sparkles size={14} /> {busy ? "Analyzing…" : "Analyze again"}
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void classify([openFeedback.id])}
            >
              <Sparkles size={14} /> {busy ? "Analyzing…" : `Analyze with ${providerLabel}`}
            </button>
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
          {proposedAnalyses.length > 0 && <span className="badge brand" role="status">{proposedAnalyses.length} needs review</span>}
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
                    <span className="badge">{item.source}</span>
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
  activeWork = [],
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
  const [draggedProblemId, setDraggedProblemId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<Stage | null>(null);
  const [transitionRequest, setTransitionRequest] =
    useState<TransitionRequest | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [transitionError, setTransitionError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const lastTriggerRef = useRef<HTMLElement | null>(null);

  const boardProblems = useMemo(
    () =>
      problems.flatMap((problem) => {
        const stage = manualStages[problem.id] ?? problem.stage;
        return isProductProblemStage(stage) ? [{ ...problem, stage }] : [];
      }) as BoardProblem[],
    [manualStages, problems],
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

  const activeWorkByProblem = useMemo(() => {
    const values = new Map(
      activeWork.map((item) => [item.problemId, item.status]),
    );
    for (const task of backgroundPromptTests?.tasks ?? []) {
      if (task.status === "running") {
        values.set(task.problemId, promptTaskStatus(task.phase));
      }
    }
    return values;
  }, [activeWork, backgroundPromptTests?.tasks]);

  const draggedProblem = draggedProblemId
    ? boardProblems.find((problem) => problem.id === draggedProblemId)
    : undefined;
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
      <div className="board" aria-label={`Issues by ${grouping === "productArea" ? "product area" : grouping}`}>
        {groupIssues(boardProblems, grouping, grouping === "stage").map(({ key, issues: stageProblems }) => {
          const stage = grouping === "stage" && isProductProblemStage(key) ? key : null;
          const isDropTarget = stage !== null && dropTarget === stage && draggedProblem?.stage !== stage;
          return (
            <section
              className={`board-col${isDropTarget ? " is-drop-target" : ""}`}
              key={key}
              aria-label={key}
              data-stage={stage ?? undefined}
              onDragOver={(event) => {
                if (!stage || !draggedProblem || draggedProblem.stage === stage) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTarget(stage);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                  setDropTarget(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDropTarget(null);
                if (draggedProblem && stage) openTransition(draggedProblem, stage);
              }}
            >
              <div className="board-head">
                <span className="board-stage-dot" aria-hidden="true" />
                <strong>{key}</strong>
                <span className="board-stage-count">{stageProblems.length}</span>
              </div>
              {stageProblems.length === 0 ? (
                <p className="problem-board-empty">
                  {isDropTarget ? "Drop to review move" : "No issues"}
                </p>
              ) : (
                stageProblems.map((problem) => {
                  const workStatus = activeWorkByProblem.get(problem.id);
                  const currentIndex = prioritizationStages.indexOf(problem.stage);
                  const suggestedStage =
                    currentIndex < prioritizationStages.length - 1
                      ? prioritizationStages[currentIndex + 1]
                      : prioritizationStages[currentIndex - 1];
                  return (
                    <article
                      className={`problem-card problem-card-shell${draggedProblemId === problem.id ? " is-dragging" : ""}`}
                      draggable={grouping === "stage"}
                      key={problem.id}
                      onDragStart={(event) => {
                        setDraggedProblemId(problem.id);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", problem.id);
                      }}
                      onDragEnd={() => {
                        setDraggedProblemId(null);
                        setDropTarget(null);
                      }}
                    >
                      {grouping === "stage" && <span className="problem-card-drag-indicator" aria-hidden="true">
                        <GripVertical size={15} />
                      </span>}
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
                        {grouping !== "stage" && <span className="badge issue-card-stage">{problem.stage}</span>}
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
  const issues = useMemo(() => analytics.problems.map((problem) => (
    stageOverrides[problem.id] ? { ...problem, stage: stageOverrides[problem.id] } : problem
  )), [analytics.problems, stageOverrides]);
  const visibleIssues = useMemo(() => filterIssues(issues, filters), [issues, filters]);
  const [activeWork, setActiveWork] = useState<ProblemActiveWork[]>(() =>
    analytics.problems.flatMap((problem) =>
      problem.activeWork ? [problem.activeWork] : [],
    ),
  );

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
          description="There are no issues to prioritize yet."
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
              <span className="subtle">Affected impact: {money(problem.revenue)} ARR across {problem.count} signals.</span>
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

function pddQueueTone(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized.includes("approval") || normalized.includes("execution")) return "success";
  if (normalized.includes("needed") || normalized.includes("required")) return "high";
  return "medium";
}

type PddRankMode = "readiness" | "revenue" | "signals" | "severity";
type PddReadinessFilter = "all" | "ready" | "preparing" | "active" | "approval";

const pddSeverityRank: Record<string, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

function pddPreparationState(input: {
  investigation?: InvestigationWorkspaceItem;
  workflow?: EngineeringWorkflowView;
  repositoryReady: boolean;
}) {
  const { investigation, workflow, repositoryReady } = input;
  const actionApprovalReady = Boolean(
    workflow?.run
      || workflow?.approval?.status === "Pending"
      || workflow?.approval?.status === "Approved",
  );
  const acceptanceReady = Boolean(
    actionApprovalReady || workflow?.verification?.status === "Ready for approval",
  );
  const promptReady = Boolean(
    workflow?.prompt && workflow.specification && workflow.readiness.ready,
  );
  const review = workflow?.promptEvaluation?.review;
  const promptAligned = Boolean(
    acceptanceReady
      || (review?.verdict === "Passed"
        && (!review.promptHash || review.promptHash === workflow?.prompt?.contentHash)),
  );
  const steps = engineeringPreparationSteps({
    repositoryProfileReady: repositoryReady,
    promptReady,
    promptAligned,
    acceptanceReady,
    approvalReady: actionApprovalReady,
  });
  const completed = steps.filter((step) => step.state === "complete").length;
  const evaluating = workflow?.promptEvaluation?.status === "Running";
  const issueVerified = investigation?.verification.status === "Confirmed current";
  const runtimeVerificationActive = investigation?.runtimeVerification?.status === "Queued"
    || investigation?.runtimeVerification?.status === "Running";
  const readyToTest = Boolean(issueVerified && repositoryReady && promptReady && !promptAligned && !evaluating);
  const category: Exclude<PddReadinessFilter, "all"> = !issueVerified
    ? "preparing"
    : actionApprovalReady
      ? "approval"
      : evaluating || promptAligned
        ? "active"
        : readyToTest
          ? "ready"
          : "preparing";
  const label = !investigation
    ? "Investigation required"
    : !issueVerified
      ? runtimeVerificationActive ? "Runtime verification running" : "Issue verification required"
      : category === "approval"
        ? "Approval ready"
        : category === "active"
          ? evaluating ? "Evaluating prompt" : "Acceptance preparation"
          : category === "ready"
            ? "Ready to prompt-test"
            : !repositoryReady
              ? "Repository setup required"
              : "Preparing prompt";
  const readinessBucket = category === "ready"
    ? 0
    : category === "active"
      ? 1
      : category === "preparing"
        ? 2
        : 3;
  return {
    steps,
    completed,
    category,
    label,
    readinessBucket,
    hasInvestigation: Boolean(investigation),
    issueVerified,
    runtimeVerificationActive,
  };
}

export function PddPrioritizationScreen({
  problems,
  investigations,
  workflows,
  repositoryReadyByProblem,
}: {
  problems: OverviewAnalytics["problems"];
  investigations: InvestigationWorkspaceItem[];
  workflows: Record<string, EngineeringWorkflowView>;
  repositoryReadyByProblem: Record<string, boolean>;
}) {
  const [rankMode, setRankMode] = useState<PddRankMode>("readiness");
  const [readinessFilter, setReadinessFilter] = useState<PddReadinessFilter>("all");
  const rows = useMemo(() => problems.map((problem) => {
    const investigation = investigations.find((item) => item.problemId === problem.id);
    return {
      problem,
      preparation: pddPreparationState({
        investigation,
        workflow: workflows[problem.id],
        repositoryReady: repositoryReadyByProblem[problem.id] ?? false,
      }),
    };
  }), [investigations, problems, repositoryReadyByProblem, workflows]);
  const visibleRows = useMemo(() => {
    const filtered = readinessFilter === "all"
      ? rows
      : rows.filter((row) => row.preparation.category === readinessFilter);
    return [...filtered].sort((left, right) => {
      if (rankMode === "revenue") return right.problem.revenue - left.problem.revenue;
      if (rankMode === "signals") return right.problem.count - left.problem.count;
      if (rankMode === "severity") {
        return (pddSeverityRank[right.problem.severity] ?? 0)
          - (pddSeverityRank[left.problem.severity] ?? 0)
          || right.problem.revenue - left.problem.revenue;
      }
      return left.preparation.readinessBucket - right.preparation.readinessBucket
        || right.preparation.completed - left.preparation.completed
        || right.problem.revenue - left.problem.revenue;
    });
  }, [rankMode, readinessFilter, rows]);

  return (
    <>
      <PageTitle
        title={WORKSPACE_LABELS.pdd}
        action={
          <div className="pdd-list-controls">
            <CustomSelect
              ariaLabel="Filter Prompt Testing tasks by readiness"
              value={readinessFilter}
              onValueChange={(value) => setReadinessFilter(value as PddReadinessFilter)}
              options={[
                { value: "all", label: "All statuses" },
                { value: "ready", label: "Ready to test" },
                { value: "preparing", label: "Needs preparation" },
                { value: "active", label: "Testing" },
                { value: "approval", label: "Ready for approval" },
              ]}
            />
            <CustomSelect
              ariaLabel="Sort Prompt Testing tasks"
              value={rankMode}
              onValueChange={(value) => setRankMode(value as PddRankMode)}
              options={[
                { value: "readiness", label: "Sort: readiness" },
                { value: "revenue", label: "Sort: affected revenue" },
                { value: "signals", label: "Sort: report count" },
                { value: "severity", label: "Sort: severity" },
              ]}
            />
          </div>
        }
      />

      <section className="pdd-priority-workspace">
        <div className="pdd-priority-head">
          <div>
            <h2>Test queue</h2>
            <p>{visibleRows.length === 1 ? "1 issue" : `${visibleRows.length} issues`}</p>
          </div>
          <span className="badge brand">{rows.filter((row) => row.preparation.category === "ready").length} ready to test</span>
        </div>

        {visibleRows.length ? (
          <ol className="pdd-priority-list">
            {visibleRows.map(({ problem, preparation }, index) => (
              <li key={problem.id}>
                <Link
                  className="pdd-priority-row"
                  href={`/pdd/${encodeURIComponent(problem.id)}#engineering-ticket`}
                >
                  <div className="pdd-priority-row-head">
                    <span className="prioritization-rank" aria-label={`Rank ${index + 1}`}>{index + 1}</span>
                    <div className="pdd-priority-copy">
                      <div className="pdd-priority-title">
                        <h3>{problem.title}</h3>
                        <span className={`badge ${pddQueueTone(preparation.label)}`}>{preparation.label}</span>
                      </div>
                      <p>
                        {problem.productArea} · {problem.severity} severity · {compactMoney(problem.revenue)} ARR · {problem.count} signal{problem.count === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span className="pdd-priority-open">
                      Open task
                      <ChevronRight size={15} aria-hidden="true" />
                    </span>
                  </div>
                  <div className="pdd-priority-tracker" aria-label={`${problem.title} preparation progress`}>
                    <EngineeringPreparationSteps steps={preparation.steps} />
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <div className="empty pdd-priority-empty">
            <strong>{rows.length ? "No matching tasks" : "No issues to test"}</strong>
            <p>
              {rows.length
                ? "Try another status or clear the filter."
                : "Review an issue to prepare its prompt."}
            </p>
            {rows.length ? (
              <button className="btn" type="button" onClick={() => setReadinessFilter("all")}>Clear filter</button>
            ) : (
              <Link className="btn" href="/problems">View issues</Link>
            )}
          </div>
        )}
      </section>
    </>
  );
}

export function PddScreen({
  problems,
  investigations,
  workflows,
  selectedProblemId,
  engineeringPanel,
}: {
  problems: OverviewAnalytics["problems"];
  investigations: InvestigationWorkspaceItem[];
  workflows: Record<string, EngineeringWorkflowView>;
  selectedProblemId: string | null;
  engineeringPanel?: React.ReactNode;
}) {
  const selectedProblem = problems.find((item) => item.id === selectedProblemId);
  const selected = investigations.find((item) => item.problemId === selectedProblemId);
  const selectedIssueVerified = selected?.verification.status === "Confirmed current";
  const selectedRuntimeVerificationActive = selected?.runtimeVerification?.status === "Queued"
    || selected?.runtimeVerification?.status === "Running";
  const selectedWorkflow = selectedProblemId ? workflows[selectedProblemId] : undefined;

  if (!selectedProblem) {
    return (
      <>
        <PageTitle
          title={WORKSPACE_LABELS.pdd}
        />
        <EmptyWorkspaceState
          title="Nothing is ready for Prompt Testing"
          description="Choose an issue to review its prompt."
          actionHref="/problems"
          actionLabel="View issues"
        />
      </>
    );
  }

  const currentPhase = !selectedWorkflow?.prompt
    ? 0
    : selectedWorkflow.approval || selectedWorkflow.verification?.status === "Ready for approval"
      ? 2
      : 1;
  const phases = ["Prompt preparation", "Prompt evaluation", "Approval readiness"];

  return (
    <>
      <PageTitle
        title={WORKSPACE_LABELS.pdd}
        action={
          <Link className="btn" href="/pdd">
            <ChevronLeft size={14} aria-hidden="true" /> Back to Prompt Testing
          </Link>
        }
      />

      <div className="pdd-task-workspace">
        <div className="pdd-detail-stack">
          <section className="card pdd-selected-context">
            <div>
              <h2>{selectedProblem.title}</h2>
              <p>{selectedProblem.productArea} · {selectedProblem.severity} severity · {money(selectedProblem.revenue)} ARR</p>
            </div>
            <Link className="text-link" href={`/problems/${encodeURIComponent(selectedProblem.id)}#investigation`}>
              View issue <ChevronRight size={13} aria-hidden="true" />
            </Link>
          </section>
          <nav className="pdd-phase-rail card" aria-label="Prompt Testing preparation phases">
            {phases.map((phase, index) => (
              <span
                className={`pdd-phase is-${index < currentPhase ? "complete" : index === currentPhase ? "current" : "upcoming"}`}
                aria-current={index === currentPhase ? "step" : undefined}
                key={phase}
              >
                <span className="pdd-phase-marker" aria-hidden="true">
                  {index < currentPhase ? <Check size={13} /> : index + 1}
                </span>
                <strong>{phase}</strong>
              </span>
            ))}
          </nav>

          {selected && selectedIssueVerified ? (
            engineeringPanel
          ) : (
            <section className="card pdd-investigation-gate">
              <div className="card-head">
                <div>
                  <h2>{!selected
                    ? "Investigation required"
                    : selectedRuntimeVerificationActive
                      ? "Runtime verification in progress"
                      : selected.verification.status === "Verification blocked"
                        ? "Current issue verification blocked"
                        : "Current issue verification required"}</h2>
                  <p className="subtle">{!selected
                    ? "Confirm the problem hypothesis and evidence boundary before testing an implementation prompt."
                    : selectedRuntimeVerificationActive
                      ? "CloseSpan is checking the reported behavior. Prompt testing will unlock when the current issue is confirmed."
                      : selected.verification.status === "Verification blocked"
                        ? "Prompt testing is paused because the last verification could not confirm or disprove the reported behavior. Resolve the recorded blocker, then run verification again."
                        : "Reproduce the reported behavior and record the result before testing an implementation prompt."}</p>
                </div>
                <span className="badge high">Blocked</span>
              </div>
              <div className="card-body">
                <Link className="btn primary" href={`/problems/${encodeURIComponent(selectedProblem.id)}#investigation`}>
                  {selectedRuntimeVerificationActive
                    ? "View runtime verification"
                    : selected?.verification.status === "Verification blocked"
                      ? "Resolve verification blocker"
                      : "View issue"}
                  <ChevronRight size={14} aria-hidden="true" />
                </Link>
              </div>
            </section>
          )}
        </div>
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
  problemTitles,
  initialEngineeringWorkflows,
  orgId,
  canApprove: allowApproval = true,
  initialApprovalId,
  requirementReviews = [],
  reviewStorageReady = true,
  presentationDemo = false,
}: {
  problem: ProductProblem | null;
  problemTitles: Record<string, string>;
  initialEngineeringWorkflows: EngineeringWorkflowView[];
  orgId: string;
  canApprove?: boolean;
  initialApprovalId?: string;
  requirementReviews?: Array<{ problemId: string; title: string; needsHelp: boolean }>;
  reviewStorageReady?: boolean;
  presentationDemo?: boolean;
}) {
  const router = useRouter();
  const canApprove = allowApproval && !presentationDemo;
  const demoNotice = presentationDemo
    ? <p className="subtle"><span className="badge">Demo · sample data</span> Read-only decisions. No live work is running.</p> : null;
  const [localWorkflows, setLocalWorkflows] = useState({ source: initialEngineeringWorkflows, rows: initialEngineeringWorkflows });
  const engineeringWorkflows = localWorkflows.source === initialEngineeringWorkflows ? localWorkflows.rows : initialEngineeringWorkflows;
  const approvalItems: ApprovalItem[] = engineeringWorkflows.flatMap((workflow) => [
    workflow.approval
      ? { key: `engineering:${workflow.approval.id}`, kind: "engineering" as const, workflow }
      : null,
    workflow.finalApproval
      ? { key: `final:${workflow.finalApproval.id}`, kind: "final" as const, workflow }
      : null,
  ].filter(Boolean) as ApprovalItem[]);
  const initialPendingItems = approvalItems.filter((item) =>
    item.kind === "engineering"
      ? item.workflow.approval?.status === "Pending"
      : item.workflow.finalApproval?.status === "Pending",
  );
  const requestedItem = approvalItems.find((item) => (item.kind === "engineering" ? item.workflow.approval?.id : item.workflow.finalApproval?.id) === initialApprovalId);
  const initialTab: ApprovalTab = requestedItem && !initialPendingItems.includes(requestedItem) ? "history" : "pending";
  const initialSelected = requestedItem?.key ?? initialPendingItems[0]?.key ?? "";
  const [localTab, setLocalTab] = useState({ requestId: initialApprovalId, value: initialTab });
  const [localSelected, setLocalSelected] = useState({ requestId: initialApprovalId, value: initialSelected });
  const selected = localSelected.requestId === initialApprovalId ? localSelected.value : initialSelected;
  const selectedRecord = approvalItems.find((item) => item.key === selected);
  const selectedStatus = selectedRecord?.kind === "engineering"
    ? selectedRecord.workflow.approval?.status : selectedRecord?.workflow.finalApproval?.status;
  const tab: ApprovalTab = selectedRecord ? selectedStatus === "Pending" ? "pending" : "history"
    : localTab.requestId === initialApprovalId ? localTab.value : initialTab;
  const setTab = (value: ApprovalTab) => setLocalTab({ requestId: initialApprovalId, value });
  const setSelected = (value: string) => setLocalSelected({ requestId: initialApprovalId, value });
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
  const selectedItem = visibleItems.find((item) => item.key === selected) ?? (!selected ? visibleItems[0] : undefined);
  const engineeringWorkflow = selectedItem?.workflow ?? null;
  const engineeringApproval = engineeringWorkflow?.approval;
  const finalApproval = engineeringWorkflow?.finalApproval;
  const selectedKind = selectedItem?.kind;
  const approvalBlockReason = selectedItem ? pendingApprovalBlockReason(selectedItem) : null;

  useEffect(() => {
    if (presentationDemo) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible" && !busy) router.refresh();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [busy, router, presentationDemo]);

  function replaceWorkflow(next: EngineeringWorkflowView) {
    setLocalWorkflows({ source: initialEngineeringWorkflows,
      rows: engineeringWorkflows.map((workflow) => workflow.problemId === next.problemId ? next : workflow) });
  }

  function selectTab(nextTab: ApprovalTab) {
    const nextItems = nextTab === "pending" ? pendingItems : historyItems;
    setTab(nextTab);
    if (!nextItems.some((item) => item.key === selected)) {
      setSelected(nextItems[0]?.key ?? "");
    }
    setNotice(undefined);
  }

  const domainReviews = <>
    {!reviewStorageReady && <p className="toast error" role="alert">Some reviews are unavailable. Ask an administrator to finish review setup.</p>}
    {requirementReviews.length > 0 && <section className="card review-inbox" aria-label="Issue reviews">
      {requirementReviews.map((item) => <Link className="review-inbox-row" href={`/problems/${item.problemId}`} key={item.problemId}>
        <strong>{item.title}</strong>
        <span className={`badge ${item.needsHelp ? "medium" : "brand"}`}>{item.needsHelp ? "Needs attention" : "Confirm expected behavior"}</span>
        <ChevronRight size={16} aria-hidden="true" />
      </Link>)}
    </section>}
  </>;

  const unavailableApprovalId = initialApprovalId && !requestedItem ? initialApprovalId
    : selected && !selectedRecord ? selected.slice(selected.indexOf(":") + 1) : null;
  if (unavailableApprovalId) {
    return <>
      <PageTitle title={WORKSPACE_LABELS.approvals} />
      {demoNotice}
      <section className="card approval-detail-empty">
        <h2>Decision unavailable</h2>
        <p>This decision is no longer in the current review list. Open its record to see the original decision.</p>
        <div className="top-actions">
          <Link className="btn" href={`/approvals/${encodeURIComponent(unavailableApprovalId)}`}>View decision record</Link>
          <Link className="btn" href="/approvals">View current reviews</Link>
          <Link className="text-link" href="/problems">View issues</Link>
        </div>
      </section>
    </>;
  }

  if (approvalItems.length === 0) {
    return (
      <>
        <PageTitle title={WORKSPACE_LABELS.approvals} />
        {demoNotice}
        {domainReviews}
        {!requirementReviews.length && <section className="card approval-detail-empty">
          <h2>{reviewStorageReady ? "Nothing needs your review" : "Reviews unavailable"}</h2>
          <Link className="btn" href="/problems">View issues</Link>
        </section>}
      </>
    );
  }
  async function decideEngineering(action: "approve" | "reject") {
    if (!engineeringApproval || !canApprove || busy) return;
    if (!selectedItem) return;
    const blocked = pendingApprovalBlockReason(selectedItem);
    if (action === "approve" && blocked) { setNotice({ kind: "error", text: blocked }); return; }
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
      announcePendingApprovalCountChange(-1);
      setTab("history");
      setSelected(selectedItem.key);
      setNotice({
        kind: "success",
        text:
          action === "approve"
            ? "Coding run approved and queued."
            : "Coding run rejected.",
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
    if (!finalApproval || !canApprove || busy) return;
    if (!selectedItem) return;
    const blocked = pendingApprovalBlockReason(selectedItem);
    if (action === "approve" && blocked) { setNotice({ kind: "error", text: blocked }); return; }
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
      announcePendingApprovalCountChange(-1);
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
              ? payload.approval.attempt?.failureMessage ?? "The approved action could not complete."
              : payload.approval.attempt?.status === "Queued"
                ? "Approved and queued."
                : "Approved."
            : finalApproval.executionAction === "deploy" ? "Deployment rejected." : "Merge rejected. The PR is unchanged.",
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

  const itemTitle = (item: ApprovalItem) =>
    problemTitles[item.workflow.problemId] ?? "Issue";

  const itemAction = (item: ApprovalItem) => item.kind === "engineering"
    ? "Coding run"
    : `${item.workflow.finalApproval?.executionAction === "deploy" ? "Deploy" : "Merge"} PR #${item.workflow.finalApproval?.pullRequestNumber ?? ""}`;

  const itemStatus = (item: ApprovalItem) => {
    if (pendingApprovalBlockReason(item)) return "Needs attention";
    if (item.kind === "engineering") return item.workflow.approval?.status ?? "Pending";
    if (item.kind === "final") {
      return item.workflow.finalApproval?.attempt?.status ?? item.workflow.finalApproval?.status ?? "Pending";
    }
    return "Pending";
  };

  return (
    <>
      <PageTitle title={WORKSPACE_LABELS.approvals} />
      {demoNotice}
      {tab === "pending" && domainReviews}
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
      <div className={`approval-layout approval-compact${visibleItems.length ? "" : " is-empty"}`}>
        {visibleItems.length ? (
          <section className="card approval-queue-card" aria-label={tab === "pending" ? "Pending approvals" : "Approval history"}>
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
                      {itemAction(item)} · {item.kind === "engineering"
                        ? item.workflow.approval?.repository
                        : item.workflow.finalApproval?.repository}
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
          </section>
        ) : null}
        {visibleItems.length ? (
          <section
            className="card approval-detail-card"
            id={`approval-${selectedKind === "engineering" ? engineeringApproval?.id : finalApproval?.id}`}
          >
            {selectedKind === "engineering" && engineeringApproval && engineeringWorkflow ? (
              <>
                <div className="card-head">
                  <div>
                    <h2>Coding run</h2>
                    <p className="subtle approval-destination">{engineeringApproval.repository} · {engineeringApproval.baseBranch}</p>
                  </div>
                  <span
                    className={`badge ${engineeringApproval.status === "Approved" ? "success" : ["Rejected", "Expired", "Superseded"].includes(engineeringApproval.status) ? "high" : "medium"}`}
                  >
                    {selectedItem ? itemStatus(selectedItem) : engineeringApproval.status}
                  </span>
                </div>
                <div className="card-body approval-summary">
                  {engineeringApproval.status === "Pending" ? (
                    <>
                      {approvalBlockReason && <p className="callout warning" role="alert">{approvalBlockReason}</p>}
                      <p>One isolated coding run. Merge and deployment need separate approval.</p>
                      <p className="subtle approval-expiry">Expires {new Date(engineeringApproval.expiresAt).toLocaleString()}</p>
                      <Link className="text-link" href={`/problems/${engineeringWorkflow.problemId}`}>View issue <ChevronRight size={14} aria-hidden="true" /></Link>
                      {!canApprove && !presentationDemo && <p role="status">An administrator must approve this action.</p>}
                      <div className="approval-actions">
                        <button
                          type="button"
                          className="btn danger"
                          disabled={!canApprove || busy !== null}
                          onClick={() => decideEngineering("reject")}
                        >
                          {busy === selectedItem?.key ? "Recording…" : "Reject run"}
                        </button>
                        <button
                          type="button"
                          className="btn primary"
                          disabled={!canApprove || busy !== null || Boolean(approvalBlockReason)}
                          onClick={() => decideEngineering("approve")}
                        >
                          {busy === selectedItem?.key ? "Queueing run…" : "Approve one run"} <Check size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="approval-result-actions">
                      {engineeringWorkflow.run ? (
                        <Link className="btn" href={`/agent-runs/${engineeringWorkflow.run.id}`}>
                          View result
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
                    <h2>{finalApproval.executionAction === "deploy" ? "Deploy" : "Merge"} PR #{finalApproval.pullRequestNumber}</h2>
                    <p className="subtle approval-destination">{finalApproval.repository} · {finalApproval.baseBranch}{finalApproval.targetEnvironment ? ` · ${finalApproval.targetEnvironment}` : ""}</p>
                  </div>
                  <span
                    className={`badge ${finalApproval.attempt?.status === "Succeeded" || finalApproval.status === "Approved" ? "success" : finalApproval.attempt?.status === "Failed" || finalApproval.status === "Rejected" || finalApproval.status === "Superseded" ? "high" : "medium"}`}
                  >
                    {selectedItem ? itemStatus(selectedItem) : finalApproval.status}
                  </span>
                </div>
                <div className="card-body approval-summary">
                  {finalApproval.status === "Pending" || finalApproval.attempt?.status === "Failed" ? (
                    <>
                      <p>Only the reviewed commit will be {finalApproval.executionAction === "deploy" ? "deployed" : "merged"}.</p>
                      <p className="subtle">{finalApproval.testSummary.passed} tests passed · {finalApproval.acceptanceSummary.passed} acceptance checks passed</p>
                      {presentationDemo && <Link className="text-link" href={`/agent-runs/${finalApproval.agentRunId}`}>View sample result <ChevronRight size={14} aria-hidden="true" /></Link>}
                      {!presentationDemo && <a className="text-link" href={`${finalApproval.pullRequestUrl}/commits/${finalApproval.headSha}`} target="_blank" rel="noreferrer">Review changes <ExternalLink size={14} aria-hidden="true" /></a>}
                      {finalApproval.autoDeployOnMerge || finalApproval.executionAction === "deploy" ? (
                        <div className="callout warning" role="note">
                          <strong>{finalApproval.executionAction === "deploy" ? "This will deploy to production." : "Merging this PR will automatically deploy to production."}</strong>
                        </div>
                      ) : null}
                      {finalApproval.remainingRisks.length ? (
                        <div className="callout warning">
                          <strong>Remaining risks</strong>
                          <ul>{finalApproval.remainingRisks.map((risk) => <li key={risk}>{risk}</li>)}</ul>
                        </div>
                      ) : null}
                      {finalApproval.rollbackPlan ? <p><strong>Rollback:</strong> {finalApproval.rollbackPlan}</p> : null}
                    </>
                  ) : null}
                  {finalApproval.releaseVerification?.scopeAssessment.compatible === false ? (
                    <div className="callout warning" role="alert">
                      <div className="callout-title">Verification scope changed</div>
                      <p>The changes need new verification before approval.</p>
                      <ul>
                        {finalApproval.releaseVerification.scopeAssessment.mismatches.map((mismatch) => (
                          <li key={mismatch}>{mismatch}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {approvalBlockReason && finalApproval.releaseVerification?.scopeAssessment.compatible !== false
                    ? <p className="callout warning" role="alert">{approvalBlockReason}</p> : null}
                  {finalApproval.status === "Pending" ? (
                    <>
                    {!canApprove && !presentationDemo && <p role="status">An administrator must approve this action.</p>}
                    <div className="approval-actions">
                      <button
                        type="button"
                        className="btn danger"
                        disabled={!canApprove || busy !== null}
                        onClick={() => decideFinalExecution("reject")}
                      >
                        {busy === selectedItem?.key ? "Recording…" : finalApproval.executionAction === "deploy" ? "Reject deployment" : "Reject merge"}
                      </button>
                      {approvalBlockReason && (
                        <Link className="btn primary" href={`/problems/${finalApproval.problemId}`}>
                          View issue
                          <ChevronRight size={14} />
                        </Link>
                      )}
                      <button
                        type="button"
                        className="btn primary"
                        disabled={!canApprove || busy !== null || Boolean(approvalBlockReason)}
                        onClick={() => decideFinalExecution("approve")}
                      >
                        {busy === selectedItem?.key
                          ? "Queueing execution…"
                          : finalApproval.executionAction === "deploy"
                            ? "Approve production deployment"
                            : "Approve and merge PR"}
                        {busy !== selectedItem?.key ? <Check size={14} /> : null}
                      </button>
                    </div>
                    </>
                  ) : (
                    <div className="approval-result-actions">
                      {finalApproval.attempt?.status === "Failed" ? (
                        <p className="callout warning" role="alert">
                          {finalApproval.executionAction === "deploy" ? "Deployment" : "Merge"} failed: {finalApproval.attempt.failureMessage}
                        </p>
                      ) : finalApproval.status === "Superseded" || finalApproval.status === "Expired" ? (
                        <p className="callout warning">
                          {finalApproval.status === "Superseded" ? "The reviewed PR changed. A new approval is required." : "This approval expired. A new approval is required."}
                        </p>
                      ) : null}
                      <div className="top-actions">
                        {finalApproval.status === "Approved" && finalApproval.attempt?.status === "Failed" ? (
                          <button
                            type="button"
                            className="btn primary"
                            disabled={!canApprove || busy !== null}
                            onClick={() => decideFinalExecution("approve")}
                          >
                            {busy === selectedItem?.key ? "Queueing retry…" : finalApproval.executionAction === "deploy" ? "Retry approved deployment" : "Retry approved merge"}
                          </button>
                        ) : null}
                        {!presentationDemo && <a
                          className="btn"
                          href={finalApproval.pullRequestUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open pull request
                        </a>}
                        <Link className="btn" href={`/agent-runs/${finalApproval.agentRunId}`}>
                          View result
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
            <h2>{tab === "pending" ? requirementReviews.length ? "No merge or coding approvals" : "Nothing needs your review" : "No decisions yet"}</h2>
            <Link className="btn" href="/problems">
              View issues
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

function pendingApprovalBlockReason(item: ApprovalItem, now = Date.now()): string | null {
  const { workflow } = item;
  const approval = item.kind === "engineering" ? workflow.approval : workflow.finalApproval;
  // A failed, approved execution can receive fresh authorization through its retry action.
  if (!approval || approval.status !== "Pending") return null;
  if (!(Date.parse(approval.expiresAt) > now)) return "This approval expired. Open the issue for a new review.";
  const codingApproval = workflow.approval;
  const prompt = workflow.prompt;
  const currentPrompt = prompt && codingApproval && prompt.status !== "Superseded"
    && prompt.contentHash === codingApproval.promptHash
    && prompt.repository === codingApproval.repository
    && prompt.baseBranch === codingApproval.baseBranch
    && prompt.baseSha === codingApproval.baseSha;
  if (!currentPrompt) return "This approval does not match the current expected behavior. Open the issue for a new review.";
  if (item.kind === "final") {
    const finalApproval = workflow.finalApproval!;
    if (codingApproval.status !== "Approved" || workflow.run?.approvalId !== codingApproval.id
      || finalApproval.agentRunId !== workflow.run?.id || finalApproval.problemId !== workflow.problemId
      || finalApproval.repository !== codingApproval.repository || finalApproval.baseBranch !== codingApproval.baseBranch) {
      return "This approval does not match the current result. Open the issue for a new review.";
    }
    if (finalApproval.releaseVerification?.scopeAssessment.compatible === false) {
      return "The changes need new verification before approval.";
    }
  }
  return null;
}

function IntegrationProgressDrawer({
  activity,
  connected,
  githubBusy,
  integrationId,
  onConnectGithub,
  onViewDetails,
}: {
  activity: IntegrationActivityItem | null;
  connected: boolean;
  githubBusy: boolean;
  integrationId: string;
  onConnectGithub: () => void;
  onViewDetails: () => void;
}) {
  const github = integrationId === "int_github";
  const title = activity?.title ?? (github ? "Connecting GitHub" : "Connection in progress");
  const description = activity?.description ??
    "CloseSpan is checking the connection. You can keep working while it finishes.";

  return (
    <div className="integration-progress-view">
      <section className="integration-progress-current" aria-live="polite">
        <span className="integration-progress-current-icon" aria-hidden="true">
          <LoaderCircle className="spin" size={18} />
        </span>
        <div>
          <span>In progress</span>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </section>

      {github && (
        <ol className="integration-progress-steps" aria-label="GitHub connection progress">
          <li className={connected ? "complete" : "current"}>
            <span aria-hidden="true">{connected ? <Check size={15} /> : "1"}</span>
            <div>
              <strong>Select repository access</strong>
              <p>
                {connected
                  ? "GitHub returned the repositories approved for this workspace."
                  : "Choose the repositories CloseSpan may inspect, test, and use for approved pull requests."}
              </p>
            </div>
          </li>
          <li className={connected ? "current" : "upcoming"}>
            <span aria-hidden="true">2</span>
            <div>
              <strong>Build repository context</strong>
            </div>
          </li>
          <li className="upcoming">
            <span aria-hidden="true">3</span>
            <div>
              <strong>Prepare runtime verification</strong>
            </div>
          </li>
        </ol>
      )}

      <div className="integration-progress-actions">
        {github && (
          <button
            className="btn primary"
            type="button"
            disabled={githubBusy}
            onClick={onConnectGithub}
          >
            {githubBusy
              ? "Opening GitHub…"
              : connected
                ? "Manage repositories"
                : "Finish repository selection"}
          </button>
        )}
        <button className="btn" type="button" onClick={onViewDetails}>
          View connection details
        </button>
      </div>
    </div>
  );
}

export function IntegrationsScreen({
  integrations,
  githubRepositories,
  orgId,
  focusedIntegrationId = null,
  productName,
  recommendedConnectors,
  initialIntegrationActivity,
  initialView,
  discordCallbackStatus = null,
  discordCallbackReason = null,
}: {
  integrations: IntegrationView[];
  githubRepositories: GithubRepositoryAuthorization[];
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
  discordCallbackStatus?: string | null;
  discordCallbackReason?: string | null;
}) {
  const router = useRouter();
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
  const [githubBusy, setGithubBusy] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const githubConnectionRef = useRef<AbortController | null>(null);
  const githubConnectionMounted = useRef(true);
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
  >(focusedIntegrationId);
  const [integrationDrawerMode, setIntegrationDrawerMode] =
    useState<IntegrationInspectionMode>("details");
  const connectedGithubRepositories = useMemo(
    () =>
      githubRepositories.filter(
        (repository) => repository.active && repository.workspaceSelected,
      ),
    [githubRepositories],
  );

  useEffect(() => {
    githubConnectionMounted.current = true;
    return () => {
      githubConnectionMounted.current = false;
      githubConnectionRef.current?.abort();
    };
  }, [orgId]);

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
    const connectedFromIntegration =
      observedConnectionState === undefined
        ? connectedIds.includes(item.id)
        : observedConnectionState === "Connected";
    const connected =
      item.id === "int_github" && !demonstration
        ? connectedGithubRepositories.length > 0
        : connectedFromIntegration;
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
  const connectedConnectionCount = connectorRows.filter(
    (row) => row.connected,
  ).length;
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
  const selectedProgressActivity = suggestionItems.find(
    (item) =>
      item.integrationId === selectedIntegrationId && item.section === "Working",
  ) ?? null;
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

  function openIntegrationDetails(
    integrationId: string,
    mode: IntegrationInspectionMode = "details",
  ) {
    if (!selectedIntegrationId) {
      integrationDrawerTriggerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    setIntegrationDrawerMode(mode);
    setSelectedIntegrationId(integrationId);
    if (integrationId === "int_github") setGithubError(null);
  }

  async function connectGithub() {
    if (githubBusy || githubConnectionRef.current) return;
    const controller = new AbortController();
    githubConnectionRef.current = controller;
    setGithubBusy(true);
    setGithubError(null);
    try {
      await startGithubInstallationPopup(orgId, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setSelectedIntegrationId(null);
      router.push("/integrations?view=connections&focus=int_github&select=repositories");
      router.refresh();
    } catch (caught) {
      if (!controller.signal.aborted) {
        setGithubError(
          caught instanceof Error
            ? caught.message
            : "GitHub connection could not be started",
        );
      }
    } finally {
      if (githubConnectionRef.current === controller) {
        githubConnectionRef.current = null;
        if (githubConnectionMounted.current) setGithubBusy(false);
      }
    }
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
              <span>{connectedConnectionCount}</span>
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
          key={`${selectedRow.item.id}-${integrationDrawerMode}`}
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
              <div>
                <span>{selectedRow.experience.filter}</span>
                <h2 id="integration-drawer-title">
                  {integrationDrawerMode === "progress"
                    ? `${selectedRow.item.name} progress`
                    : selectedRow.connected
                      ? selectedRow.item.name
                      : `Connect ${selectedRow.item.name}`}
                </h2>
              </div>
              <button ref={integrationDrawerCloseRef} type="button" className="icon-button" aria-label="Close connector details" onClick={() => setSelectedIntegrationId(null)}><X size={18} /></button>
            </div>
            {githubBusy && selectedRow.item.id === "int_github" && (
              <button className="btn" type="button" onClick={() => githubConnectionRef.current?.abort()}>
                Cancel GitHub connection
              </button>
            )}
            {githubError && selectedRow.item.id === "int_github" && integrationDrawerMode === "progress" && (
              <p className="github-connection-message error" role="alert">{githubError}</p>
            )}
            {integrationDrawerMode === "progress" ? (
              <IntegrationProgressDrawer
                activity={selectedProgressActivity}
                connected={selectedRow.connected}
                githubBusy={githubBusy}
                integrationId={selectedRow.item.id}
                onConnectGithub={() => void connectGithub()}
                onViewDetails={() => setIntegrationDrawerMode("details")}
              />
            ) : (
              <div className="integration-drawer-content">
                <p className="integration-drawer-summary">{selectedRow.experience.summary}</p>
                <section className="integration-drawer-section">
                  <h3>Data CloseSpan will use</h3>
                  <ul>{selectedRow.experience.importedData.map((value) => <li key={value}><Check size={14} aria-hidden="true" />{value}</li>)}</ul>
                </section>
                <section className="integration-drawer-section">
                  <h3>{selectedRow.item.id === "int_retell" ? "Access used" : "Permissions requested"}</h3>
                  <ul>{selectedRow.experience.requestedPermissions.map((value) => <li key={value}><ShieldCheck size={14} aria-hidden="true" />{value}</li>)}</ul>
                  <p>{selectedRow.item.id === "int_retell" ? "Only call-reading operations are enabled. Your API key’s permissions remain managed in Retell." : "CloseSpan requests least-privilege access. Agent actions still require your approval."}</p>
                </section>
                {selectedRow.connected && selectedRow.item.id !== "int_retell" && selectedRow.item.permissions.length > 0 && (
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
                <div className="integration-github-access">
                  {selectedRow.connected ? (
                    <>
                      <div className="integration-github-repository-summary">
                        <div>
                          <strong>Connected repositories</strong>
                          <span className="badge success">
                            {connectedGithubRepositories.length}
                          </span>
                        </div>
                        <p>
                          CloseSpan can use these repositories for testing and
                          approved pull requests.
                        </p>
                      </div>
                      <ul
                        className="integration-github-repository-list"
                        aria-label="Connected GitHub repositories"
                      >
                        {connectedGithubRepositories.map((repository) => (
                          <li key={repository.id}>
                            <GitBranch size={16} aria-hidden="true" />
                            <div>
                              <strong>{repository.repository}</strong>
                              <span>Default branch: {repository.defaultBranch}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <div className="integration-github-setup-copy">
                      <p>
                        CloseSpan uses its GitHub App so you choose the exact
                        repositories available for testing and approved pull requests.
                      </p>
                      <p>
                        Already installed? Keep the repository selected and click
                        <strong> Save</strong> in GitHub to sync it with this workspace.
                      </p>
                    </div>
                  )}
                  <button
                    className="btn primary"
                    type="button"
                    disabled={githubBusy}
                    onClick={() => void connectGithub()}
                  >
                    {githubBusy
                      ? "Opening GitHub…"
                      : selectedRow.connected
                        ? "Manage repositories"
                        : "Select repositories"}
                  </button>
                  {githubError && (
                    <div className="github-connection-message error" role="alert">
                      {githubError}
                    </div>
                  )}
                </div>
              ) : selectedRow.item.id === "int_discord" ? (
                <DiscordConnectionManager
                  orgId={orgId}
                  callbackStatus={discordCallbackStatus}
                  callbackReason={discordCallbackReason}
                  onConnectionStateChange={(nextState) =>
                    updateConnectionState(selectedRow.item.id, nextState)
                  }
                />
              ) : selectedRow.item.id === "int_retell" ? (
                <RetellConnectionManager
                  orgId={orgId}
                  onConnectionStateChange={(nextState) => updateConnectionState(selectedRow.item.id, nextState)}
                  onImportComplete={(completedAt) => setLastSyncOverrides((previous) => ({ ...previous, int_retell: completedAt }))}
                />
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
          title={WORKSPACE_LABELS["follow-up"]}
        />
        <EmptyWorkspaceState
          title="No follow-up workflow exists"
          description="Customer drafts become available after an issue is reviewed and its resolution is verified."
          actionHref={problem ? `/problems/${problem.id}` : "/feedback"}
          actionLabel={problem ? "View issue" : "Open feedback inbox"}
        />
      </>
    );
  }
  const activeProblem = problem;
  const prepared = state.notifications !== "Not drafted";
  const verified = ["Verified", "Closed"].includes(state.problemStage);
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
        title={WORKSPACE_LABELS["follow-up"]}
        action={
          <span className={`badge ${verified ? "success" : prepared ? "brand" : ""}`}>
            {verified
              ? "Verified resolution"
              : prepared
                ? "Follow-up prepared"
                : "Waiting for agent merge"}
          </span>
        }
      />
      {!prepared ? (
        <section className="card empty-state">
          <ShieldCheck size={28} />
          <h2>No drafts ready yet</h2>
          <p className="subtle">
            CloseSpan prepares affected-customer drafts after its approved pull
            request is merged. Approval and sending remain locked until release
            verification succeeds.
          </p>
          <Link className="btn primary" href={`/problems/${problem.id}`}>
            View issue
          </Link>
        </section>
      ) : (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>{problem.title}</h2>
              <p className="subtle">
                {verified
                  ? "Verified release · deployment evidence recorded"
                  : "Agent PR merged · awaiting release verification"}
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
                    {verified
                      ? `Hi ${customer.customer}, we’ve resolved ${problem.title.toLowerCase()}. The verified fix is now available.`
                      : `Hi ${customer.customer}, we’re preparing an update about ${problem.title.toLowerCase()}. This draft will be finalized after release verification.`}
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
              disabled={
                busy ||
                !verified ||
                affected.length === 0 ||
                state.notifications === "Approved"
              }
              onClick={approveDrafts}
            >
              {!verified
                ? "Awaiting release verification"
                : state.notifications === "Approved"
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
              <th>Open issues</th>
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
          <a href="#usage">Usage limits</a>
        </nav>
        <div className="detail-stack">
          <section className="card" id="agent">
            <div className="card-head">
              <div>
                <h2>Agent autonomy</h2>
              </div>
            </div>
            <div className="card-body">
              <div className="field">
                <span>Autonomy level</span>
                <CustomSelect
                  ariaLabel="Autonomy level"
                  value={autonomy}
                  options={[...autonomyLevels]}
                  onValueChange={(value) => {
                    setAutonomy(value as AutonomyLevel);
                    setSaved(false);
                  }}
                />
                <span className="subtle">{autonomyDescription(autonomy as AutonomyLevel)}</span>
              </div>
              <div className="callout section-gap-sm">
                <div className="callout-title">Execution boundary</div>
                <p className="subtle">
                  {autonomy === "Full autonomy" || autonomy === "Automatic coding, human merge"
                    ? "Agent codes automatically under workspace policy. A human approves every merge or deployment."
                    : autonomy === "Execute with approval"
                      ? "A human must approve the Tenki run and the commit-locked merge or deployment."
                      : "Tenki runs, merge, and deployment are blocked at this level."}
                </p>
              </div>
            </div>
          </section>
          <section className="card" id="model">
            <div className="card-head">
              <div>
                <h2>AI model</h2>
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
  investigation,
}: {
  problem: OverviewAnalytics["problems"][number];
  promptDraftReadiness: PromptDraftReadiness;
  investigation?: InvestigationWorkspaceItem;
}) {
  const signalConfidenceHelpId = useId();
  const promptThresholdHelpId = useId();
  const relatedSignalsHelpId = useId();
  const evidenceNeededHelpId = useId();
  const recommendedChecksHelpId = useId();
  const investigationPercent = promptDraftReadiness.investigationConfidence === null
    ? null
    : Math.round(promptDraftReadiness.investigationConfidence * 100);
  const requiredPercent = Math.round(promptDraftReadiness.requiredConfidence * 100);
  const promptAlreadyCreated = promptDraftReadiness.hasExistingWorkflow;
  const issueVerified = promptDraftReadiness.verificationStatus === "Confirmed current";
  const needsInvestigationReview = investigationPercent === null || investigationPercent < requiredPercent;
  const promptBlockedReason = !issueVerified
    ? promptDraftReadiness.reason
    : promptAlreadyCreated
    ? "The suggested prompt is ready in Prompt Testing. Review the investigation below before continuing to testing."
    : needsInvestigationReview
      ? investigationPercent === null
        ? "Complete the investigation before generating a prompt."
        : "Review the open evidence gaps below before generating a prompt."
      : promptDraftReadiness.reason;
  const confidenceFactors = promptDraftReadiness.signalConfidenceFactors;
  const cogneeAssisted = confidenceFactors?.cogneeRetrieved === true;
  const confidenceFactorRows = [
    [cogneeAssisted ? "Semantic match (Cognee-assisted)" : "Semantic match", confidenceFactors?.clusterMatch ?? null, 0.65],
    ["Evidence quality", confidenceFactors?.evidenceQuality ?? null, 0.2],
    ["Low ambiguity", confidenceFactors?.lowAmbiguity ?? null, 0.15],
  ] as const;
  const investigationUpdatedAt = investigation ? new Date(investigation.updatedAt) : null;
  const investigationUpdatedLabel = !investigationUpdatedAt || Number.isNaN(investigationUpdatedAt.getTime())
    ? "Awaiting investigation"
    : `Updated ${investigationUpdatedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  return (
    <>
      <PageTitle
        eyebrow={`Issue · ${problem.id.replace("prob_", "CS-").toUpperCase()}`}
        title={problem.title}
        action={<div className="page-title-actions">
          <Link className="btn" href="/problems">
            <ChevronLeft size={14} aria-hidden="true" /> Back to issues
          </Link>
          <span className={`badge ${problem.severity.toLowerCase()}`}>
            {problem.severity}
          </span>
        </div>}
      />
      <section className="card prompt-readiness-card">
          <div className="card-head">
            <div>
              <h2>Available evidence</h2>
            </div>
            <div className="investigation-detail-status">
              <span className={`badge ${investigation ? investigationStatusTone(investigation.status) : "high"}`}>
                {investigation ? investigationStatusLabel(investigation.status) : "Not started"}
              </span>
              <span className="subtle">{investigationUpdatedLabel}</span>
            </div>
          </div>
          <div className="card-body detail-stack">
            <p className="summary">
              This cluster has {problem.count} related signals representing{" "}
              {money(problem.revenue)} in affected ARR.
            </p>
            <div className="prompt-readiness-grid" aria-label="Prompt drafting confidence">
              <div className="prompt-readiness-metric">
                <strong>{problem.confidence}%</strong>
                <span className="prompt-readiness-metric-label">
                  Signal match confidence
                  <span className="investigation-metric-help">
                    <button
                      type="button"
                      className="investigation-metric-help-trigger"
                      aria-label="What signal match confidence means"
                      aria-describedby={signalConfidenceHelpId}
                    >
                      <Info size={14} aria-hidden="true" />
                    </button>
                    <span
                      id={signalConfidenceHelpId}
                      role="tooltip"
                      className="investigation-metric-tooltip"
                    >
                      <strong className="prompt-tooltip-title">Signal evaluation</strong>
                      <span className="prompt-tooltip-breakdown">
                        {confidenceFactorRows.map(([label, score, weight]) => (
                          <span className="prompt-tooltip-row" key={label}>
                            <span>{label}</span>
                            <span>
                              {score === null
                                ? `Not stored × ${Math.round(weight * 100)}%`
                                : `${Math.round(score * 100)}% × ${Math.round(weight * 100)}% = `}
                              {score !== null && (
                                <strong>{Math.round(score * weight * 100)} pts</strong>
                              )}
                            </span>
                          </span>
                        ))}
                        <span className="prompt-tooltip-total">
                          <span>Total</span>
                          <strong>{problem.confidence}%</strong>
                        </span>
                      </span>
                      {!confidenceFactors && (
                        <span className="prompt-tooltip-note">
                          This older record stores only the final score; new evaluations retain
                          each factor.
                        </span>
                      )}
                      {cogneeAssisted && (
                        <span className="prompt-tooltip-note">
                          Cognee retrieved the accepted problem
                          {confidenceFactors.cogneeBestRank
                            ? ` at rank ${confidenceFactors.cogneeBestRank}`
                            : ""}. CloseSpan independently evaluated the semantic fit and applied
                          the weights shown above.
                        </span>
                      )}
                      <span className="prompt-tooltip-note">
                        This evaluates the initial report, not the number of similar reports.
                      </span>
                    </span>
                  </span>
                </span>
              </div>
              <div className="prompt-readiness-metric prompt-readiness-threshold">
                <strong>{requiredPercent}%</strong>
                <span className="prompt-readiness-metric-label">
                  Required for prompt drafting
                  <span className="investigation-metric-help">
                    <button
                      type="button"
                      className="investigation-metric-help-trigger"
                      aria-label="What the prompt drafting requirement means"
                      aria-describedby={promptThresholdHelpId}
                    >
                      <Info size={14} aria-hidden="true" />
                    </button>
                    <span
                      id={promptThresholdHelpId}
                      role="tooltip"
                      className="investigation-metric-tooltip prompt-readiness-tooltip-end"
                    >
                      <strong className="prompt-tooltip-title">Prompt drafting gates</strong>
                      <span className="prompt-tooltip-breakdown">
                        <span className="prompt-tooltip-row">
                          <span>Confidence</span>
                          <strong>{requiredPercent}% minimum</strong>
                        </span>
                        <span className="prompt-tooltip-row">
                          <span>Linked evidence</span>
                          <strong>
                            {promptDraftReadiness.evidenceCount} / {promptDraftReadiness.requiredEvidence}
                          </strong>
                        </span>
                        <span className="prompt-tooltip-row">
                          <span>Investigation</span>
                          <strong>{promptDraftReadiness.hasInvestigation ? "Present" : "Required"}</strong>
                        </span>
                        <span className="prompt-tooltip-row">
                          <span>Current issue</span>
                          <strong>{issueVerified ? "Confirmed" : "Verification required"}</strong>
                        </span>
                        <span className="prompt-tooltip-row">
                          <span>Repository</span>
                          <strong>{promptDraftReadiness.repositoryReady ? "Confirmed" : "Required"}</strong>
                        </span>
                      </span>
                      <span className="prompt-tooltip-note">
                        All gates must pass before a prompt can be generated.
                      </span>
                    </span>
                  </span>
                </span>
              </div>
              <div className="prompt-readiness-metric">
                <strong>{investigation?.relatedSignalCount ?? problem.count}</strong>
                <span className="prompt-readiness-metric-label">
                  Related signals
                  <span className="investigation-metric-help">
                    <button
                      type="button"
                      className="investigation-metric-help-trigger"
                      aria-label="What related signals means"
                      aria-describedby={relatedSignalsHelpId}
                    >
                      <Info size={14} aria-hidden="true" />
                    </button>
                    <span id={relatedSignalsHelpId} role="tooltip" className="investigation-metric-tooltip">
                      Customer reports linked to this issue.
                    </span>
                  </span>
                </span>
              </div>
              <div className="prompt-readiness-metric">
                <strong>{investigation?.missingInformation.length ?? "—"}</strong>
                <span className="prompt-readiness-metric-label">
                  Evidence still needed
                  <span className="investigation-metric-help">
                    <button
                      type="button"
                      className="investigation-metric-help-trigger"
                      aria-label="What evidence still needed means"
                      aria-describedby={evidenceNeededHelpId}
                    >
                      <Info size={14} aria-hidden="true" />
                    </button>
                    <span id={evidenceNeededHelpId} role="tooltip" className="investigation-metric-tooltip">
                      Open evidence gaps that should be resolved before treating the hypothesis as confirmed.
                    </span>
                  </span>
                </span>
              </div>
              <div className="prompt-readiness-metric">
                <strong>{investigation?.recommendedTests.length ?? "—"}</strong>
                <span className="prompt-readiness-metric-label">
                  Recommended checks
                  <span className="investigation-metric-help">
                    <button
                      type="button"
                      className="investigation-metric-help-trigger"
                      aria-label="What recommended checks means"
                      aria-describedby={recommendedChecksHelpId}
                    >
                      <Info size={14} aria-hidden="true" />
                    </button>
                    <span
                      id={recommendedChecksHelpId}
                      role="tooltip"
                      className="investigation-metric-tooltip prompt-readiness-tooltip-end"
                    >
                      Proposed verification checks from the investigation. These have not been completed yet.
                    </span>
                  </span>
                </span>
              </div>
            </div>
            <div className={`callout prompt-readiness-callout ${issueVerified && (promptDraftReadiness.canGenerate || promptAlreadyCreated) ? "success" : "warning"}`}>
              <div className="callout-title">
                {!issueVerified
                  ? "Current issue verification required"
                  : promptAlreadyCreated
                  ? "Suggested prompt created"
                  : promptDraftReadiness.canGenerate
                    ? "Ready to create a suggested prompt"
                    : needsInvestigationReview
                      ? "Investigation required"
                      : "Prompt context needs review"}
              </div>
              <p className="subtle" id="prompt-generation-status">
                {promptBlockedReason}
              </p>
            </div>
          </div>
      </section>
    </>
  );
}
