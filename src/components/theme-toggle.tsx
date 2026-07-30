"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import {
  type ColorTheme,
  nextColorTheme,
} from "@/lib/color-theme";
import {
  applyColorTheme,
  resolveColorTheme,
  THEME_CHANGE_EVENT,
} from "@/lib/color-theme-client";

function subscribeToTheme(onStoreChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
  };
}

function serverTheme(): ColorTheme {
  return "light";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    resolveColorTheme,
    serverTheme,
  );

  const darkMode = theme === "dark";
  const destination = darkMode ? "light" : "dark";

  return (
    <div className="theme-control">
      <span className="theme-control-copy">
        <strong>Appearance</strong>
        <small>Light and dark</small>
      </span>
      <button
        type="button"
        className="theme-toggle"
        role="switch"
        aria-checked={darkMode}
        aria-label={`Switch to ${destination} mode`}
        title={`Switch to ${destination} mode`}
        onClick={() => {
          const updatedTheme = nextColorTheme(theme);
          applyColorTheme(updatedTheme, { persist: true });
        }}
      >
        <Sun className="theme-toggle-sun" aria-hidden="true" size={16} />
        <Moon className="theme-toggle-moon" aria-hidden="true" size={16} />
        <span className="theme-toggle-thumb" aria-hidden="true" />
      </button>
    </div>
  );
}
