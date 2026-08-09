import { databasePool } from "./db";
import { workspacePersistenceMode } from "./workspace-persistence";
import type { FeedbackType } from "./domain";
import { getMemoryProblemStages } from "./problem-automation-memory";
import {
  buildFeedbackWeekDescriptors,
  createEmptyOverviewAnalytics,
  OVERVIEW_WEEK_BUCKETS,
  overviewAnalytics,
  percentageChange,
  startOfUtcWeek,
  THEME_RANGE_OPTIONS,
  type AccountImpactRecord,
  type FeedbackWeekDescriptor,
  type OverviewAnalytics,
  type ThemeAnalyticsRecord,
  type ThemeRange,
} from "./overview-analytics";

export { OVERVIEW_WEEK_BUCKETS } from "./overview-analytics";

interface WeeklyRow { source: string; week_index: number; signal_count: number }
interface ThemeRow { theme: string; current_signals: number; previous_signals: number }
interface ThemeEventRow {
  theme: string;
  observed_at: string;
  created_at: Date | string;
}
interface ProblemRow {
  id: string; title: string; severity: string; stage: string; type: FeedbackType; product_area: string; team: string;
  current_signals: number; previous_signals: number; confidence: number; revenue: number; accounts: AccountImpactRecord[];
}
interface ResolutionRow {
  comparison_period: "current" | "previous";
  average_days: number;
}
interface FeedbackCountRow {
  total: number;
  awaiting_analysis: number;
}

export interface FeedbackEventRow {
  source: string;
  observed_at: string;
  created_at: Date | string;
}

const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1_000;
const DAY_IN_MS = 24 * 60 * 60 * 1_000;

function safeEventDate(
  row: Pick<FeedbackEventRow, "observed_at" | "created_at">,
): Date | null {
  const observedTimestamp = Date.parse(row.observed_at);
  if (Number.isFinite(observedTimestamp)) return new Date(observedTimestamp);
  const created =
    row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
  return Number.isFinite(created.getTime()) ? created : null;
}

/**
 * Buckets raw feedback into eight UTC calendar weeks. Parsing happens in
 * application code so a malformed source timestamp can never fail the
 * overview query; created_at is the durable fallback.
 */
export function buildFeedbackWeeklyRows(
  rows: FeedbackEventRow[],
  referenceDate = new Date(),
): WeeklyRow[] {
  const currentWeekStart = startOfUtcWeek(referenceDate);
  const windowStart = new Date(
    currentWeekStart.getTime() - (OVERVIEW_WEEK_BUCKETS - 1) * WEEK_IN_MS,
  );
  const windowEnd = new Date(currentWeekStart.getTime() + WEEK_IN_MS);
  const sources = [...new Set(rows.map((row) => row.source.trim()).filter(Boolean))].sort();
  const counts = new Map(
    sources.map((source) => [
      source,
      Array.from({ length: OVERVIEW_WEEK_BUCKETS }, () => 0),
    ]),
  );

  for (const row of rows) {
    const source = row.source.trim();
    const occurredAt = safeEventDate(row);
    if (!source || !occurredAt || occurredAt < windowStart || occurredAt >= windowEnd)
      continue;
    const index = Math.floor(
      (occurredAt.getTime() - windowStart.getTime()) / WEEK_IN_MS,
    );
    const sourceCounts = counts.get(source);
    if (sourceCounts && index >= 0 && index < OVERVIEW_WEEK_BUCKETS)
      sourceCounts[index] += 1;
  }

  return [...counts.entries()].flatMap(([source, values]) =>
    values.map((signal_count, index) => ({
      source,
      week_index: index + 1,
      signal_count,
    })),
  );
}

