import { describe, expect, it } from "vitest";
import {
  calculateOverviewAnalytics,
  createEmptyOverviewAnalytics,
  formatTrend,
  percentageChange,
} from "./overview-analytics";

describe("overview analytics", () => {
  it("calculates comparison-period trends", () => {
    expect(percentageChange(3, 2)).toBe(50);
    expect(percentageChange(17, 18)).toBe(-6);
    expect(percentageChange(4, 0)).toBeNull();
    expect(formatTrend(-6)).toBe("−6%");
  });

  it("derives revenue from unique affected account records", () => {
    const analytics = calculateOverviewAnalytics();
    expect(analytics.metrics.affectedRevenue).toBe(1_320_000);
    expect(analytics.metrics.affectedAccounts).toBe(11);
    expect(analytics.problems[0].revenue).toBe(394_000);
    expect(analytics.problems[0].accounts.map(({ accountName, arr }) => [accountName, arr])).toEqual([
      ["Northstar Labs", 184_000], ["Acme Health", 142_000], ["Atlas Cloud", 68_000],
    ]);
  });

  it("derives feedback totals and resolution timing from records", () => {
    const analytics = calculateOverviewAnalytics(
      new Date("2026-07-21T18:00:00.000Z"),
    );
    expect(analytics.feedbackTotal).toBe(528);
    expect(analytics.metrics.newFeedback).toBe(94);
    expect(analytics.metrics.averageResolutionDays).toBe(8.4);
    expect(analytics.metrics.resolutionImprovementDays).toBe(1.2);
    expect(analytics.feedbackWeeks).toHaveLength(
      analytics.feedbackSeries["All sources"].length,
    );
    expect(analytics.feedbackWeeks.at(-1)?.shortLabel).toBe("Jul 20–26");
  });

  it("keeps empty analytics compatible with the date-range chart contract", () => {
    const analytics = createEmptyOverviewAnalytics();

    expect(analytics.feedbackSeries).toEqual({ "All sources": [] });
    expect(analytics.feedbackWeeks).toEqual([]);
  });
});
