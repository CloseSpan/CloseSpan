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
const onboardingSource = readFileSync(new URL("../components/onboarding-agent-panel.tsx", import.meta.url), "utf8");

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

  it("lets the shared icon palette color desktop, settings, and mobile navigation", () => {
    const navigation = productSource.slice(productSource.indexOf("/* Navigation glyphs"), productSource.indexOf(":root[data-theme] .app-shell .nav-section-label"));
    expect(navigation).toContain(":is(.nav a, .settings-nav a, .mobile-menu-panel nav a) svg.lucide");
    expect(navigation).toContain("stroke-width: 1.8;");
    expect(navigation).not.toMatch(/\bcolor\s*:/);
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

  it("gives the compact workspace picker one themed boundary around both actions", () => {
    const picker = productSource.slice(productSource.indexOf("/* The compact workspace picker"), productSource.indexOf(":root[data-theme] :is(.organization-trigger-copy"));
    expect(picker).toContain(".organization-switcher.compact .organization-switcher-control {");
    expect(picker).toContain("border: 1px solid var(--field-border);");
    expect(picker).toContain("border-radius: var(--field-radius);");
    expect(picker).toContain(":is(:hover, :has(details[open]))");
    const trigger = picker.slice(picker.indexOf(".organization-switcher-trigger {"));
    expect(trigger).toContain("border: 0 !important;");
    expect(trigger).toContain("background: transparent;");
    expect(trigger).toContain("box-shadow: none;");
  });

  it("separates shared connector sections and actions with one responsive spacing rhythm", () => {
    const drawer = productSource.slice(productSource.indexOf("/* Separate connector information"), productSource.indexOf(":root[data-theme] :is(.custom-select-option,"));
    expect(drawer).toContain(".integration-drawer-content {");
    expect(drawer).toContain("display: grid;");
    expect(drawer).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(drawer).toContain("gap: var(--space-4);");
    expect(drawer).toContain("margin-block-start: var(--space-4);");
    expect(drawer).toContain(".integration-drawer-content > .integration-drawer-summary {\n  margin: 0;");
    expect(drawer).toContain(".integration-drawer-content > .integration-drawer-actions {\n  padding-block-start: 0;");
  });

  it.each([":root", ':root[data-theme="dark"]'])("keeps workspace panels distinct and readable in %s", (selector) => {
    const panels = tokensFor(selector, productSource);
    const palette = tokensFor(selector);
    expect(panels["--surface-panel"]).not.toBe(palette["--bg"]);
    expect(contrast(palette["--text"], panels["--surface-panel"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette["--text-muted"], panels["--surface-panel"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(panels["--border-panel"], panels["--surface-panel"])).toBeGreaterThan(1.1);
    const surfaces = productSource.slice(productSource.indexOf("/* Workspace panels"), productSource.indexOf(":root[data-theme] .metric-value"));
    expect(surfaces).toContain(":root[data-theme] .app-shell :is(");
    expect(surfaces).toContain("background: var(--surface-panel);");
    expect(surfaces).not.toContain(".landing");
  });

  it("preserves the live neutral palette while separating light workspace inset content", () => {
    const workspace = tokensFor(':root[data-theme="light"] .app-shell', productSource);
    expect(tokensFor(":root", productSource)).toMatchObject({
      "--surface-panel": "#f6f6f7",
      "--border-panel": "#e1e2e5",
      "--surface-board": "#f0f0f2",
      "--border-ticket": "#d4d5d8",
    });
    expect(workspace).toEqual({
      "--workspace-panel-header": "var(--surface-panel)",
      "--workspace-inset": "var(--surface)",
      "--workspace-inset-border": "var(--border-panel)",
    });
    const hierarchy = productSource.slice(productSource.indexOf("/* Light workspace hierarchy"), productSource.indexOf("/* The board is a quiet canvas"));
    expect(hierarchy).toContain(".prompt-readiness-metric");
    expect(hierarchy).toContain("background: var(--workspace-inset) !important;");
    expect(hierarchy).toContain("background: var(--workspace-panel-header);");
    expect(hierarchy).not.toContain('data-theme="dark"');
    expect(hierarchy).not.toContain(".landing");
  });

  it("keeps the appearance thumb inside its track at both control sizes", () => {
    const switchRules = productSource.slice(productSource.indexOf("/* A switch owns"), productSource.indexOf("/* Native selection"));
    expect(switchRules).toContain("--theme-switch-size: 40px;");
    expect(switchRules).toContain("height: var(--theme-switch-size);");
    expect(switchRules).toContain("height: calc(var(--theme-switch-size) - 10px);");
    expect(switchRules).toContain("border-radius: var(--radius-pill);");
    expect(switchRules).toContain('theme-toggle[aria-checked="true"] .theme-toggle-thumb');
    expect(switchRules).toContain("transform: translateX(var(--theme-switch-size));");
    expect(productSource).toContain(".theme-toggle { --theme-switch-size: 44px; }");
    // 1px track border + 4px inset + (size - 10px) thumb leaves 5px on either side.
    for (const size of [40, 44]) {
      expect(1 + 4 + (size - 10) + 5).toBe(size);
    }
  });

  it("uses the theme foreground for checkbox marks rather than a white image", () => {
    const selections = productSource.slice(productSource.indexOf("/* Native selection"), productSource.indexOf("/* Onboarding, prompt"));
    expect(selections).toContain('input[type="checkbox"]:where(:not(.toggle-row input))');
    expect(selections).toContain("color: var(--text-on-accent);");
    expect(selections).toContain("background: currentColor;");
    expect(selections).toContain("mask: url(");
    expect(selections).toContain(":is(:checked, :indeterminate)::before { visibility: visible; }");
    expect(selections).not.toContain("stroke='%23fff'");
  });

  it("distinguishes active tabs from transparent inactive choices", () => {
    const tabs = productSource.slice(productSource.indexOf(":root[data-theme] :is(.segmented,"), productSource.indexOf("/* Overlays"));
    expect(tabs).toContain("background: transparent;");
    expect(tabs).toContain(':is(.active, .is-active, [aria-selected="true"], [aria-pressed="true"])');
    expect(tabs).toContain("border-color: var(--border-strong) !important; background: var(--surface);");
  });

  it("outlines the issue view switch against its shaded toolbar in both themes", () => {
    const switchRules = productSource.slice(productSource.indexOf("/* The issue view switch"), productSource.indexOf(":root[data-theme] :is(.segmented,"));
    expect(switchRules).toContain(":root[data-theme] .app-shell .problem-view-tabs");
    expect(switchRules).toContain("border: 1px solid var(--field-border-hover) !important;");
    expect(switchRules).toContain("background: color-mix(in srgb, var(--border-panel) 45%, var(--surface-pressed));");
    expect(switchRules).toContain(".problem-view-switch-thumb");
    expect(switchRules).toContain("background: var(--surface);");
    expect(switchRules).toContain("box-shadow: none;");
  });

  it("centers issue controls between equal sides and stacks the count below its title", () => {
    const toolbar = productSource.slice(productSource.indexOf("/* One issue inventory"), productSource.indexOf("/* The issue view switch"));
    expect(toolbar).toContain("grid-template-columns: minmax(144px, 1fr) minmax(0, 680px) minmax(144px, 1fr);");
    expect(toolbar).toContain(".issue-toolbar-title { display: flex; flex-direction: column; align-items: flex-start;");
    expect(toolbar).toContain(".issue-toolbar-controls { display: flex; align-items: center; justify-content: center;");
    expect(toolbar).toContain("flex-wrap: wrap;");
  });

  it("keeps the onboarding composer border intact instead of masking its corners", () => {
    const composer = onboardingSource.slice(onboardingSource.lastIndexOf('{showComposer &&'));
    expect(composer).toContain('<form');
    expect(composer).toContain('className="delphi-composer"');
    expect(composer).not.toContain("clipPath");
    expect(composer).not.toContain("filter:");
    const controls = productSource.slice(productSource.indexOf("/* Chat composers"), productSource.indexOf(":root[data-theme] .app-shell .searchbox { padding"));
    expect(controls).toContain("border: 1px solid var(--field-state-border, var(--field-border)) !important;");
    expect(controls).toContain("border-radius: var(--field-radius);");
    expect(controls).toContain("box-shadow: none !important;");
    expect(controls).toContain("padding: 8px 8px 8px 16px;");
  });

  it("gives chat send buttons explicit active and disabled color pairs", () => {
    const controls = productSource.slice(productSource.indexOf("/* Chat composers"), productSource.indexOf(":root[data-theme] .app-shell .searchbox { padding"));
    expect(controls).toContain(".delphi-send, .integration-copilot-composer > button, .prompt-testing-send");
    expect(controls).toContain("--icon-context-color: currentColor;");
    expect(controls).toContain("background: var(--accent-fill);");
    expect(controls).toContain("color: var(--text-on-accent);");
    const disabled = controls.slice(controls.indexOf("):disabled {"));
    expect(disabled).toContain("background: var(--surface-pressed);");
    expect(disabled).toContain("color: var(--text-muted);");
    expect(disabled).toContain("opacity: 1;");
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

  it.each([":root", ':root[data-theme="dark"]'])("separates board tickets from the canvas with readable text in %s", (selector) => {
    const board = tokensFor(selector, productSource);
    const text = tokensFor(selector);
    expect(luminance(board["--surface-ticket"])).toBeGreaterThan(luminance(board["--surface-board"]));
    expect(contrast(board["--surface-ticket"], board["--surface-board"])).toBeGreaterThan(1.1);
    expect(contrast(board["--surface-board-column"], board["--surface-board"])).toBeGreaterThan(1.1);
    for (const surface of ["--surface-ticket", "--surface-ticket-hover", "--surface-board"]) {
      expect(contrast(text["--text-strong"], board[surface])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(text["--text-muted"], board[surface])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("outlines each stage while keeping tickets distinct and interaction states visible", () => {
    const board = productSource.slice(productSource.indexOf("/* The board is a quiet canvas"), productSource.indexOf(":root[data-theme] .metric-value"));
    expect(board).toContain("background: var(--surface-ticket) !important;");
    expect(board).toContain("border: 1px solid var(--border-ticket) !important;");
    expect(board).toContain("background: transparent;");
    const columns = board.slice(board.indexOf(".board .board-col {"), board.indexOf(".board .board-col.is-drop-target"));
    expect(columns).toContain("border: 1px solid var(--border-board-column) !important;");
    expect(columns).toContain("background: var(--surface-board-column);");
    expect(board).toContain(".board-stage-dot");
    expect(board).toContain('data-stage="In progress"');
    expect(board).toContain(".board-stage-count");
    expect(board).toContain(".problem-card-shell:focus-within");
    expect(board).toContain("background: var(--surface-ticket-hover) !important;");
    expect(board).toContain("outline: 2px dashed var(--accent-line);");
    expect(board).toContain("border-color: CanvasText !important;");
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

  it.each([
    ["light", light],
    ["dark", dark],
  ] as const)("keeps both conversation roles readable in %s mode", (_, tokens) => {
    expect(contrast(tokens["--text"], tokens["--surface-muted"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens["--text-strong"], tokens["--surface-pressed"])).toBeGreaterThanOrEqual(4.5);
  });

  it("pairs user message colors and removes legacy tails on every shared chat surface", () => {
    const conversations = productSource.slice(productSource.indexOf("/* Pair each message surface"), productSource.indexOf("/* Controls respond to hover/press"));
    expect(conversations).toContain(".delphi-bubble.user, .integration-copilot-message.user, .prompt-testing-message.is-user");
    expect(conversations).toContain("background: var(--surface-pressed);");
    expect(conversations).toContain("color: var(--text-strong);");
    expect(conversations).toContain("{ color: inherit; }");
    expect(conversations).toContain(".delphi-bubble, .integration-copilot-message)::before");
    expect(conversations).toContain(".delphi-bubble, .integration-copilot-message)::after");
    expect(conversations).toContain("content: none;");
    expect(conversations).toContain("overflow-wrap: anywhere;");
  });

  it("does not mount flashing global interaction overlays, but retains hover, press, and focus states", () => {
    expect(layoutSource).not.toContain("GooeyInteractions");
    expect(productSource).toContain("transition: background-color 160ms ease-out");
    expect(productSource).toContain(":hover:not(:disabled)");
    expect(productSource).toContain(":active:not(:disabled)");
    expect(productSource).toContain("outline: 2px solid var(--focus-ring)");
    expect(productSource).toContain('button[data-ready="true"] svg { animation: none; }');
    expect(productSource).toContain("-webkit-text-fill-color: currentColor;");
    expect(productSource).not.toContain(".spin { animation: none");
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
