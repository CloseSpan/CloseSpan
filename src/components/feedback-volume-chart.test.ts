import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OverviewAnalytics } from "@/lib/overview-analytics";
import {
  FeedbackVolumeChart,
  normalizeChartBarHeight,
} from "./feedback-volume-chart";

const analytics: OverviewAnalytics = {
  feedbackSeries: { "All sources": [0, 0, 0, 0, 0, 0, 0, 3] },
  feedbackWeeks: [
    { startDate: "2026-06-01", endDate: "2026-06-07", shortLabel: "Jun 1–7", label: "Jun 1–7, 2026" },
    { startDate: "2026-06-08", endDate: "2026-06-14", shortLabel: "Jun 8–14", label: "Jun 8–14, 2026" },
    { startDate: "2026-06-15", endDate: "2026-06-21", shortLabel: "Jun 15–21", label: "Jun 15–21, 2026" },
    { startDate: "2026-06-22", endDate: "2026-06-28", shortLabel: "Jun 22–28", label: "Jun 22–28, 2026" },
    { startDate: "2026-06-29", endDate: "2026-07-05", shortLabel: "Jun 29–Jul 5", label: "Jun 29–Jul 5, 2026" },
    { startDate: "2026-07-06", endDate: "2026-07-12", shortLabel: "Jul 6–12", label: "Jul 6–12, 2026" },
    { startDate: "2026-07-13", endDate: "2026-07-19", shortLabel: "Jul 13–19", label: "Jul 13–19, 2026" },
    { startDate: "2026-07-20", endDate: "2026-07-26", shortLabel: "Jul 20–26", label: "Jul 20–26, 2026" },
  ],
  feedbackTotal: 3,
  metrics: {
    newFeedback: 3,
    feedbackTrend: null,
    awaitingAnalysis: 3,
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

describe("feedback volume chart", () => {
  it("normalizes low-volume bars against the largest visible bucket", () => {
    expect(normalizeChartBarHeight(1, 4)).toBe(25);
    expect(normalizeChartBarHeight(4, 4)).toBe(100);
    expect(normalizeChartBarHeight(0, 4)).toBe(0);
  });

  it("renders real UTC date ranges instead of ordinal W1–W8 placeholders", () => {
    const markup = renderToStaticMarkup(
      createElement(FeedbackVolumeChart, { analytics }),
    );

    expect(markup).toContain("Jun 1–7");
    expect(markup).toContain("Jun 29–Jul 5");
    expect(markup).toContain("Jul 20–26");
    expect(markup).toContain("Jul 20–26, 2026");
    expect(markup).not.toMatch(/>W[1-8]</);
  });

  it("uses the themed source listbox instead of the operating-system select menu", () => {
    const markup = renderToStaticMarkup(
      createElement(FeedbackVolumeChart, { analytics }),
    );

    expect(markup).toContain('class="custom-select chart-source"');
    expect(markup).toContain('aria-haspopup="listbox"');
    expect(markup).toContain('aria-label="Feedback source: All sources"');
    expect(markup).not.toContain("<select");
  });

  it("renders neutral, noninteractive zero-week markers while keeping nonzero bars interactive", () => {
    const markup = renderToStaticMarkup(
      createElement(FeedbackVolumeChart, { analytics }),
    );
    const zeroMarkers = markup.match(
      /<span class="chart-zero-marker" data-chart-value="0"[^>]*aria-hidden="true"><\/span>/g,
    );

    expect(zeroMarkers).toHaveLength(7);
    expect(markup).not.toMatch(/<button[^>]*data-chart-value="0"/);
    expect(markup).not.toMatch(
      /class="chart-bar"[^>]*data-chart-value="0"/,
    );
    expect(markup).toMatch(
      /<button[^>]*class="chart-bar"[^>]*data-chart-value="3"/,
    );
    expect(normalizeChartBarHeight(3, 3)).toBe(100);
  });

  it("shows a useful empty state when every visible week has zero feedback", () => {
    const emptyAnalytics: OverviewAnalytics = {
      ...analytics,
      feedbackSeries: {
        "All sources": Array.from({ length: 8 }, () => 0),
      },
      feedbackTotal: 0,
      metrics: {
        ...analytics.metrics,
        newFeedback: 0,
        awaitingAnalysis: 0,
      },
    };
    const markup = renderToStaticMarkup(
      createElement(FeedbackVolumeChart, { analytics: emptyAnalytics }),
    );

    expect(markup).toContain('class="chart chart-is-empty"');
    expect(markup).toContain('class="chart-empty-state" role="status"');
    expect(markup).toContain("No feedback in this period");
    expect(markup).toContain(
      "Run an import to bring customer signals into CloseSpan.",
    );
    expect(markup).toContain('href="/integrations">Import feedback</a>');
    expect(markup.match(/class="chart-zero-marker"/g)).toHaveLength(8);
    expect(markup).not.toMatch(/<button[^>]*class="chart-bar"/);
    expect(markup).toContain("Jul 20–26");
  });
});
