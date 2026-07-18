import { databasePool, persistenceMode } from "./db";
import { overviewAnalytics, percentageChange, type AccountImpactRecord, type OverviewAnalytics } from "./overview-analytics";

interface WeeklyRow { source: string; week_index: number; signal_count: number }
interface ThemeRow { theme: string; current_signals: number; previous_signals: number }
interface ProblemRow {
  id: string; title: string; severity: string; stage: string; product_area: string; team: string;
  current_signals: number; previous_signals: number; confidence: number; revenue: number; accounts: AccountImpactRecord[];
}

export async function getOverviewAnalytics(orgId: string): Promise<OverviewAnalytics> {
  if (persistenceMode() === "memory") return overviewAnalytics;
  const pool = databasePool();
  const [weeklyResult, themeResult, problemResult, resolutionResult] = await Promise.all([
    pool.query<WeeklyRow>("SELECT source,week_index,signal_count FROM weekly_signal_metrics WHERE org_id=$1 ORDER BY source,week_index", [orgId]),
    pool.query<ThemeRow>("SELECT theme,current_signals,previous_signals FROM theme_period_metrics WHERE org_id=$1 ORDER BY rank", [orgId]),
    pool.query<ProblemRow>(`SELECT p.id,p.title,p.severity,p.stage,p.product_area,p.team,m.current_signals,m.previous_signals,
      coalesce(conf.confidence,0)::float AS confidence,coalesce(impact.revenue,0)::int AS revenue,coalesce(impact.accounts,'[]'::jsonb) AS accounts
      FROM product_problems p JOIN problem_period_metrics m ON m.org_id=p.org_id AND m.problem_id=p.id
      LEFT JOIN LATERAL (SELECT avg(confidence)::float confidence FROM problem_confidence_evidence c WHERE c.org_id=p.org_id AND c.problem_id=p.id) conf ON true
      LEFT JOIN LATERAL (SELECT sum(a.arr) revenue,jsonb_agg(jsonb_build_object('accountId',a.id,'accountName',a.name,'arr',a.arr) ORDER BY a.arr DESC) accounts
        FROM problem_account_impacts i JOIN accounts a ON a.org_id=i.org_id AND a.id=i.account_id WHERE i.org_id=p.org_id AND i.problem_id=p.id) impact ON true
      WHERE p.org_id=$1 ORDER BY impact.revenue DESC`, [orgId]),
    pool.query<{ comparison_period: "current" | "previous"; average_days: number }>("SELECT comparison_period,avg(duration_days)::float average_days FROM resolution_samples WHERE org_id=$1 GROUP BY comparison_period", [orgId]),
  ]);
  if (!weeklyResult.rowCount || !problemResult.rowCount) throw new Error(`Overview analytics are not seeded for ${orgId}; run npm run db:seed`);

  const sourceNames = [...new Set(weeklyResult.rows.map((row) => row.source))];
  const feedbackSeries: Record<string, number[]> = Object.fromEntries(sourceNames.map((source) => [source, weeklyResult.rows.filter((row) => row.source === source).map((row) => row.signal_count)]));
  const allSources = Array.from({ length: 8 }, (_, index) => Object.values(feedbackSeries).reduce((total, values) => total + (values[index] ?? 0), 0));
  feedbackSeries["All sources"] = allSources;
  const problems = problemResult.rows.map((row) => ({
    id: row.id, title: row.title, severity: row.severity, stage: row.stage, productArea: `${row.product_area} · ${row.team}`,
    currentSignals: row.current_signals, previousSignals: row.previous_signals, membershipScores: [], accounts: row.accounts,
    count: row.current_signals, revenue: row.revenue, confidence: Math.round(row.confidence * 100), trend: percentageChange(row.current_signals, row.previous_signals),
  }));
  const uniqueAccounts = new Map(problems.flatMap((problem) => problem.accounts).map((account) => [account.accountId, account]));
  const currentResolution = resolutionResult.rows.find((row) => row.comparison_period === "current")?.average_days ?? 0;
  const previousResolution = resolutionResult.rows.find((row) => row.comparison_period === "previous")?.average_days ?? 0;
  return {
    feedbackSeries,
    feedbackTotal: allSources.reduce((total, value) => total + value, 0),
    metrics: {
      newFeedback: allSources.at(-1) ?? 0, feedbackTrend: percentageChange(allSources.at(-1) ?? 0, allSources.at(-2) ?? 0),
      activeProblems: problems.filter((problem) => problem.stage !== "Closed").length, needsReview: problems.filter((problem) => problem.stage === "Needs review").length,
      affectedRevenue: [...uniqueAccounts.values()].reduce((total, account) => total + account.arr, 0), affectedAccounts: uniqueAccounts.size,
      averageResolutionDays: Number(currentResolution.toFixed(1)), resolutionImprovementDays: Number((previousResolution - currentResolution).toFixed(1)),
    },
    themes: themeResult.rows.map((row) => ({ name: row.theme, currentSignals: row.current_signals, previousSignals: row.previous_signals, trend: percentageChange(row.current_signals, row.previous_signals) })),
    problems,
  };
}
