export const COLOR_THEME_STORAGE_KEY = "closespan-theme";

export type ColorTheme = "light" | "dark";

export const COLOR_THEME_COLORS: Record<ColorTheme, string> = {
  light: "#f0f2f9",
  dark: "#151b27",
};

export function isColorTheme(value: unknown): value is ColorTheme {
  return value === "light" || value === "dark";
}

export function nextColorTheme(theme: ColorTheme): ColorTheme {
  return theme === "dark" ? "light" : "dark";
}
