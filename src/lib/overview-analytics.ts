import { otherProblems, primaryProblem } from "./seed";

export interface AccountImpactRecord { accountId: string; accountName: string; arr: number }
export interface ProblemAnalyticsRecord {
  id: string; title: string; severity: string; stage: string; productArea: string;
  currentSignals: number; previousSignals: number; membershipScores: number[]; accounts: AccountImpactRecord[];
}

export interface OverviewAnalytics {
  feedbackSeries: Record<string, number[]>;
  metrics: { newFeedback: number; feedbackTrend: number | null; activeProblems: number; needsReview: number; affectedRevenue: number; affectedAccounts: number; averageResolutionDays: number; resolutionImprovementDays: number };
  themes: Array<{ name: string; currentSignals: number; previousSignals: number; trend: number | null }>;
  problems: Array<ProblemAnalyticsRecord & { count: number; revenue: number; confidence: number; trend: number | null }>;
  feedbackTotal: number;
}

const weeklySignals = {
  Intercom: [16, 21, 18, 27, 23, 31, 29, 36],
  Zendesk: [14, 18, 16, 22, 21, 28, 25, 32],
  Slack: [7, 9, 8, 12, 11, 15, 13, 17],
  Surveys: [5, 7, 6, 7, 7, 9, 9, 9],
} as const;

const problemRecords: ProblemAnalyticsRecord[] = [
  { id: primaryProblem.id, title: primaryProblem.title, severity: primaryProblem.severity, stage: primaryProblem.stage, productArea: "Analytics exports · Data Experience", currentSignals: 3, previousSignals: 2, membershipScores: [0.91, 0.94, 0.91], accounts: [
    { accountId: "acct_northstar", accountName: "Northstar Labs", arr: 184000 }, { accountId: "acct_acme", accountName: "Acme Health", arr: 142000 }, { accountId: "acct_atlas", accountName: "Atlas Cloud", arr: 68000 },
  ] },
  { id: otherProblems[0].id, title: otherProblems[0].title, severity: otherProblems[0].severity, stage: otherProblems[0].stage, productArea: "Platform experience", currentSignals: 7, previousSignals: 5, membershipScores: [0.82, 0.86, 0.9], accounts: [
    { accountId: "acct_luma", accountName: "Luma Systems", arr: 124000 }, { accountId: "acct_nova", accountName: "Nova Commerce", arr: 92000 },
  ] },
  { id: otherProblems[1].id, title: otherProblems[1].title, severity: otherProblems[1].severity, stage: otherProblems[1].stage, productArea: "Platform experience", currentSignals: 4, previousSignals: 3, membershipScores: [0.96, 0.93, 0.94], accounts: [
    { accountId: "acct_apex", accountName: "Apex Financial", arr: 220000 }, { accountId: "acct_meridian", accountName: "Meridian AI", arr: 168000 }, { accountId: "acct_harbor", accountName: "Harbor Security", arr: 126000 }, { accountId: "acct_vertex", accountName: "Vertex Systems", arr: 98000 },
  ] },
  { id: otherProblems[2].id, title: otherProblems[2].title, severity: otherProblems[2].severity, stage: otherProblems[2].stage, productArea: "Platform experience", currentSignals: 12, previousSignals: 13, membershipScores: [0.76, 0.8, 0.78], accounts: [
    { accountId: "acct_orbit", accountName: "Orbit Works", arr: 54000 }, { accountId: "acct_pulse", accountName: "Pulse Studio", arr: 44000 },
  ] },
];

const themeRecords = [
  { name: "Export reliability", currentSignals: 42, previousSignals: 28 },
  { name: "SSO permissions", currentSignals: 28, previousSignals: 25 },
  { name: "Saved views", currentSignals: 21, previousSignals: 16 },
  { name: "Team onboarding", currentSignals: 17, previousSignals: 18 },
];

const resolutionRecords = { currentDays: [6.2, 7.9, 11.1], previousDays: [9.1, 9.6, 10.1] };

export function percentageChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

export function formatTrend(change: number | null): string {
  if (change === null) return "New";
  if (change === 0) return "0%";
  return `${change > 0 ? "+" : "−"}${Math.abs(change)}%`;
}

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

export function calculateOverviewAnalytics(): OverviewAnalytics {
  const allSources = weeklySignals.Intercom.map((_, index) => Object.values(weeklySignals).reduce((total, values) => total + values[index], 0));
  const uniqueAccounts = new Map(problemRecords.flatMap((problem) => problem.accounts).map((account) => [account.accountId, account]));
  const currentResolution = average(resolutionRecords.currentDays);
  const previousResolution = average(resolutionRecords.previousDays);
  return {
    feedbackSeries: { "All sources": allSources, Intercom: [...weeklySignals.Intercom], Zendesk: [...weeklySignals.Zendesk], Slack: [...weeklySignals.Slack], Surveys: [...weeklySignals.Surveys] },
    metrics: {
      newFeedback: allSources.at(-1) ?? 0,
      feedbackTrend: percentageChange(allSources.at(-1) ?? 0, allSources.at(-2) ?? 0),
      activeProblems: problemRecords.filter((problem) => problem.stage !== "Closed").length,
      needsReview: problemRecords.filter((problem) => problem.stage === "Needs review").length,
      affectedRevenue: [...uniqueAccounts.values()].reduce((total, account) => total + account.arr, 0),
      affectedAccounts: uniqueAccounts.size,
      averageResolutionDays: Number(currentResolution.toFixed(1)),
      resolutionImprovementDays: Number((previousResolution - currentResolution).toFixed(1)),
    },
    themes: themeRecords.map((theme) => ({ ...theme, trend: percentageChange(theme.currentSignals, theme.previousSignals) })),
    problems: problemRecords.map((problem) => ({
      ...problem,
      count: problem.currentSignals,
      revenue: problem.accounts.reduce((total, account) => total + account.arr, 0),
      confidence: Math.round(average(problem.membershipScores) * 100),
      trend: percentageChange(problem.currentSignals, problem.previousSignals),
    })),
    feedbackTotal: sum(allSources),
  };
}

export const overviewAnalytics = calculateOverviewAnalytics();