/** Builds emerging themes from reviewed feedback-to-problem memberships. */
export function buildReviewedThemeRows(
  rows: ThemeEventRow[],
  referenceDate = new Date(),
): ThemeRow[] {
  const currentWeekStart = startOfUtcWeek(referenceDate);
  const previousWeekStart = new Date(currentWeekStart.getTime() - WEEK_IN_MS);
  const currentWeekEnd = new Date(currentWeekStart.getTime() + WEEK_IN_MS);
  const counts = new Map<string, { current: number; previous: number }>();

  for (const row of rows) {
    const theme = row.theme.trim() || "Uncategorized";
    const occurredAt = safeEventDate(row);
    if (!occurredAt || occurredAt < previousWeekStart || occurredAt >= currentWeekEnd)
      continue;
    const value = counts.get(theme) ?? { current: 0, previous: 0 };
    if (occurredAt >= currentWeekStart) value.current += 1;
    else value.previous += 1;
    counts.set(theme, value);
  }

  return [...counts.entries()]
    .map(([theme, value]) => ({
      theme,
      current_signals: value.current,
      previous_signals: value.previous,
    }))
    .sort(
      (left, right) =>
        right.current_signals - left.current_signals ||
        right.previous_signals - left.previous_signals ||
        left.theme.localeCompare(right.theme),
    )
    .slice(0, 6);
}

/**
 * Compares a rolling period with the immediately preceding period of equal
 * length. Themes without a current-period signal are omitted because they are
 * declining history rather than emerging activity.
 */
export function buildReviewedThemeRowsForRange(
  rows: ThemeEventRow[],
  rangeDays: number,
  referenceDate = new Date(),
): ThemeRow[] {
  if (!Number.isInteger(rangeDays) || rangeDays < 1) {
    throw new RangeError("Theme range must be a positive whole number of days.");
  }

  const periodEnd = referenceDate.getTime();
  const currentStart = periodEnd - rangeDays * DAY_IN_MS;
  const previousStart = currentStart - rangeDays * DAY_IN_MS;
  const counts = new Map<string, { current: number; previous: number }>();

  for (const row of rows) {
    const theme = row.theme.trim() || "Uncategorized";
    const occurredAt = safeEventDate(row)?.getTime();
    if (
      occurredAt === undefined ||
      occurredAt < previousStart ||
      occurredAt > periodEnd
    ) {
      continue;
    }

    const value = counts.get(theme) ?? { current: 0, previous: 0 };
    if (occurredAt >= currentStart) value.current += 1;
    else value.previous += 1;
    counts.set(theme, value);
  }

  return [...counts.entries()]
    .map(([theme, value]) => ({
      theme,
      current_signals: value.current,
      previous_signals: value.previous,
    }))
    .filter((row) => row.current_signals > 0)
    .sort(
      (left, right) =>
        right.current_signals - left.current_signals ||
        right.previous_signals - left.previous_signals ||
        left.theme.localeCompare(right.theme),
    )
    .slice(0, 6);
}

function serializeThemes(rows: ThemeRow[]): ThemeAnalyticsRecord[] {
  return rows.map((row) => ({
    name: row.theme,
    currentSignals: row.current_signals,
    previousSignals: row.previous_signals,
    trend: percentageChange(row.current_signals, row.previous_signals),
  }));
}

