import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ACCENT_COLORS } from "@/lib/color-theme";
import { AppearanceSettings } from "./appearance-settings";

describe("personal appearance settings", () => {
  it("offers accessible light, dark, and system theme radios", () => {
    const html = renderToStaticMarkup(<AppearanceSettings />);
    expect(html).toContain('<h1 id="appearance-title">Appearance</h1>');
    expect(html).toContain("<legend>Theme</legend>");
    for (const value of ["light", "dark", "system"]) {
      expect(html).toMatch(new RegExp(`name="appearance-theme"[^>]*value="${value}"`));
    }
    expect(html).toMatch(/name="appearance-theme"[^>]*checked=""[^>]*value="light"/);
    expect(html).toContain('role="status"');
  });

  it("provides named accents and keeps neutral as the server default", () => {
    const html = renderToStaticMarkup(<AppearanceSettings />);
    for (const { id, label } of ACCENT_COLORS) {
      expect(html).toContain(`aria-label="${label}"`);
      expect(html).toMatch(new RegExp(`name="appearance-accent"[^>]*value="${id}"`));
    }
    expect(html).toMatch(/name="appearance-accent"[^>]*checked=""[^>]*value="neutral"/);
    expect(html.match(/type="radio"/g)).toHaveLength(3 + ACCENT_COLORS.length);
  });

  it("keeps preference controls separate from backend workspace policy", () => {
    const html = renderToStaticMarkup(<AppearanceSettings />);
    expect(html).toContain("Saved on this browser.");
    expect(html).not.toContain("Save policy");
    expect(html).not.toContain("disabled=");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<img");
  });
});
