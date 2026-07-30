"use client";

import {
  COLOR_THEME_COLORS,
  COLOR_THEME_STORAGE_KEY,
  type ColorTheme,
  isColorTheme,
} from "@/lib/color-theme";

export const THEME_CHANGE_EVENT = "closespan-theme-change";

function readThemeCookie(): ColorTheme | null {
  try {
    const value = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${COLOR_THEME_STORAGE_KEY}=`))
      ?.split("=")[1];
    return isColorTheme(value) ? value : null;
  } catch {
    return null;
  }
}

export function readStoredTheme(): ColorTheme | null {
  try {
    const value = window.localStorage.getItem(COLOR_THEME_STORAGE_KEY);
    if (isColorTheme(value)) return value;
  } catch {
    // Storage can be unavailable in privacy-restricted browsing contexts.
  }

  return readThemeCookie();
}

export function resolveColorTheme(): ColorTheme {
  const documentTheme = document.documentElement.dataset.theme;
  if (isColorTheme(documentTheme)) return documentTheme;

  return (
    readStoredTheme() ??
    (window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light")
  );
}

function syncThemeColor(theme: ColorTheme) {
  document
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute("content", COLOR_THEME_COLORS[theme]));
}

export function applyColorTheme(
  theme: ColorTheme,
  options: { persist?: boolean; animate?: boolean; notify?: boolean } = {},
) {
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
    try {
      window.localStorage.setItem(COLOR_THEME_STORAGE_KEY, theme);
    } catch {
      // The cookie below remains a durable fallback when storage is blocked.
    }

    try {
      const sharedDomain = window.location.hostname.endsWith("closespan.com")
        ? "; domain=.closespan.com; secure"
        : "";
      document.cookie = `${COLOR_THEME_STORAGE_KEY}=${theme}; path=/; max-age=31536000; samesite=lax${sharedDomain}`;
    } catch {
      // Theme switching must remain usable even when cookies are restricted.
    }
  }

  syncThemeColor(theme);

  if (notify) {
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }
}