export function buildOverviewAnalytics(input: {
  weeklyRows: WeeklyRow[];
  feedbackWeeks: FeedbackWeekDescriptor[];
  themeRows: ThemeRow[];
  themeRowsByRange?: Record<ThemeRange, ThemeRow[]>;
  problemRows: ProblemRow[];
  resolutionRows: ResolutionRow[];
  feedbackCount?: FeedbackCountRow;
}): OverviewAnalytics {
  const {
    weeklyRows,
    feedbackWeeks,
    themeRows,
    themeRowsByRange,
    problemRows,
    resolutionRows,
    feedbackCount = { total: 0, awaiting_analysis: 0 },
  } = input;
  if (
    weeklyRows.length === 0 &&
    themeRows.length === 0 &&
    problemRows.length === 0 &&
    resolutionRows.length === 0 &&
    feedbackCount.total === 0
  ) {
    const empty = createEmptyOverviewAnalytics();
    return {
      ...empty,
      feedbackWeeks,
      feedbackSeries: {
        "All sources": feedbackWeeks.map(() => 0),
      },
    };
  }

  const sourceNames = [...new Set(weeklyRows.map((row) => row.source))];
  const weekCount = Math.max(
    feedbackWeeks.length,
    weeklyRows.reduce(
      (maximum, row) => Math.max(maximum, row.week_index),
      0,
    ),
  );
  const feedbackSeries: Record<string, number[]> = Object.fromEntries(
    sourceNames.map((source) => {
      const values = Array.from({ length: weekCount }, () => 0);
      for (const row of weeklyRows) {
        if (row.source === source) values[row.week_index - 1] = row.signal_count;
      }
      return [source, values];
    }),
  );
  const allSources = Array.from({ length: weekCount }, (_, index) =>
    Object.values(feedbackSeries).reduce(
      (total, values) => total + (values[index] ?? 0),
      0,
    ),
  );
  feedbackSeries["All sources"] = allSources;
  const problems = problemRows.map((row) => ({
    id: row.id,
    title: row.title,
    severity: row.severity,
    stage: row.stage,
    type: row.type,
    productArea: [row.product_area, row.team].filter(Boolean).join(" · "),
    currentSignals: row.current_signals,
    previousSignals: row.previous_signals,
    membershipScores: [],
    accounts: Array.isArray(row.accounts) ? row.accounts : [],
    count: row.current_signals,
    revenue: row.revenue,
    confidence: Math.round(row.confidence * 100),
    trend: percentageChange(row.current_signals, row.previous_signals),
  }));
  const uniqueAccounts = new Map(problems.flatMap((problem) => problem.accounts).map((account) => [account.accountId, account]));
  const currentResolution = resolutionRows.find((row) => row.comparison_period === "current")?.average_days ?? 0;
  const previousResolution = resolutionRows.find((row) => row.comparison_period === "previous")?.average_days ?? 0;
  const currentFeedback = allSources.at(-1) ?? 0;
  const previousFeedback = allSources.length > 1 ? (allSources.at(-2) ?? 0) : 0;
  const visibleFeedbackTotal = allSources.reduce(
    (total, value) => total + value,
    0,
  );
  const themes = serializeThemes(themeRows);
  const themeRanges = themeRowsByRange
    ? Object.fromEntries(
        THEME_RANGE_OPTIONS.map(({ value }) => [
          value,
          serializeThemes(themeRowsByRange[value]),
        ]),
      ) as Record<ThemeRange, ThemeAnalyticsRecord[]>
    : undefined;
  return {
    feedbackSeries,
    feedbackWeeks,
    feedbackTotal: Math.max(feedbackCount.total, visibleFeedbackTotal),
    metrics: {
      newFeedback: currentFeedback,
      feedbackTrend: percentageChange(currentFeedback, previousFeedback),
      awaitingAnalysis: feedbackCount.awaiting_analysis,
      activeProblems: problems.filter((problem) => problem.stage !== "Closed").length, needsReview: problems.filter((problem) => problem.stage === "Needs review").length,
      affectedRevenue: [...uniqueAccounts.values()].reduce((total, account) => total + account.arr, 0), affectedAccounts: uniqueAccounts.size,
      averageResolutionDays: Number(currentResolution.toFixed(1)), resolutionImprovementDays: Number((previousResolution - currentResolution).toFixed(1)),
    },
    themes,
    themeRanges,
    problems,
  };
}

