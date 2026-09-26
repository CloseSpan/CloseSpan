import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LandingPage from "@/app/page";
import { LANDING_BRAND_MARKS, POSTHOG_COLOR_MARK, SLACK_MARK_COLORS } from "@/lib/landing-brand-marks";
import { LandingIntegrationLogo, type LandingIntegrationBrand } from "./landing-integration-logo";

const brands: LandingIntegrationBrand[] = [
  "intercom", "zendesk", "slack", "github", "linear", "jira", "sentry", "posthog",
];

describe("landing integration logos", () => {
  it.each(brands)("renders the %s mark locally in brand colors", (brand) => {
    const html = renderToStaticMarkup(<LandingIntegrationLogo brand={brand} />);
    expect(html).toContain(`data-brand="${brand}"`);
    expect(html).toContain('width="24" height="24"');
    expect(html).toContain('aria-hidden="true" focusable="false"');
    if (brand === "posthog") {
      expect(html).toContain(`viewBox="${POSTHOG_COLOR_MARK.viewBox}"`);
      for (const { path, fill } of POSTHOG_COLOR_MARK.paths) {
        expect(html).toContain(`d="${path}" fill="${fill}"`);
      }
    } else if (brand === "slack") {
      const paths = [...html.matchAll(/d="(M[^"]+)"/g)].map((match) => match[1]);
      expect(paths).toHaveLength(8);
      expect(paths.join("")).toBe(LANDING_BRAND_MARKS.slack.path);
      for (const fill of SLACK_MARK_COLORS) expect(html).toContain(`fill="${fill}"`);
    } else {
      expect(html).toContain(`viewBox="${LANDING_BRAND_MARKS[brand].viewBox}"`);
      expect(html).toContain(`d="${LANDING_BRAND_MARKS[brand].path}" fill="${LANDING_BRAND_MARKS[brand].fill}"`);
    }
    expect(html).not.toContain("<image");
    expect(html).not.toContain("<script");
  });

  it("uses distinct marks for all eight brands", () => {
    expect(new Set(brands.map((brand) => LANDING_BRAND_MARKS[brand].path)).size).toBe(8);
  });

  it("pairs every company name with one decorative logo and preserves existing links", () => {
    const html = renderToStaticMarkup(<LandingPage />);
    const row = html.match(/<section[^>]+aria-label="Connector catalog"[^>]*>([\s\S]*?)<\/section>/)?.[1];
    expect(row).toBeDefined();
    for (const brand of brands) {
      expect(row).toContain(`data-brand="${brand}"`);
    }
    for (const name of ["Intercom", "Zendesk", "Slack", "GitHub", "Linear", "Jira", "Sentry", "PostHog"]) {
      expect(row).toContain(`<span>${name}</span>`);
    }
    for (const href of ["/integrations/intercom", "/integrations/zendesk", "/integrations/github", "/connectors"]) {
      expect(row).toContain(`href="${href}"`);
    }
    expect(row?.match(/focusable="false"/g)).toHaveLength(8);
  });
});
