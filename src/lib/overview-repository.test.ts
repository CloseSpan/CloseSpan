import { describe, expect, it } from "vitest";
import { buildFeedbackWeekDescriptors } from "./overview-analytics";
import {
  buildFeedbackWeeklyRows,
  buildOverviewAnalytics,
  buildReviewedThemeRows,
  OVERVIEW_WEEK_BUCKETS,
} from "./overview-repository";

describe("overview repository analytics", () => {
  it("builds eight real UTC week ranges ending with the Jul 20, 2026 week", () => {
    const weeks = buildFeedbackWeekDescriptors(
      new Date("2026-07-21T18:00:00.000Z"),
    );

    expect(weeks).toHaveLength(OVERVIEW_WEEK_BUCKETS);
    expect(weeks[0]).toEqual({
      startDate: "2026-06-01",
      endDate: "2026-06-07",
      shortLabel: "Jun 1–7",
      label: "Jun 1–7, 2026",
    });
    expect(weeks.at(-1)).toEqual({
      startDate: "2026-07-20",
      endDate: "2026-07-26",
      shortLabel: "Jul 20–26",
      label: "Jul 20–26, 2026",
    });
  });

  it("formats a week that crosses a month boundary without ambiguity", () => {
    const weeks = buildFeedbackWeekDescriptors(
      new Date("2026-07-21T18:00:00.000Z"),
    );

    expect(weeks[4]).toEqual({
      startDate: "2026-06-29",
      endDate: "2026-07-05",
      shortLabel: "Jun 29–Jul 5",
      label: "Jun 29–Jul 5, 2026",
    });
  });

  it("buckets source feedback into eight UTC weeks using observed dates", () => {
    const weeklyRows = buildFeedbackWeeklyRows(
      [
        {
          source: "Zendesk",
          observed_at: "2026-07-21T03:30:22.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
        },
        {
          source: "Zendesk",
          observed_at: "not-a-date",
          created_at: "2026-07-14T12:00:00.000Z",
        },
        {
          source: "Slack",
          observed_at: "2026-06-01T00:00:00.000Z",
          created_at: "2026-07-21T00:00:00.000Z",
        },
        {
          source: "Zendesk",
          observed_at: "2026-05-31T23:59:59.000Z",
          created_at: "2026-07-21T00:00:00.000Z",
        },
      ],
      new Date("2026-07-21T18:00:00.000Z"),
    );

    const zendesk = weeklyRows
      .filter((row) => row.source === "Zendesk")
      .map((row) => row.signal_count);
    const slack = weeklyRows
      .filter((row) => row.source === "Slack")
      .map((row) => row.signal_count);

    expect(zendesk).toHaveLength(OVERVIEW_WEEK_BUCKETS);
    expect(zendesk).toEqual([0, 0, 0, 0, 0, 0, 1, 1]);
    expect(slack).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("uses the current chart bucket for new feedback and reports work awaiting analysis", () => {
    const referenceDate = new Date("2026-07-21T18:00:00.000Z");
    const weeklyRows = buildFeedbackWeeklyRows(
      [
        {
          source: "Zendesk",
          observed_at: "2026-07-21T03:30:22.000Z",
          created_at: "2026-07-21T03:30:22.000Z",
        },
        {
          source: "Slack",
          observed_at: "invalid",
          created_at: "2026-07-20T10:00:00.000Z",
        },
        {
          source: "Zendesk",
          observed_at: "2026-07-15T10:00:00.000Z",
          created_at: "2026-07-15T10:00:00.000Z",
        },
      ],
      referenceDate,
    );
    const analytics = buildOverviewAnalytics({
      weeklyRows,
      feedbackWeeks: buildFeedbackWeekDescriptors(referenceDate),
      themeRows: [],
      problemRows: [],
      resolutionRows: [],
      feedbackCount: { total: 3, awaiting_analysis: 3 },
    });

    expect(analytics.feedbackSeries["All sources"]).toHaveLength(8);
    expect(analytics.feedbackWeeks.at(-1)?.startDate).toBe("2026-07-20");
    expect(analytics.feedbackSeries["All sources"].at(-1)).toBe(2);
    expect(analytics.metrics.newFeedback).toBe(2);
    expect(analytics.metrics.awaitingAnalysis).toBe(3);
    expect(analytics.feedbackTotal).toBe(3);
  });

  it("keeps empty PostgreSQL analytics aligned with all eight date buckets", () => {
    const feedbackWeeks = buildFeedbackWeekDescriptors(
      new Date("2026-07-21T18:00:00.000Z"),
    );
    const analytics = buildOverviewAnalytics({
      weeklyRows: [],
      feedbackWeeks,
      themeRows: [],
      problemRows: [],
      resolutionRows: [],
      feedbackCount: { total: 0, awaiting_analysis: 0 },
    });

    expect(analytics.feedbackWeeks).toEqual(feedbackWeeks);
    expect(analytics.feedbackSeries["All sources"]).toEqual(
      Array.from({ length: OVERVIEW_WEEK_BUCKETS }, () => 0),
    );
  });

  it("derives emerging themes from reviewed problem memberships on the same week boundaries", () => {
    const rows = buildReviewedThemeRows(
      [
        {
          theme: "Checkout",
          observed_at: "2026-07-21T03:30:22.000Z",
          created_at: "2026-07-21T03:30:22.000Z",
        },
        {
          theme: "Checkout",
          observed_at: "2026-07-15T10:00:00.000Z",
          created_at: "2026-07-15T10:00:00.000Z",
        },
        {
          theme: "Permissions",
          observed_at: "invalid",
          created_at: "2026-07-21T12:00:00.000Z",
        },
      ],
      new Date("2026-07-21T18:00:00.000Z"),
    );

    expect(rows).toEqual([
      { theme: "Checkout", current_signals: 1, previous_signals: 1 },
      { theme: "Permissions", current_signals: 1, previous_signals: 0 },
    ]);
  });
});
