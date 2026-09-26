import { useEffect } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCENT_COLOR_STORAGE_KEY, ACCENT_THEME_TOKENS, COLOR_THEME_STORAGE_KEY } from "@/lib/color-theme";
import { applyColorTheme, applyColorThemePreference } from "@/lib/color-theme-client";
import { ThemeController } from "./theme-controller";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: vi.fn(),
}));

describe("ThemeController", () => {
  const getItem = vi.fn<(key: string) => string | null>();
  let browserWindow: EventTarget;
  let systemTheme: EventTarget & { matches: boolean };
  let styles: Map<string, string>;
  let root: { dataset: { theme?: string; themePreference?: string; accent?: string }; style: { colorScheme?: string; setProperty: (key: string, value: string) => unknown; removeProperty: (key: string) => unknown } };
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    vi.mocked(useEffect).mockClear();
    getItem.mockReset().mockReturnValue(null);
    styles = new Map();
    root = { dataset: {}, style: { setProperty: (key, value) => styles.set(key, value), removeProperty: (key) => styles.delete(key) } };
    systemTheme = Object.assign(new EventTarget(), { matches: true });
    browserWindow = Object.assign(new EventTarget(), {
      localStorage: { getItem, setItem: vi.fn() },
      matchMedia: vi.fn().mockReturnValue(systemTheme),
      setTimeout: vi.fn(),
      location: { hostname: "localhost" },
    });
    vi.stubGlobal("window", browserWindow);
    vi.stubGlobal("document", {
      documentElement: root,
      cookie: "",
      querySelectorAll: () => [],
    });
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.unstubAllGlobals();
  });

  function mountController() {
    renderToStaticMarkup(<ThemeController />);
    const effect = vi.mocked(useEffect).mock.calls.at(-1)![0];
    cleanup = effect() as (() => void) | undefined;
  }

  function dispatchStorage(newValue: string | null, key: string | null = COLOR_THEME_STORAGE_KEY) {
    browserWindow.dispatchEvent(Object.assign(new Event("storage"), { key, newValue }));
  }

  it("initializes light and stays light when the system preference changes", () => {
    mountController();

    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");

    systemTheme.dispatchEvent(Object.assign(new Event("change"), { matches: true }));

    expect(root.dataset.theme).toBe("light");
    expect(window.matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
  });

  it.each(["light", "dark"] as const)("initializes the saved %s preference", (theme) => {
    getItem.mockReturnValue(theme);
    mountController();

    expect(root.dataset.theme).toBe(theme);
  });

  it("synchronizes explicit theme changes from another tab", () => {
    mountController();
    dispatchStorage("dark");

    expect(root.dataset.theme).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");

    dispatchStorage("light");

    expect(root.dataset.theme).toBe("light");
  });

  it.each([null, "sepia"])("resets to light for a removed or invalid preference (%s)", (value) => {
    getItem.mockReturnValue("dark");
    mountController();
    dispatchStorage(value);

    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");
  });

  it("follows live system changes only while system is selected", () => {
    getItem.mockImplementation((key) => key === COLOR_THEME_STORAGE_KEY ? "system" : key === ACCENT_COLOR_STORAGE_KEY ? "blue" : null);
    mountController();
    expect(root.dataset).toMatchObject({ theme: "dark", themePreference: "system", accent: "blue" });
    expect(styles.get("--accent-fill")).toBe(ACCENT_THEME_TOKENS.dark.blue["--accent-fill"]);

    systemTheme.matches = false;
    systemTheme.dispatchEvent(Object.assign(new Event("change"), { matches: false }));
    expect(root.dataset.theme).toBe("light");
    expect(styles.get("--accent-fill")).toBe(ACCENT_THEME_TOKENS.light.blue["--accent-fill"]);

    applyColorTheme("dark", { persist: true });
    systemTheme.dispatchEvent(Object.assign(new Event("change"), { matches: false }));
    expect(root.dataset).toMatchObject({ theme: "dark", themePreference: "dark" });

    applyColorThemePreference("system", { persist: true });
    expect(root.dataset).toMatchObject({ theme: "light", themePreference: "system" });
    systemTheme.matches = true;
    systemTheme.dispatchEvent(Object.assign(new Event("change"), { matches: true }));
    expect(root.dataset.theme).toBe("dark");
  });

  it("synchronizes system and accent preferences from another tab and handles localStorage.clear()", () => {
    mountController();
    dispatchStorage("system");
    dispatchStorage("orange", ACCENT_COLOR_STORAGE_KEY);
    expect(root.dataset).toMatchObject({ theme: "dark", themePreference: "system", accent: "orange" });
    expect(styles.get("--accent-fill")).toBe(ACCENT_THEME_TOKENS.dark.orange["--accent-fill"]);

    dispatchStorage(null, null);
    expect(root.dataset).toMatchObject({ theme: "light", themePreference: "light", accent: "neutral" });
    expect(styles.size).toBe(0);
  });

  it.each([null, "invalid"])("resets a removed or invalid accent (%s) independently", (value) => {
    getItem.mockImplementation((key) => key === COLOR_THEME_STORAGE_KEY ? "dark" : key === ACCENT_COLOR_STORAGE_KEY ? "purple" : null);
    mountController();
    dispatchStorage(value, ACCENT_COLOR_STORAGE_KEY);
    expect(root.dataset).toMatchObject({ theme: "dark", accent: "neutral" });
    expect(styles.size).toBe(0);
  });

  it("falls back to light for system mode when media access is blocked", () => {
    getItem.mockReturnValue("system");
    vi.mocked(window.matchMedia).mockImplementation(() => { throw new Error("Blocked"); });
    expect(mountController).not.toThrow();
    expect(root.dataset).toMatchObject({ theme: "light", themePreference: "system" });
  });

  it("uses and removes the legacy media-query listener when needed", () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true, addListener, removeListener } as unknown as MediaQueryList);
    mountController();
    expect(addListener).toHaveBeenCalledOnce();
    cleanup?.();
    cleanup = undefined;
    expect(removeListener).toHaveBeenCalledWith(addListener.mock.calls[0][0]);
  });

  it("ignores unrelated storage changes and removes its listener on unmount", () => {
    mountController();
    dispatchStorage("dark", "unrelated-setting");

    expect(root.dataset.theme).toBe("light");

    cleanup?.();
    cleanup = undefined;
    dispatchStorage("dark");

    expect(root.dataset.theme).toBe("light");
  });

  it("removes the system listener on unmount", () => {
    getItem.mockReturnValue("system");
    mountController();
    expect(root.dataset.theme).toBe("dark");
    cleanup?.();
    cleanup = undefined;
    systemTheme.dispatchEvent(Object.assign(new Event("change"), { matches: false }));
    expect(root.dataset.theme).toBe("dark");
  });
});
