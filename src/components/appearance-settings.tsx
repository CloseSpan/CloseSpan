"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  ACCENT_COLORS,
  COLOR_THEME_PREFERENCES,
  DEFAULT_ACCENT_COLOR,
  DEFAULT_COLOR_THEME,
  getAccentColorTokens,
  type AccentColor,
  type ColorThemePreference,
} from "@/lib/color-theme";
import {
  applyAccentColor,
  applyColorThemePreference,
  resolveAccentColor,
  resolveColorThemePreference,
  THEME_CHANGE_EVENT,
} from "@/lib/color-theme-client";
import styles from "./appearance-settings.module.css";

/* THESIS: Personal appearance is an immediate choice, not workspace policy.
 * OWN-WORLD: The pinned Attio reference within CloseSpan's neutral Geist system.
 * STORY: Pick a theme, choose an accent, see it applied without a save step.
 * FIRST VIEWPORT: One heading, three visual radio choices, one swatch row.
 * FORM: Precisely specified extension of Settings; no replacement identity.
 */

const themes = {
  light: { label: "Light", Icon: Sun },
  dark: { label: "Dark", Icon: Moon },
  system: { label: "System", Icon: Monitor },
};

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange);
}

function PreviewSurface({ theme, accent }: { theme: "light" | "dark"; accent: AccentColor }) {
  const tokens = getAccentColorTokens(accent, theme);
  const previewStyle = {
    "--preview-accent": tokens?.["--accent-fill"] ?? (theme === "dark" ? "#eeeeef" : "#1c1d1f"),
    "--preview-focus": tokens?.["--focus-ring"] ?? (theme === "dark" ? "#9caaff" : "#5267c8"),
  } as CSSProperties;
  return (
    <div className={styles.previewSurface} data-preview={theme} style={previewStyle}>
      <div className={styles.previewRail}>
        <span className={styles.previewBrand} />
        {Array.from({ length: 5 }, (_, index) => <i key={index} />)}
      </div>
      <div className={styles.previewBody}>
        <div className={styles.previewToolbar}><i /><i /></div>
        <div className={styles.previewTable}>
          {Array.from({ length: 18 }, (_, index) => (
            <span className={index === 6 ? styles.previewSelected : undefined} key={index}><i /></span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ThemePreview({ theme, accent }: { theme: ColorThemePreference; accent: AccentColor }) {
  return (
    <span className={styles.preview} aria-hidden="true">
      {theme === "system" ? (
        <>
          <span className={styles.previewHalf}><PreviewSurface theme="light" accent={accent} /></span>
          <span className={`${styles.previewHalf} ${styles.previewHalfDark}`}><PreviewSurface theme="dark" accent={accent} /></span>
        </>
      ) : <PreviewSurface theme={theme} accent={accent} />}
    </span>
  );
}

export function AppearanceSettings() {
  const theme = useSyncExternalStore<ColorThemePreference>(subscribe, resolveColorThemePreference, () => DEFAULT_COLOR_THEME);
  const accent = useSyncExternalStore<AccentColor>(subscribe, resolveAccentColor, () => DEFAULT_ACCENT_COLOR);
  const [announcement, setAnnouncement] = useState("");

  return (
    <section className={styles.page} aria-labelledby="appearance-title">
      <header className={styles.header}>
        <h1 id="appearance-title">Appearance</h1>
        <p>Saved on this browser.</p>
      </header>

      <fieldset className={styles.themeFieldset}>
        <legend>Theme</legend>
        <div className={styles.themes}>
          {COLOR_THEME_PREFERENCES.map((value) => {
            const { label, Icon } = themes[value];
            return (
              <label className={styles.themeOption} key={value}>
                <input
                  className={styles.radio}
                  type="radio"
                  name="appearance-theme"
                  value={value}
                  checked={theme === value}
                  onChange={() => {
                    applyColorThemePreference(value, { persist: true });
                    setAnnouncement(`${label} theme applied.`);
                  }}
                />
                <ThemePreview theme={value} accent={accent} />
                <span className={styles.themeLabel}>
                  <Icon size={17} aria-hidden="true" />
                  {label}
                  <Check size={15} className={styles.selectionCheck} aria-hidden="true" />
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className={styles.accentFieldset}>
        <legend>Accent color</legend>
        <div className={styles.swatches}>
          {ACCENT_COLORS.map((color) => (
            <label className={styles.swatchOption} title={color.label} key={color.id}>
              <input
                className={styles.radio}
                type="radio"
                name="appearance-accent"
                value={color.id}
                checked={accent === color.id}
                aria-label={color.label}
                onChange={() => {
                  applyAccentColor(color.id, { persist: true });
                  setAnnouncement(`${color.label} accent applied.`);
                }}
              />
              <span className={styles.swatch} style={{ "--swatch-color": color.swatch } as CSSProperties} aria-hidden="true" />
            </label>
          ))}
        </div>
      </fieldset>
      <p className={styles.announcement} role="status" aria-live="polite">{announcement}</p>
    </section>
  );
}
