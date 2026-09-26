import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IntegrationProviderIcon } from "./integration-provider-icon";

describe("shared integration brand icons", () => {
  it.each(["intercom", "zendesk", "slack", "github", "linear", "jira", "sentry", "posthog"])(
    "uses the same colored %s artwork in integration screens", (brand) => {
      const markup = renderToStaticMarkup(<IntegrationProviderIcon integrationId={`int_${brand}`} compact className="test-icon" />);
      expect(markup).toContain(`data-brand="${brand}"`);
      expect(markup).toContain("brand-icon");
      expect(markup).toContain("compact test-icon");
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).not.toContain('src="http');
    },
  );

  it("preserves the colored fallback for custom connectors", () => {
    const markup = renderToStaticMarkup(<IntegrationProviderIcon integrationId="int_custom" size={19} />);
    expect(markup).toContain("lucide-plug-zap");
    expect(markup).toContain('width="19"');
  });
});
