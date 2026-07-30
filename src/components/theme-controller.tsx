"use client";

import { useEffect } from "react";
import {
  applyColorTheme,
  readStoredTheme,
  resolveColorTheme,
} from "@/lib/color-theme-client";
import { COLOR_THEME_STORAGE_KEY, isColorTheme } from "@/lib/color-theme";

export function ThemeController() {
  useEffect(() => {
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");

    applyColorTheme(resolveColorTheme(), {
      animate: false,
      notify: true,
    });

    const followSystemTheme = (event: MediaQueryListEvent) => {
      if (readStoredTheme()) return;
      applyColorTheme(event.matches ? "dark" : "light", { persist: false });
    };

    const syncStoredTheme = (event: StorageEvent) => {
      if (event.key !== COLOR_THEME_STORAGE_KEY) return;
      const nextTheme = isColorTheme(event.newValue)
        ? event.newValue
        : colorScheme.matches
          ? "dark"
          : "light";
      applyColorTheme(nextTheme, { persist: false });
    };

    colorScheme.addEventListener("change", followSystemTheme);
    window.addEventListener("storage", syncStoredTheme);

    return () => {
      colorScheme.removeEventListener("change", followSystemTheme);
      window.removeEventListener("storage", syncStoredTheme);
    };
  }, []);

  return null;
}
