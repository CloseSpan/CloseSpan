import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { calculateOverviewAnalytics } from "@/lib/overview-analytics";
import { OverviewScreen } from "./screens";

describe("OverviewScreen theme filter", () => {
  it("uses an accessible dropdown for every comparison period", () => {
    const markup = renderToStaticMarkup(
      <OverviewScreen
        analytics={calculateOverviewAnalytics(
          new Date("2026-07-21T18:00:00.000Z"),
        )}
        firstName="Sam"
        organizationName="CloseSpan"
      />,
    );

    expect(markup).toContain('class="custom-select overview-theme-range-filter"');
    expect(markup).toContain('class="overview-themes-slot"');
    expect(markup).toContain('class="card-body overview-themes-scroll"');
    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-label="Emerging themes for the last week"');
    expect(markup).toContain('aria-haspopup="listbox"');
    expect(markup).toContain(
      "Filter themes by comparison period: Last week",
    );
    expect(markup).toContain(
      'class="overview-themes-ai-note">AI grouped</span>',
    );
    expect(markup).toContain("Last week");
    expect(markup).toContain("2 weeks");
    expect(markup).toContain("30 days");
    expect(markup).toContain("90 days");
    expect(markup).toContain("6 months");
    expect(markup).not.toContain("theme-range-switch");
  });

  it("shows a compact attention queue instead of duplicating the problem inventory", () => {
    const markup = renderToStaticMarkup(
      <OverviewScreen
        analytics={calculateOverviewAnalytics(
          new Date("2026-07-21T18:00:00.000Z"),
        )}
        firstName="Sam"
        organizationName="CloseSpan"
      />,
    );

    expect(markup).toContain("Needs attention");
    expect(markup).toContain("View issues");
    expect(markup).toContain('class="overview-attention-list"');
    expect(markup).not.toContain('class="problem-table"');
    expect(markup).not.toContain("View board");
    expect(markup).toContain('<section class="overview-insights section-gap" aria-label="Analytics and trends">');
    expect(markup).not.toContain('<details class="overview-insights');
    expect(markup).not.toContain("Analytics &amp; trends");
  });

  it("makes a long theme list keyboard-scrollable", () => {
    const analytics = calculateOverviewAnalytics(
      new Date("2026-07-21T18:00:00.000Z"),
    );
    analytics.themeRanges = {
      ...analytics.themeRanges!,
      "7d": [
        ...analytics.themeRanges!["7d"],
        {
          name: "Search and navigation",
          currentSignals: 4,
          previousSignals: 3,
          trend: 33,
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <OverviewScreen
        analytics={analytics}
        firstName="Sam"
        organizationName="CloseSpan"
      />,
    );

    expect(markup).toContain(
      'class="card-body overview-themes-scroll" data-empty="false" role="region" aria-label="Emerging themes for the last week" aria-live="polite" tabindex="0"',
    );
  });

  it("never renders $0k and matches the header action to pending approvals", () => {
    const analytics = calculateOverviewAnalytics(new Date("2026-07-21T18:00:00.000Z"));
    const noRevenue = {
      ...analytics,
      metrics: { ...analytics.metrics, affectedRevenue: 0 },
      problems: analytics.problems.map((problem) => ({ ...problem, revenue: 0 })),
    };
    const markup = renderToStaticMarkup(<OverviewScreen analytics={noRevenue} firstName="Sam" organizationName="CloseSpan" />);
    expect(markup).not.toContain("$0k");
    expect(markup).toContain("No revenue data");
    expect(markup).not.toContain("Review approvals");
    const small = { ...analytics, metrics: { ...analytics.metrics, affectedRevenue: 450 } };
    const withApprovals = renderToStaticMarkup(<OverviewScreen analytics={small} firstName="Sam" organizationName="CloseSpan" pendingApprovals={2} />);
    expect(withApprovals).toContain("$450");
    expect(withApprovals).toContain("Review approvals");
  });
});