export async function getOverviewAnalytics(orgId: string): Promise<OverviewAnalytics> {
  if (workspacePersistenceMode(orgId) === "memory") {
    const stages = getMemoryProblemStages(orgId);
    return {
      ...overviewAnalytics,
      problems: overviewAnalytics.problems.map((problem) => ({
        ...problem,
        stage: stages.get(problem.id) ?? problem.stage,
      })),
    };
  }
  const pool = databasePool();
  const referenceDate = new Date();
  const [feedbackEventsResult, themeEventsResult, problemResult, resolutionResult, feedbackCountResult] = await Promise.all([
    pool.query<FeedbackEventRow>(
      `SELECT source,observed_at,created_at
       FROM feedback_items
       WHERE org_id=$1`,
      [orgId],
    ),
    pool.query<ThemeEventRow>(
      `SELECT coalesce(nullif(trim(problem.product_area),''),problem.title) AS theme,
              feedback.observed_at,feedback.created_at
       FROM feedback_cluster_memberships membership
       JOIN product_problems problem
         ON problem.org_id=membership.org_id AND problem.id=membership.problem_id
       JOIN feedback_items feedback
         ON feedback.org_id=membership.org_id AND feedback.id=membership.feedback_id
       WHERE membership.org_id=$1`,
      [orgId],
    ),
    pool.query<ProblemRow>(`SELECT p.id,p.title,p.severity,p.stage,
      coalesce(problem_type.type,'Question') AS type,p.product_area,p.team,
      coalesce(m.current_signals,members.signal_count,0)::int AS current_signals,
      coalesce(m.previous_signals,0)::int AS previous_signals,
      coalesce(conf.confidence,p.confidence,0)::float AS confidence,
      coalesce(impact.revenue,0)::int AS revenue,
      coalesce(impact.accounts,'[]'::jsonb) AS accounts
      FROM product_problems p
      LEFT JOIN problem_period_metrics m ON m.org_id=p.org_id AND m.problem_id=p.id
      LEFT JOIN LATERAL (
        SELECT count(*)::int signal_count
        FROM feedback_cluster_memberships f
        WHERE f.org_id=p.org_id AND f.problem_id=p.id
      ) members ON true
      LEFT JOIN LATERAL (SELECT avg(confidence)::float confidence FROM problem_confidence_evidence c WHERE c.org_id=p.org_id AND c.problem_id=p.id) conf ON true
      LEFT JOIN LATERAL (
        SELECT feedback.type
        FROM feedback_cluster_memberships membership
        JOIN feedback_items feedback
          ON feedback.org_id=membership.org_id AND feedback.id=membership.feedback_id
        WHERE membership.org_id=p.org_id AND membership.problem_id=p.id
        GROUP BY feedback.type
        ORDER BY count(*) DESC,feedback.type
        LIMIT 1
      ) problem_type ON true
      LEFT JOIN LATERAL (SELECT sum(a.arr) revenue,jsonb_agg(jsonb_build_object('accountId',a.id,'accountName',a.name,'arr',a.arr) ORDER BY a.arr DESC) accounts
        FROM problem_account_impacts i JOIN accounts a ON a.org_id=i.org_id AND a.id=i.account_id WHERE i.org_id=p.org_id AND i.problem_id=p.id) impact ON true
      WHERE p.org_id=$1
      ORDER BY coalesce(impact.revenue,0) DESC,p.updated_at DESC,p.id`, [orgId]),
    pool.query<ResolutionRow>("SELECT comparison_period,avg(duration_days)::float average_days FROM resolution_samples WHERE org_id=$1 GROUP BY comparison_period", [orgId]),
    pool.query<FeedbackCountRow>(`SELECT count(*)::int total,
      count(*) FILTER (WHERE NOT EXISTS (
        SELECT 1
        FROM feedback_cluster_memberships membership
        WHERE membership.org_id=feedback_items.org_id
          AND membership.feedback_id=feedback_items.id
      ))::int awaiting_analysis
      FROM feedback_items WHERE org_id=$1`, [orgId]),
  ]);
  const themeRowsByRange = Object.fromEntries(
    THEME_RANGE_OPTIONS.map(({ value, days }) => [
      value,
      buildReviewedThemeRowsForRange(
        themeEventsResult.rows,
        days,
        referenceDate,
      ),
    ]),
  ) as Record<ThemeRange, ThemeRow[]>;
  return buildOverviewAnalytics({
    weeklyRows: buildFeedbackWeeklyRows(feedbackEventsResult.rows, referenceDate),
    feedbackWeeks: buildFeedbackWeekDescriptors(referenceDate),
    themeRows: themeRowsByRange["30d"],
    themeRowsByRange,
    problemRows: problemResult.rows,
    resolutionRows: resolutionResult.rows,
    feedbackCount: feedbackCountResult.rows[0],
  });
}
