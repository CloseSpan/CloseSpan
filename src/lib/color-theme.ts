export const COLOR_THEME_STORAGE_KEY = "closespan-theme";
export const ACCENT_COLOR_STORAGE_KEY = "closespan-accent";

export type ColorTheme = "light" | "dark";
export const COLOR_THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ColorThemePreference = (typeof COLOR_THEME_PREFERENCES)[number];

export const DEFAULT_COLOR_THEME: ColorTheme = "light";
export const DEFAULT_ACCENT_COLOR = "neutral";

export const ACCENT_COLORS = [
  { id: "neutral", label: "Neutral", swatch: "#777b84" },
  { id: "blue", label: "Blue", swatch: "#487bea" },
  { id: "cyan", label: "Cyan", swatch: "#24a9bf" },
  { id: "amber", label: "Amber", swatch: "#dba632" },
  { id: "orange", label: "Orange", swatch: "#e78043" },
  { id: "pink", label: "Pink", swatch: "#d9689f" },
  { id: "purple", label: "Purple", swatch: "#a078d7" },
  { id: "green", label: "Green", swatch: "#54a875" },
] as const;

export type AccentColor = (typeof ACCENT_COLORS)[number]["id"];

function accentTokens(
  accent: string,
  hover: string,
  active: string,
  soft: string,
  line: string,
  foreground: string,
) {
  return {
    "--accent": accent,
    "--accent-hover": hover,
    "--accent-active": active,
    "--accent-fill": accent,
    "--accent-fill-hover": hover,
    "--accent-fill-active": active,
    "--accent-soft": soft,
    "--accent-line": line,
    "--focus-ring": accent,
    "--link": accent,
    "--text-on-accent": foreground,
  };
}

// Semantic success/warning/danger colors deliberately remain owned by the theme.
// Light accents support white button labels; dark accents support dark labels.
export const ACCENT_THEME_TOKENS = {
  light: {
    blue: accentTokens("#245bcc", "#1e4da8", "#193f8a", "#edf3ff", "#bccdf5", "#ffffff"),
    cyan: accentTokens("#08748a", "#066174", "#064e60", "#e7f5f8", "#a8d9e2", "#ffffff"),
    amber: accentTokens("#8b5b0c", "#754c08", "#603e06", "#fff5df", "#e4cd9b", "#ffffff"),
    orange: accentTokens("#b14a10", "#9d410e", "#82360b", "#fff0e6", "#edc5aa", "#ffffff"),
    pink: accentTokens("#b33773", "#982b60", "#7e2350", "#fdebf3", "#e9b8cf", "#ffffff"),
    purple: accentTokens("#7342bc", "#60369e", "#502c83", "#f3ecff", "#d2bdeb", "#ffffff"),
    green: accentTokens("#237445", "#1c6139", "#164e2d", "#eaf6ef", "#b4d8c1", "#ffffff"),
  },
  dark: {
    blue: accentTokens("#8db4ff", "#a9c6ff", "#76a4fb", "#24334d", "#49668f", "#18191b"),
    cyan: accentTokens("#71d4e6", "#96e4f1", "#4fc0d7", "#173a42", "#39717c", "#18191b"),
    amber: accentTokens("#f0c56e", "#f5d48f", "#dfaf51", "#3e3220", "#81683a", "#18191b"),
    orange: accentTokens("#f5ad79", "#ffc499", "#e9955d", "#422d21", "#875e42", "#18191b"),
    pink: accentTokens("#f09fc7", "#f8b9d8", "#df87b3", "#412a37", "#845570", "#18191b"),
    purple: accentTokens("#c2a2f3", "#d5bcfb", "#ae8cde", "#352a46", "#6c5888", "#18191b"),
    green: accentTokens("#89d2a5", "#a4e1bc", "#6dbe8d", "#223a2c", "#49745b", "#18191b"),
  },
} satisfies Record<ColorTheme, Record<Exclude<AccentColor, "neutral">, ReturnType<typeof accentTokens>>>;

export const ACCENT_TOKEN_NAMES = Object.keys(ACCENT_THEME_TOKENS.light.blue) as Array<
  keyof ReturnType<typeof accentTokens>
>;

export function getAccentColorTokens(accent: AccentColor, theme: ColorTheme) {
  // Removing overrides restores the existing neutral CSS palette exactly.
  return accent === "neutral" ? null : ACCENT_THEME_TOKENS[theme][accent];
}

export const COLOR_THEME_COLORS: Record<ColorTheme, string> = {
  light: "#ffffff",
  dark: "#18191b",
};

// Runs before the first paint, using the same default as the client controller.
export const COLOR_THEME_BOOTSTRAP_SCRIPT = `(() => {
  const read = (key, allowed, fallback) => {
    let value = null;
    try {
      value = localStorage.getItem(key);
    } catch {}
    if (!allowed.includes(value)) {
      try {
        value = document.cookie.split(/;\\s*/)
          .find((entry) => entry.startsWith(key + "="))?.slice(key.length + 1);
      } catch {}
    }
    return allowed.includes(value) ? value : fallback;
  };
  const preference = read(${JSON.stringify(COLOR_THEME_STORAGE_KEY)}, ${JSON.stringify(COLOR_THEME_PREFERENCES)}, ${JSON.stringify(DEFAULT_COLOR_THEME)});
  const accent = read(${JSON.stringify(ACCENT_COLOR_STORAGE_KEY)}, ${JSON.stringify(ACCENT_COLORS.map(({ id }) => id))}, ${JSON.stringify(DEFAULT_ACCENT_COLOR)});
  let theme = preference;
  if (preference === "system") {
    theme = ${JSON.stringify(DEFAULT_COLOR_THEME)};
    try {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch {}
  }
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.themePreference = preference;
  root.dataset.accent = accent;
  root.style.colorScheme = theme;
  const palette = ${JSON.stringify(ACCENT_THEME_TOKENS)};
  const tokens = accent === "neutral" ? null : palette[theme][accent];
  ${JSON.stringify(ACCENT_TOKEN_NAMES)}.forEach((name) => {
    if (tokens) root.style.setProperty(name, tokens[name]);
    else root.style.removeProperty(name);
  });
  document.querySelectorAll('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute("content", theme === "dark"
      ? ${JSON.stringify(COLOR_THEME_COLORS.dark)}
      : ${JSON.stringify(COLOR_THEME_COLORS.light)}));
})();`;

export function isColorTheme(value: unknown): value is ColorTheme {
  return value === "light" || value === "dark";
}

export function isColorThemePreference(value: unknown): value is ColorThemePreference {
  return value === "system" || isColorTheme(value);
}

export function isAccentColor(value: unknown): value is AccentColor {
  return ACCENT_COLORS.some(({ id }) => id === value);
}

export function nextColorTheme(theme: ColorTheme): ColorTheme {
  return theme === "dark" ? "light" : "dark";
}
