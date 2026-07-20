import { databasePool, persistenceMode } from "./db";
import {
  createEmptyOverviewAnalytics,
  overviewAnalytics,
  percentageChange,
  type AccountImpactRecord,
  type OverviewAnalytics,
} from "./overview-analytics";

interface WeeklyRow { source: string; week_index: number; signal_count: number }
interface ThemeRow { theme: string; current_signals: number; previous_signals: number }
interface ProblemRow {
  id: string; title: string; severity: string; stage: string; product_area: string; team: string;
  current_signals: number; previous_signals: number; confidence: number; revenue: number; accounts: AccountImpactRecord[];
}
interface ResolutionRow {
  comparison_period: "current" | "previous";
  average_days: number;
}
interface FeedbackCountRow {
  total: number;
  recent: number;
}

export function buildOverviewAnalytics(input: {
  weeklyRows: WeeklyRow[];
  themeRows: ThemeRow[];
  problemRows: ProblemRow[];
  resolutionRows: ResolutionRow[];
  feedbackCount?: FeedbackCountRow;
}): OverviewAnalytics {
  const {
    weeklyRows,
    themeRows,
    problemRows,
    resolutionRows,
    feedbackCount = { total: 0, recent: 0 },
  } = input;
  if (
    weeklyRows.length === 0 &&
    themeRows.length === 0 &&
    problemRows.length === 0 &&
    resolutionRows.length === 0 &&
    feedbackCount.total === 0
  ) {
    return createEmptyOverviewAnalytics();
  }

  const sourceNames = [...new Set(weeklyRows.map((row) => row.source))];
  const weekCount = weeklyRows.reduce(
    (maximum, row) => Math.max(maximum, row.week_index),
    0,
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
  const currentFeedback = allSources.at(-1) ?? feedbackCount.recent;
  const previousFeedback = allSources.length > 1 ? (allSources.at(-2) ?? 0) : 0;
  return {
    feedbackSeries,
    feedbackTotal:
      allSources.length > 0
        ? allSources.reduce((total, value) => total + value, 0)
        : feedbackCount.total,
    metrics: {
      newFeedback: currentFeedback,
      feedbackTrend: percentageChange(currentFeedback, previousFeedback),
      activeProblems: problems.filter((problem) => problem.stage !== "Closed").length, needsReview: problems.filter((problem) => problem.stage === "Needs review").length,
      affectedRevenue: [...uniqueAccounts.values()].reduce((total, account) => total + account.arr, 0), affectedAccounts: uniqueAccounts.size,
      averageResolutionDays: Number(currentResolution.toFixed(1)), resolutionImprovementDays: Number((previousResolution - currentResolution).toFixed(1)),
    },
    themes: themeRows.map((row) => ({ name: row.theme, currentSignals: row.current_signals, previousSignals: row.previous_signals, trend: percentageChange(row.current_signals, row.previous_signals) })),
    problems,
  };
}

export async function getOverviewAnalytics(orgId: string): Promise<OverviewAnalytics> {
  if (persistenceMode() === "memory") return overviewAnalytics;
  const pool = databasePool();
  const [weeklyResult, themeResult, problemResult, resolutionResult, feedbackCountResult] = await Promise.all([
    pool.query<WeeklyRow>("SELECT source,week_index,signal_count FROM weekly_signal_metrics WHERE org_id=$1 ORDER BY source,week_index", [orgId]),
    pool.query<ThemeRow>("SELECT theme,current_signals,previous_signals FROM theme_period_metrics WHERE org_id=$1 ORDER BY rank", [orgId]),
    pool.query<ProblemRow>(`SELECT p.id,p.title,p.severity,p.stage,p.product_area,p.team,
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
      LEFT JOIN LATERAL (SELECT sum(a.arr) revenue,jsonb_agg(jsonb_build_object('accountId',a.id,'accountName',a.name,'arr',a.arr) ORDER BY a.arr DESC) accounts
        FROM problem_account_impacts i JOIN accounts a ON a.org_id=i.org_id AND a.id=i.account_id WHERE i.org_id=p.org_id AND i.problem_id=p.id) impact ON true
      WHERE p.org_id=$1
      ORDER BY coalesce(impact.revenue,0) DESC,p.updated_at DESC,p.id`, [orgId]),
    pool.query<ResolutionRow>("SELECT comparison_period,avg(duration_days)::float average_days FROM resolution_samples WHERE org_id=$1 GROUP BY comparison_period", [orgId]),
    pool.query<FeedbackCountRow>(`SELECT count(*)::int total,
      count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int recent
      FROM feedback_items WHERE org_id=$1`, [orgId]),
  ]);
  return buildOverviewAnalytics({
    weeklyRows: weeklyResult.rows,
    themeRows: themeResult.rows,
    problemRows: problemResult.rows,
    resolutionRows: resolutionResult.rows,
    feedbackCount: feedbackCountResult.rows[0],
  });
}
