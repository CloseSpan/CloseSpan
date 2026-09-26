"use client";

import {
  ACCENT_COLOR_STORAGE_KEY,
  ACCENT_TOKEN_NAMES,
  COLOR_THEME_COLORS,
  COLOR_THEME_STORAGE_KEY,
  DEFAULT_ACCENT_COLOR,
  DEFAULT_COLOR_THEME,
  type AccentColor,
  type ColorTheme,
  type ColorThemePreference,
  getAccentColorTokens,
  isAccentColor,
  isColorTheme,
  isColorThemePreference,
} from "@/lib/color-theme";

export const THEME_CHANGE_EVENT = "closespan-theme-change";

function readStoredValue<T extends string>(key: string, isValid: (value: unknown) => value is T): T | null {
  try {
    const value = window.localStorage.getItem(key);
    if (isValid(value)) return value;
  } catch {
    // Storage can be unavailable in privacy-restricted browsing contexts.
  }

  try {
    const value = document.cookie
      .split(/;\s*/)
      .find((entry) => entry.startsWith(`${key}=`))
      ?.slice(key.length + 1);
    return isValid(value) ? value : null;
  } catch {
    return null;
  }
}

export function readStoredThemePreference(): ColorThemePreference | null {
  return readStoredValue(COLOR_THEME_STORAGE_KEY, isColorThemePreference);
}

export function readStoredAccentColor(): AccentColor | null {
  return readStoredValue(ACCENT_COLOR_STORAGE_KEY, isAccentColor);
}

export function resolveColorThemePreference(): ColorThemePreference {
  const preference = typeof document === "undefined" ? undefined : document.documentElement.dataset.themePreference;
  return isColorThemePreference(preference) ? preference : readStoredThemePreference() ?? DEFAULT_COLOR_THEME;
}

export function resolveAccentColor(): AccentColor {
  const accent = typeof document === "undefined" ? undefined : document.documentElement.dataset.accent;
  return isAccentColor(accent) ? accent : readStoredAccentColor() ?? DEFAULT_ACCENT_COLOR;
}

export function resolveColorTheme(preference?: ColorThemePreference): ColorTheme {
  if (preference === undefined) {
    const documentTheme = typeof document === "undefined" ? undefined : document.documentElement.dataset.theme;
    if (isColorTheme(documentTheme)) return documentTheme;
    preference = resolveColorThemePreference();
  }
  if (isColorTheme(preference)) return preference;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return DEFAULT_COLOR_THEME;
  }
}

// Keep the original effective-theme reader compatible with quick-toggle callers.
export function readStoredTheme(): ColorTheme | null {
  const preference = readStoredThemePreference();
  return preference === null ? null : resolveColorTheme(preference);
}

function persistAppearanceValue(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The cookie below remains a durable fallback when storage is blocked.
  }
  persistAppearanceCookie(key, value);
}

function persistAppearanceCookie(key: string, value: string) {
  try {
    const hostname = window.location.hostname;
    const sharedDomain = hostname === "closespan.com" || hostname.endsWith(".closespan.com")
      ? "; domain=.closespan.com; secure"
      : "";
    document.cookie = `${key}=${value}; path=/; max-age=31536000; samesite=lax${sharedDomain}`;
  } catch {
    // Switching must remain usable even when cookies are restricted.
  }
}

function syncThemeColor(theme: ColorTheme) {
  document
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute("content", COLOR_THEME_COLORS[theme]));
}

export type ApplyAppearanceOptions = { persist?: boolean; animate?: boolean; notify?: boolean };

function notifyAppearanceChange(notify = true) {
  if (notify) window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

function syncAccentTokens(accent: AccentColor, theme: ColorTheme) {
  const root = document.documentElement;
  root.dataset.accent = accent;
  const tokens = getAccentColorTokens(accent, theme);
  for (const name of ACCENT_TOKEN_NAMES) {
    if (tokens) root.style.setProperty(name, tokens[name]);
    else root.style.removeProperty(name);
  }
}

export function applyColorTheme(theme: ColorTheme, options: ApplyAppearanceOptions = {}) {
  const { persist = false, animate = true, notify = true } = options;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;

  if (animate) {
    root.dataset.themeTransitioning = "true";
    window.setTimeout(() => {
      delete root.dataset.themeTransitioning;
    }, 280);
  }

  if (persist) {
    root.dataset.themePreference = theme;
    persistAppearanceValue(COLOR_THEME_STORAGE_KEY, theme);
  }

  syncAccentTokens(resolveAccentColor(), theme);
  syncThemeColor(theme);
  notifyAppearanceChange(notify);
}

export function applyColorThemePreference(preference: ColorThemePreference, options: ApplyAppearanceOptions = {}) {
  document.documentElement.dataset.themePreference = preference;
  if (options.persist) persistAppearanceValue(COLOR_THEME_STORAGE_KEY, preference);
  applyColorTheme(resolveColorTheme(preference), { ...options, persist: false });
}

export function applyAccentColor(accent: AccentColor, options: ApplyAppearanceOptions = {}) {
  syncAccentTokens(accent, resolveColorTheme());
  if (options.persist) persistAppearanceValue(ACCENT_COLOR_STORAGE_KEY, accent);
  notifyAppearanceChange(options.notify);
}

export function syncAppearanceFromStorage(event: StorageEvent) {
  try {
    if (event.storageArea && event.storageArea !== window.localStorage) return;
  } catch {
    // An inaccessible storage object must not prevent applying an event's value.
  }
  const themeChanged = event.key === COLOR_THEME_STORAGE_KEY || event.key === null;
  const accentChanged = event.key === ACCENT_COLOR_STORAGE_KEY || event.key === null;
  if (themeChanged) {
    const preference = isColorThemePreference(event.newValue) ? event.newValue : DEFAULT_COLOR_THEME;
    applyColorThemePreference(preference, { notify: false });
    // Keep the fallback consistent after removeItem()/clear(), without writing
    // back to localStorage or causing another round of cross-tab storage events.
    persistAppearanceCookie(COLOR_THEME_STORAGE_KEY, preference);
  }
  if (accentChanged) {
    const accent = isAccentColor(event.newValue) ? event.newValue : DEFAULT_ACCENT_COLOR;
    applyAccentColor(accent, { notify: false });
    persistAppearanceCookie(ACCENT_COLOR_STORAGE_KEY, accent);
  }
  if (themeChanged || accentChanged) notifyAppearanceChange();
}
