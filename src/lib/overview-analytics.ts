import { otherProblems, primaryProblem } from "./seed";

export interface AccountImpactRecord { accountId: string; accountName: string; arr: number }
export interface ProblemAnalyticsRecord {
  id: string; title: string; severity: string; stage: string; productArea: string;
  currentSignals: number; previousSignals: number; membershipScores: number[]; accounts: AccountImpactRecord[];
}

export interface FeedbackWeekDescriptor {
  startDate: string;
  endDate: string;
  shortLabel: string;
  label: string;
}

export const OVERVIEW_WEEK_BUCKETS = 8;
const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1_000;
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

export function startOfUtcWeek(value: Date): Date {
  const start = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
  const daysSinceMonday = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start;
}

function formatWeekRange(start: Date, end: Date): {
  shortLabel: string;
  label: string;
} {
  const startMonth = MONTH_NAMES[start.getUTCMonth()];
  const endMonth = MONTH_NAMES[end.getUTCMonth()];
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();

  if (startYear !== endYear) {
    const label = `${startMonth} ${startDay}, ${startYear}–${endMonth} ${endDay}, ${endYear}`;
    return { shortLabel: label, label };
  }

  const shortLabel = start.getUTCMonth() === end.getUTCMonth()
    ? `${startMonth} ${startDay}–${endDay}`
    : `${startMonth} ${startDay}–${endMonth} ${endDay}`;
  return { shortLabel, label: `${shortLabel}, ${startYear}` };
}

export function buildFeedbackWeekDescriptors(
  referenceDate = new Date(),
): FeedbackWeekDescriptor[] {
  const currentWeekStart = startOfUtcWeek(referenceDate);
  return Array.from({ length: OVERVIEW_WEEK_BUCKETS }, (_, index) => {
    const start = new Date(
      currentWeekStart.getTime() -
        (OVERVIEW_WEEK_BUCKETS - 1 - index) * WEEK_IN_MS,
    );
    const end = new Date(start.getTime() + WEEK_IN_MS - 24 * 60 * 60 * 1_000);
    const labels = formatWeekRange(start, end);
    return {
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      ...labels,
    };
  });
}

export interface OverviewAnalytics {
  feedbackSeries: Record<string, number[]>;
  feedbackWeeks: FeedbackWeekDescriptor[];
  metrics: {
    newFeedback: number;
    feedbackTrend: number | null;
    awaitingAnalysis: number;
    activeProblems: number;
    needsReview: number;
    affectedRevenue: number;
    affectedAccounts: number;
    averageResolutionDays: number;
    resolutionImprovementDays: number;
  };
  themes: Array<{ name: string; currentSignals: number; previousSignals: number; trend: number | null }>;
  problems: Array<ProblemAnalyticsRecord & { count: number; revenue: number; confidence: number; trend: number | null }>;
  feedbackTotal: number;
}

export function createEmptyOverviewAnalytics(): OverviewAnalytics {
  return {
    feedbackSeries: { "All sources": [] },
    feedbackWeeks: [],
    feedbackTotal: 0,
    metrics: {
      newFeedback: 0,
      feedbackTrend: 0,
      awaitingAnalysis: 0,
      activeProblems: 0,
      needsReview: 0,
      affectedRevenue: 0,
      affectedAccounts: 0,
      averageResolutionDays: 0,
      resolutionImprovementDays: 0,
    },
    themes: [],
    problems: [],
  };
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

export function calculateOverviewAnalytics(
  referenceDate = new Date(),
): OverviewAnalytics {
  const allSources = weeklySignals.Intercom.map((_, index) => Object.values(weeklySignals).reduce((total, values) => total + values[index], 0));
  const uniqueAccounts = new Map(problemRecords.flatMap((problem) => problem.accounts).map((account) => [account.accountId, account]));
  const currentResolution = average(resolutionRecords.currentDays);
  const previousResolution = average(resolutionRecords.previousDays);
  return {
    feedbackSeries: { "All sources": allSources, Intercom: [...weeklySignals.Intercom], Zendesk: [...weeklySignals.Zendesk], Slack: [...weeklySignals.Slack], Surveys: [...weeklySignals.Surveys] },
    feedbackWeeks: buildFeedbackWeekDescriptors(referenceDate),
    metrics: {
      newFeedback: allSources.at(-1) ?? 0,
      feedbackTrend: percentageChange(allSources.at(-1) ?? 0, allSources.at(-2) ?? 0),
      awaitingAnalysis: 0,
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
