"use client";

import { useEffect } from "react";
import {
  applyColorTheme,
  applyColorThemePreference,
  resolveColorThemePreference,
  syncAppearanceFromStorage,
} from "@/lib/color-theme-client";

export function ThemeController() {
  useEffect(() => {
    applyColorThemePreference(resolveColorThemePreference(), {
      animate: false,
      notify: true,
    });

    window.addEventListener("storage", syncAppearanceFromStorage);

    const syncSystemTheme = (event: MediaQueryListEvent) => {
      if (resolveColorThemePreference() === "system") {
        applyColorTheme(event.matches ? "dark" : "light", { persist: false });
      }
    };
    let removeSystemListener = () => {};
    try {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      if (typeof media.addEventListener === "function") {
        media.addEventListener("change", syncSystemTheme);
        removeSystemListener = () => media.removeEventListener("change", syncSystemTheme);
      } else if (typeof media.addListener === "function") {
        media.addListener(syncSystemTheme);
        removeSystemListener = () => media.removeListener(syncSystemTheme);
      }
    } catch {
      // Explicit themes and the light fallback work without media-query access.
    }

    return () => {
      window.removeEventListener("storage", syncAppearanceFromStorage);
      removeSystemListener();
    };
  }, []);

  return null;
}
