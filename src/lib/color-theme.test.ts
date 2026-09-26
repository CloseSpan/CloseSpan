import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACCENT_COLORS,
  ACCENT_TOKEN_NAMES,
  getAccentColorTokens,
  isAccentColor,
  isColorTheme,
  isColorThemePreference,
  nextColorTheme,
} from "./color-theme";

describe("color theme", () => {
  it("accepts only supported theme values", () => {
    expect(isColorTheme("light")).toBe(true);
    expect(isColorTheme("dark")).toBe(true);
    expect(isColorTheme("system")).toBe(false);
    expect(isColorTheme(null)).toBe(false);
  });

  it("moves directly between light and dark modes", () => {
    expect(nextColorTheme("light")).toBe("dark");
    expect(nextColorTheme("dark")).toBe("light");
  });

  it("distinguishes an effective theme from a saved system preference", () => {
    expect(isColorThemePreference("system")).toBe(true);
    expect(isColorThemePreference("light")).toBe(true);
    expect(isColorThemePreference("dark")).toBe(true);
    expect(isColorThemePreference("sepia")).toBe(false);
    expect(isColorThemePreference(null)).toBe(false);
  });
});

function luminance(hex: string): number {
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

describe("accent palette", () => {
  const themeSource = readFileSync(new URL("../app/neumorphic-theme.css", import.meta.url), "utf8");

  function neutralTokens(theme: "light" | "dark"): Record<string, string> {
    const selector = theme === "light" ? ":root {" : ':root[data-theme="dark"] {';
    const start = themeSource.indexOf(selector);
    const block = themeSource.slice(start, themeSource.indexOf("}", start));
    return Object.fromEntries(Array.from(block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g), ([, name, value]) => [name, value.trim()]));
  }

  it("supports the eight named choices and rejects arbitrary style values", () => {
    expect(ACCENT_COLORS.map(({ id }) => id)).toEqual(["neutral", "blue", "cyan", "amber", "orange", "pink", "purple", "green"]);
    for (const { id } of ACCENT_COLORS) expect(isAccentColor(id)).toBe(true);
    expect(isAccentColor("red")).toBe(false);
    expect(isAccentColor("url(https://example.com)")).toBe(false);
    expect(isAccentColor(null)).toBe(false);
  });

  it("restores neutral CSS instead of overriding the incumbent palette", () => {
    expect(getAccentColorTokens("neutral", "light")).toBeNull();
    expect(getAccentColorTokens("neutral", "dark")).toBeNull();
    expect(ACCENT_TOKEN_NAMES.some((name) => /success|warning|danger|info/.test(name))).toBe(false);
  });

  for (const theme of ["light", "dark"] as const) {
    it.each(ACCENT_COLORS)(`keeps $label text and controls readable in ${theme} mode`, ({ id }) => {
      const tokens = getAccentColorTokens(id, theme) ?? neutralTokens(theme);
      for (const fill of ["--accent-fill", "--accent-fill-hover", "--accent-fill-active"] as const) {
        expect(contrast(tokens["--text-on-accent"], tokens[fill])).toBeGreaterThanOrEqual(4.5);
      }
      const surfaces = theme === "light" ? ["#ffffff", "#f7f7f8", "#f0f0f2"] : ["#18191b", "#202124", "#2c2e32"];
      for (const surface of surfaces) {
        expect(contrast(tokens["--link"], surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens["--focus-ring"], surface)).toBeGreaterThanOrEqual(3);
      }
      expect(contrast(tokens["--accent"], tokens["--accent-soft"])).toBeGreaterThanOrEqual(4.5);
    });
  }
});
