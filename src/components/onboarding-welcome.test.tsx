import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/app/onboarding/actions", () => ({ continueOnboardingAction: vi.fn(), exploreDemoAction: vi.fn() }));
import { DemoWorkspaceBanner, OnboardingWelcome } from "./onboarding-welcome";
describe("onboarding welcome", () => {
  it("offers the demo first, followed by setup, without the old workflow UI", () => {
    const html = renderToStaticMarkup(<OnboardingWelcome />);
    expect(html.indexOf("Explore demo")).toBeLessThan(html.indexOf("Set up my workspace"));
    expect(html).toContain("No setup needed");
    expect(html).toContain("read-only");
    expect(html).not.toContain("Connect GitHub");
    expect(html).toContain('aria-labelledby="onboarding-welcome-title"');
  });
  it("keeps a clear way out of the demo", () => {
    const html = renderToStaticMarkup(<DemoWorkspaceBanner />);
    expect(html).toContain("Sample data · Read-only");
    expect(html).toContain("Set up my workspace");
  });
});
