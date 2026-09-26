import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COLOR_THEME_COLORS,
  COLOR_THEME_STORAGE_KEY,
  DEFAULT_COLOR_THEME,
} from "./color-theme";

const themeSource = readFileSync(new URL("../app/neumorphic-theme.css", import.meta.url), "utf8");
const layoutSource = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const trustSource = readFileSync(new URL("../components/TrustPublicPage.module.css", import.meta.url), "utf8");
const productSource = readFileSync(new URL("../app/product-theme.css", import.meta.url), "utf8");

function tokensFor(selector: string, source = themeSource): Record<string, string> {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing theme selector: ${selector}`);
  const block = source.slice(start, source.indexOf("}", start));
  return Object.fromEntries(
    Array.from(block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g), ([, name, value]) => [
      name,
      value.trim(),
    ]),
  );
}

function luminance(hex: string): number {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error(`Expected a six-digit color: ${hex}`);
  const [red, green, blue] = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("shared product visual system", () => {
  const light = tokensFor(":root");
  const dark = tokensFor(':root[data-theme="dark"]');

  it("uses the approved neutral light palette throughout the shared tokens", () => {
    expect(light).toMatchObject({
      "--bg": "#ffffff",
      "--surface": "#ffffff",
      "--surface-muted": "#f7f7f8",
      "--text-strong": "#1c1d1f",
      "--text-muted": "#62656b",
      "--accent": "#1c1d1f",
      "--accent-fill": "#1c1d1f",
    });
  });

  it("retains a separately defined neutral dark theme", () => {
    expect(dark).toMatchObject({
      "--bg": "#18191b",
      "--surface": "#202124",
    });
  });

  it("gives shared fields the approved rounded, lightly elevated treatment", () => {
    expect(productSource).toContain("--field-radius: 12px;");
    expect(productSource).toContain("--field-height: 40px;");
    expect(productSource).toContain("--field-height: 44px;");
    expect(productSource).toContain("--field-border: #e4e5e8;");
    expect(productSource).toContain("--field-border: #44464c;");
    expect(productSource).toContain("box-shadow: var(--field-state-shadow, var(--field-shadow)) !important;");
    expect(productSource).toContain("border-radius: var(--field-radius);");
  });

  it("keeps field errors, disabled surfaces, portals, and compound boundaries explicit", () => {
    expect(productSource).toContain(".organization-create-panel, .problem-column-filter-popover) :is(");
    expect(productSource).toContain(":where(:not(.searchbox *, .secret-input *");
    expect(productSource).toContain("--field-state-border: var(--danger);");
    expect(productSource).toContain("--field-state-surface: var(--surface-disabled);");
    expect(productSource).toContain("--field-state-shadow: none;");
    expect(productSource).toContain('.problem-column-filter-affix input { padding-inline-end: 36px; }');
    // Element exclusions must not overpower later invalid/focus rules.
    expect(productSource).toContain('input:where(:not([type="checkbox"]');
    expect(productSource).not.toContain('input:not([type="checkbox"]):not([type="radio"])');
  });

  it.each([":root", ':root[data-theme="dark"]'])("uses a visible neutral field focus in %s", (selector) => {
    const fields = tokensFor(selector, productSource);
    const palette = tokensFor(selector);
    const edge = fields["--field-focus-border"];
    expect(contrast(edge, fields["--field-focus-surface"])).toBeGreaterThanOrEqual(3);
    expect(contrast(edge, fields["--field-border"])).toBeGreaterThanOrEqual(3);
    expect(contrast(palette["--text-strong"], fields["--field-focus-surface"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette["--text-muted"], fields["--field-focus-surface"])).toBeGreaterThanOrEqual(4.5);
  });

  it("gives compound fields one neutral boundary, with no inner focus frame", () => {
    const focus = productSource.slice(productSource.indexOf("/* Links and actions retain"), productSource.indexOf("/* Keep the sidebar visible"));
    expect(focus).toContain("[data-field-shell]):has(:is(input, textarea):enabled:focus)");
    expect(focus).toContain("border-color: var(--field-invalid-border, var(--field-focus-border)) !important;");
    expect(focus).toContain("background: var(--field-focus-surface) !important;");
    const inner = focus.match(/\[data-field-shell\]\) :is\(input, textarea\):is\(:focus, :focus-visible\) \{([^}]+)\}/)?.[1];
    expect(inner).toContain("outline: 0 !important;");
    expect(inner).toContain("border: 0 !important;");
    expect(inner).toContain("background: transparent !important;");
    expect(inner).toContain("box-shadow: none !important;");
    expect(productSource).toContain("--field-invalid-border: var(--danger);");
  });

  it("keeps one system focus indicator on compound fields in forced colors", () => {
    const forced = productSource.slice(productSource.lastIndexOf("@media (forced-colors: active)"));
    expect(forced).toContain("[data-field-shell]):has(:is(input, textarea):enabled:focus)");
    expect(forced).toContain("outline: 2px solid Highlight !important;");
    expect(forced).toContain(":where(:not(.searchbox *, .secret-input *");
    expect(forced).toContain("border: 0 !important;");
    expect(forced).toContain("outline: none !important;");
  });

  it("uses restrained control and surface radii instead of inflated cards", () => {
    expect(light).toMatchObject({
      "--radius-xs": "4px",
      "--radius-sm": "6px",
      "--radius-md": "8px",
      "--radius-lg": "12px",
      "--radius-xl": "16px",
    });
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ] as const)("keeps body, secondary, and button text readable in %s mode", (_, tokens) => {
    expect(contrast(tokens["--text-strong"], tokens["--bg"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens["--text-muted"], tokens["--surface"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens["--text-on-accent"], tokens["--accent-fill"])).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the new component layer after the legacy structural and theme styles", () => {
    const stylesheets = Array.from(layoutSource.matchAll(/import\s+["'](.+\.css)["']/g), ([, value]) => value);
    expect(stylesheets).toEqual([
      "./globals.css",
      "./neumorphic-theme.css",
      "./product-theme.css",
    ]);
  });

  it("loads the product typeface locally rather than fetching a remote font at build time", () => {
    expect(layoutSource).toContain('from "next/font/local"');
    expect(layoutSource).toMatch(/geist-latin\.woff2/);
    expect(layoutSource).not.toContain('from "next/font/google"');
  });

  it("preserves light as the default and the existing saved-preference key", () => {
    expect(DEFAULT_COLOR_THEME).toBe("light");
    expect(COLOR_THEME_STORAGE_KEY).toBe("closespan-theme");
    expect(layoutSource).toContain("data-theme={DEFAULT_COLOR_THEME}");
    expect(layoutSource).toContain("COLOR_THEME_BOOTSTRAP_SCRIPT");
    expect(layoutSource).toContain("<ThemeController />");
  });

  it("keeps browser chrome colors aligned with each theme canvas", () => {
    expect(COLOR_THEME_COLORS.light).toBe(light["--bg"]);
    expect(COLOR_THEME_COLORS.dark).toBe(dark["--bg"]);
  });

  it("uses an open reading surface on supporting trust and legal pages", () => {
    const section = trustSource.match(/\.section\s*\{([^}]+)\}/)?.[1] ?? "";
    expect(section).toContain("border-top: 1px solid var(--border-subtle)");
    expect(section).toContain("border-radius: 0");
    expect(section).toContain("background: transparent");
    expect(section).toContain("box-shadow: none");
    expect(trustSource).toContain("@media (forced-colors: active)");
    expect(trustSource).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
