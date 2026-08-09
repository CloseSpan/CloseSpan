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

  it("exposes an accessible filter on every high-impact problem column", () => {
    const markup = renderToStaticMarkup(
      <OverviewScreen
        analytics={calculateOverviewAnalytics(
          new Date("2026-07-21T18:00:00.000Z"),
        )}
        firstName="Sam"
        organizationName="CloseSpan"
      />,
    );

    for (const column of [
      "Product problem",
      "Signals",
      "Revenue",
      "Severity",
      "Trend",
      "Confidence",
      "Stage",
    ]) {
      expect(markup).toContain(`aria-label="Filter by ${column}"`);
    }
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('aria-expanded="false"');
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
});
