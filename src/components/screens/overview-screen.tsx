"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Filter } from "lucide-react";
import { FeedbackVolumeChart } from "../feedback-volume-chart";
import { CustomSelect } from "../custom-select";
import { formatTrend, THEME_RANGE_OPTIONS, type OverviewAnalytics, type ThemeRange } from "@/lib/overview-analytics";
import { EmptyWorkspaceState, PageTitle, arrFragment, compactMoney } from "./shared";

export function OverviewScreen({
  analytics,
  firstName,
  pendingApprovals = 0,
}: {
  analytics: OverviewAnalytics;
  firstName: string;
  organizationName: string;
  pendingApprovals?: number;
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
      metrics.affectedRevenue > 0 ? compactMoney(metrics.affectedRevenue) : "—",
      metrics.affectedRevenue > 0 ? `Across ${metrics.affectedAccounts} accounts` : "No revenue data",
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
          empty ? (
            <Link className="btn primary" href="/integrations">
              Connect feedback <ChevronRight size={14} />
            </Link>
          ) : pendingApprovals > 0 ? (
            <Link className="btn primary" href="/approvals">
              Review approvals <ChevronRight size={14} />
            </Link>
          ) : attentionProblems.length > 0 ? (
            <Link className="btn primary" href="/problems">
              Review issues <ChevronRight size={14} />
            </Link>
          ) : undefined
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
                      {problem.stage} · {problem.count} {problem.count === 1 ? "signal" : "signals"}{arrFragment(problem.revenue)}
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
