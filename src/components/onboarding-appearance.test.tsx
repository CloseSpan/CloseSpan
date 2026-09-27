import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ACCENT_COLORS } from "@/lib/color-theme";
vi.mock("@/app/onboarding/actions", () => ({ completeOnboardingAppearanceAction: vi.fn() }));
import { OnboardingAppearance } from "./onboarding-appearance";

describe("onboarding appearance", () => {
  it("asks for appearance before any demo or integration decision", () => {
    const html = renderToStaticMarkup(<OnboardingAppearance />);
    expect(html).toContain("How should CloseSpan look?");
    expect(html).toContain('aria-labelledby="onboarding-appearance-title"');
    expect(html).toContain("<legend>Theme</legend>");
    expect(html).toContain("<legend>Accent color</legend>");
    expect(html).toMatch(/name="appearance-theme"[^>]*checked=""[^>]*value="light"/);
    expect(html).not.toContain('value="system"');
    for (const color of ACCENT_COLORS) expect(html).toContain(`aria-label="${color.label}"`);
    expect(html).toContain("Continue");
    expect(html).not.toContain("disabled=");
    expect(html).not.toContain("Explore demo");
    expect(html).not.toContain("Connect GitHub");
  });
});
