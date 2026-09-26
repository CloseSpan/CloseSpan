import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCENT_COLOR_STORAGE_KEY,
  ACCENT_TOKEN_NAMES,
  ACCENT_THEME_TOKENS,
  COLOR_THEME_BOOTSTRAP_SCRIPT,
  COLOR_THEME_COLORS,
  COLOR_THEME_STORAGE_KEY,
} from "./color-theme";
import {
  applyAccentColor,
  applyColorTheme,
  applyColorThemePreference,
  readStoredAccentColor,
  readStoredTheme,
  readStoredThemePreference,
  resolveAccentColor,
  resolveColorTheme,
  resolveColorThemePreference,
  syncAppearanceFromStorage,
  THEME_CHANGE_EVENT,
} from "./color-theme-client";

describe("client color theme resolution", () => {
  const getItem = vi.fn<(key: string) => string | null>();
  let root: { dataset: { theme?: string; themePreference?: string; accent?: string } };
  let browserDocument: { documentElement: typeof root; cookie: string };

  beforeEach(() => {
    getItem.mockReset().mockReturnValue(null);
    root = { dataset: {} };
    browserDocument = { documentElement: root, cookie: "" };
    vi.stubGlobal("document", browserDocument);
    vi.stubGlobal("window", {
      localStorage: { getItem },
      matchMedia: vi.fn().mockReturnValue({ matches: true }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to light even when the operating system prefers dark", () => {
    expect(resolveColorTheme()).toBe("light");
  });

  it.each(["light", "dark"] as const)("preserves a saved %s preference", (theme) => {
    getItem.mockReturnValue(theme);

    expect(resolveColorTheme()).toBe(theme);
    expect(getItem).toHaveBeenCalledWith(COLOR_THEME_STORAGE_KEY);
  });

  it("preserves the applied document theme before consulting storage", () => {
    root.dataset.theme = "light";
    getItem.mockReturnValue("dark");

    expect(resolveColorTheme()).toBe("light");
    expect(getItem).not.toHaveBeenCalled();
  });

  it("ignores unsupported document and saved preferences", () => {
    root.dataset.theme = "sepia";
    getItem.mockReturnValue("sepia");

    expect(resolveColorTheme()).toBe("light");
  });

  it("resolves a saved system preference without treating it as an effective theme", () => {
    getItem.mockImplementation((key) => key === COLOR_THEME_STORAGE_KEY ? "system" : null);

    expect(readStoredThemePreference()).toBe("system");
    expect(resolveColorThemePreference()).toBe("system");
    expect(resolveColorTheme()).toBe("dark");
    expect(readStoredTheme()).toBe("dark");
  });

  it("resolves system to light when matchMedia is unavailable or blocked", () => {
    getItem.mockReturnValue("system");
    vi.mocked(window.matchMedia).mockImplementation(() => { throw new Error("Unavailable"); });
    expect(resolveColorTheme()).toBe("light");
  });

  it("recovers and validates an accent cookie independently of the theme", () => {
    getItem.mockReturnValue("invalid");
    browserDocument.cookie = `${COLOR_THEME_STORAGE_KEY}=system;${ACCENT_COLOR_STORAGE_KEY}=purple`;
    expect(readStoredAccentColor()).toBe("purple");
    expect(resolveAccentColor()).toBe("purple");
    root.dataset.accent = "cyan";
    expect(resolveAccentColor()).toBe("cyan");
  });

  it.each(["light", "dark"] as const)(
    "recovers the saved %s cookie when local storage is blocked",
    (theme) => {
      getItem.mockImplementation(() => {
        throw new Error("Storage is blocked");
      });
      browserDocument.cookie = `other=value; ${COLOR_THEME_STORAGE_KEY}=${theme}`;

      expect(readStoredTheme()).toBe(theme);
      expect(resolveColorTheme()).toBe(theme);
    },
  );

  it("defaults to light when both storage and cookies are blocked", () => {
    getItem.mockImplementation(() => {
      throw new Error("Storage is blocked");
    });
    Object.defineProperty(browserDocument, "cookie", {
      get: () => {
        throw new Error("Cookies are blocked");
      },
    });

    expect(resolveColorTheme()).toBe("light");
  });
});

describe("color theme before the first paint", () => {
  it.each([
    { name: "no preference on a dark system", stored: null, cookie: "", expected: "light" },
    { name: "saved light", stored: "light", cookie: "", expected: "light" },
    { name: "saved dark", stored: "dark", cookie: "", expected: "dark" },
    { name: "saved dark with blocked cookies", stored: "dark", cookie: null, expected: "dark" },
    { name: "saved system on a dark system", stored: "system", cookie: "light", expected: "dark" },
    { name: "invalid storage with a valid cookie", stored: "sepia", cookie: "dark", expected: "dark" },
    { name: "blocked storage with a valid cookie", stored: undefined, cookie: "dark", expected: "dark" },
    { name: "both storage and cookies blocked", stored: undefined, cookie: null, expected: "light" },
  ] as const)("uses the expected theme for $name", ({ stored, cookie, expected }) => {
    const root = { dataset: { theme: "light" }, style: { colorScheme: "light", setProperty: vi.fn(), removeProperty: vi.fn() } };
    const setAttribute = vi.fn();
    const matchMedia = vi.fn().mockReturnValue({ matches: true });

    runInNewContext(COLOR_THEME_BOOTSTRAP_SCRIPT, {
      localStorage: {
        getItem: (key: string) => {
          if (stored === undefined) throw new Error("Storage is blocked");
          return key === COLOR_THEME_STORAGE_KEY ? stored : null;
        },
      },
      document: {
        documentElement: root,
        get cookie() {
          if (cookie === null) throw new Error("Cookies are blocked");
          return `${COLOR_THEME_STORAGE_KEY}=${cookie}`;
        },
        querySelectorAll: () => [{ setAttribute }],
      },
      window: { matchMedia },
      matchMedia,
    });

    expect(root.dataset.theme).toBe(expected);
    expect(root.style.colorScheme).toBe(expected);
    expect(setAttribute).toHaveBeenCalledWith("content", COLOR_THEME_COLORS[expected]);
    if (stored === "system") expect(matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
    else expect(matchMedia).not.toHaveBeenCalled();
  });

  it.each([true, false])("applies the saved accent before paint with dark system=%s", (matches) => {
    const values = new Map<string, string>();
    const root = {
      dataset: {} as Record<string, string>,
      style: { colorScheme: "", setProperty: (key: string, value: string) => values.set(key, value), removeProperty: (key: string) => values.delete(key) },
    };
    runInNewContext(COLOR_THEME_BOOTSTRAP_SCRIPT, {
      localStorage: { getItem: () => null },
      document: { documentElement: root, cookie: `${COLOR_THEME_STORAGE_KEY}=system;${ACCENT_COLOR_STORAGE_KEY}=purple`, querySelectorAll: () => [] },
      window: { matchMedia: () => ({ matches }) },
    });
    const theme = matches ? "dark" : "light";
    expect(root.dataset).toMatchObject({ theme, themePreference: "system", accent: "purple" });
    expect(Object.fromEntries(values)).toEqual(ACCENT_THEME_TOKENS[theme].purple);
  });

  it("falls back safely when the saved system preference cannot read matchMedia", () => {
    const root = { dataset: {} as Record<string, string>, style: { colorScheme: "", setProperty: vi.fn(), removeProperty: vi.fn() } };
    runInNewContext(COLOR_THEME_BOOTSTRAP_SCRIPT, {
      localStorage: { getItem: (key: string) => key === COLOR_THEME_STORAGE_KEY ? "system" : "invalid" },
      document: { documentElement: root, cookie: "", querySelectorAll: () => [] },
      window: { matchMedia: () => { throw new Error("Blocked"); } },
    });
    expect(root.dataset).toMatchObject({ theme: "light", themePreference: "system", accent: "neutral" });
  });
});

describe("applying appearance preferences", () => {
  let stored: Map<string, string>;
  let styles: Map<string, string>;
  let root: { dataset: Record<string, string>; style: { colorScheme: string; setProperty: (key: string, value: string) => unknown; removeProperty: (key: string) => unknown } };
  let browserDocument: { documentElement: typeof root; cookie: string; querySelectorAll: () => unknown[] };
  const notify = vi.fn();

  beforeEach(() => {
    stored = new Map();
    styles = new Map();
    notify.mockClear();
    root = { dataset: {}, style: { colorScheme: "", setProperty: (key, value) => styles.set(key, value), removeProperty: (key) => styles.delete(key) } };
    browserDocument = { documentElement: root, cookie: "", querySelectorAll: () => [] };
    const browserWindow = Object.assign(new EventTarget(), {
      localStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) },
      matchMedia: vi.fn().mockReturnValue({ matches: true }),
      setTimeout: vi.fn(),
      location: { hostname: "app.closespan.com" },
    });
    browserWindow.addEventListener(THEME_CHANGE_EVENT, notify);
    vi.stubGlobal("document", browserDocument);
    vi.stubGlobal("window", browserWindow);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("persists system as a preference and the quick toggle replaces it with an explicit choice", () => {
    applyColorThemePreference("system", { persist: true });
    expect(stored.get(COLOR_THEME_STORAGE_KEY)).toBe("system");
    expect(root.dataset).toMatchObject({ theme: "dark", themePreference: "system" });
    expect(browserDocument.cookie).toContain(`${COLOR_THEME_STORAGE_KEY}=system;`);
    applyColorTheme("light", { persist: true });
    expect(root.dataset).toMatchObject({ theme: "light", themePreference: "light" });
    expect(stored.get(COLOR_THEME_STORAGE_KEY)).toBe("light");
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("updates accent tokens for the effective theme and restores neutral without changing status colors", () => {
    styles.set("--success", "incumbent-success");
    applyAccentColor("blue", { persist: true });
    expect(stored.get(ACCENT_COLOR_STORAGE_KEY)).toBe("blue");
    expect(styles.get("--accent-fill")).toBe(ACCENT_THEME_TOKENS.light.blue["--accent-fill"]);
    applyColorThemePreference("dark");
    expect(styles.get("--accent-fill")).toBe(ACCENT_THEME_TOKENS.dark.blue["--accent-fill"]);
    expect(stored.get(ACCENT_COLOR_STORAGE_KEY)).toBe("blue");
    applyAccentColor("neutral", { persist: true });
    expect(root.dataset.accent).toBe("neutral");
    for (const key of ACCENT_TOKEN_NAMES) expect(styles.has(key)).toBe(false);
    expect(styles.get("--success")).toBe("incumbent-success");
  });

  it("retains applied choices when storage and cookies cannot be written", () => {
    window.localStorage.setItem = () => { throw new Error("Blocked storage"); };
    Object.defineProperty(browserDocument, "cookie", { get: () => "", set: () => { throw new Error("Blocked cookies"); } });
    expect(() => applyColorThemePreference("system", { persist: true })).not.toThrow();
    expect(() => applyAccentColor("pink", { persist: true })).not.toThrow();
    expect(resolveColorThemePreference()).toBe("system");
    expect(resolveColorTheme()).toBe("dark");
    expect(resolveAccentColor()).toBe("pink");
  });

  it("keeps fallback cookies consistent when another tab removes an appearance preference", () => {
    applyColorThemePreference("dark", { persist: true });
    stored.delete(COLOR_THEME_STORAGE_KEY);
    syncAppearanceFromStorage({ key: COLOR_THEME_STORAGE_KEY, newValue: null } as StorageEvent);
    expect(root.dataset.theme).toBe("light");
    expect(readStoredThemePreference()).toBe("light");
    expect(stored.has(COLOR_THEME_STORAGE_KEY)).toBe(false);

    applyAccentColor("pink", { persist: true });
    stored.delete(ACCENT_COLOR_STORAGE_KEY);
    syncAppearanceFromStorage({ key: ACCENT_COLOR_STORAGE_KEY, newValue: null } as StorageEvent);
    expect(root.dataset.accent).toBe("neutral");
    expect(readStoredAccentColor()).toBe("neutral");
    expect(stored.has(ACCENT_COLOR_STORAGE_KEY)).toBe(false);
  });

  it("ignores a sessionStorage event even when it uses an appearance key", () => {
    syncAppearanceFromStorage({ key: COLOR_THEME_STORAGE_KEY, newValue: "dark", storageArea: {} } as StorageEvent);
    expect(root.dataset.theme).toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });

  it.each([
    ["closespan.com", true], ["app.closespan.com", true], ["nested.app.closespan.com", true],
    ["notclosespan.com", false], ["closespan.com.example.net", false], ["localhost", false],
  ])("uses the shared cookie domain only at the proper boundary: %s", (hostname, shared) => {
    Object.defineProperty(window.location, "hostname", { value: hostname });
    applyColorThemePreference("dark", { persist: true });
    expect(browserDocument.cookie.includes("domain=.closespan.com")).toBe(shared);
    applyAccentColor("green", { persist: true });
    expect(browserDocument.cookie.includes("domain=.closespan.com")).toBe(shared);
  });
});
