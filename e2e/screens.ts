import { expect, type Page, type TestInfo } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { COLOR_THEME_STORAGE_KEY } from "../src/lib/color-theme";
import { VISUAL_AUTH_SECRET, VISUAL_FIXED_NOW } from "../playwright.config";

/** Signed-in workspace screens, captured from the seeded demo workspace. */
export const WORKSPACE_SCREENS = [
  { name: "customers", path: "/customers" },
  { name: "feedback", path: "/feedback" },
  { name: "issues-list", path: "/problems" },
  { name: "issues-board", path: "/problems?view=board" },
  { name: "issue-detail", path: "issue:0" },
  { name: "issue-detail-secondary", path: "issue:1" },
  { name: "prompt-testing", path: "/pdd" },
  { name: "prompt-testing-issue", path: "/pdd/prob_export" },
  { name: "needs-you", path: "/approvals" },
  { name: "agent-activity", path: "/agent-runs" },
  { name: "integrations", path: "/integrations" },
  { name: "notifications", path: "/notifications" },
  { name: "settings", path: "/settings" },
  { name: "settings-appearance", path: "/settings/appearance" },
  { name: "settings-connections", path: "/settings/connections" },
  { name: "settings-technical", path: "/settings/technical" },
] as const;

/** Signed-out pages that share the global stylesheets. */
export const PUBLIC_SCREENS = [
  { name: "public-landing", path: "/" },
  { name: "public-login", path: "/login" },
  { name: "public-connectors", path: "/connectors" },
  { name: "public-security", path: "/security" },
] as const;

export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];
export type Screen = { name: string; path: string };

async function signIn(page: Page, testInfo: TestInfo) {
  const salt = "authjs.session-token";
  const value = await encode({
    token: { email: "visual-baseline@example.com", name: "Visual Baseline", sub: "visual-baseline" },
    secret: VISUAL_AUTH_SECRET,
    salt,
    // Expiry is stamped from this process's real clock but checked against
    // the server's pinned clock, so cover the gap plus an hour.
    maxAge: Math.ceil((Date.parse(VISUAL_FIXED_NOW) - Date.now()) / 1000) + 60 * 60,
  });
  await page.context().addCookies([{ name: salt, value, url: testInfo.project.use.baseURL! }]);
}

async function issuePath(page: Page, index: number): Promise<string> {
  await page.goto("/problems");
  const hrefs = await page.locator('a[href^="/problems/prob"]').evaluateAll((links) =>
    // One issue can have several links (anchors, query strings); compare paths.
    [...new Set(links.map((link) => link.getAttribute("href")?.split(/[?#]/)[0]).filter(Boolean))]);
  const href = hrefs[index];
  if (!href) throw new Error(`The demo workspace has no issue #${index + 1} to capture.`);
  return href as string;
}

/**
 * The workspace shell scrolls inside its main panel, so a full-page capture
 * only shows the first screen. Grow the viewport by the deepest inner overflow
 * so the whole panel renders without changing its layout rules.
 */
async function fitViewportToContent(page: Page) {
  const overflow = await page.evaluate(() => {
    let deepest = 0;
    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      const { overflowY } = getComputedStyle(element);
      if (overflowY === "auto" || overflowY === "scroll") deepest = Math.max(deepest, element.scrollHeight - element.clientHeight);
    }
    return deepest;
  });
  if (overflow > 0) {
    await page.setViewportSize({ width: 1440, height: Math.min(900 + overflow, 8_000) });
    await page.waitForTimeout(250);
  }
}

const hydrationErrors = new WeakMap<Page, string[]>();

/** Configure the clock, theme and session before navigating. */
export async function prepare(page: Page, testInfo: TestInfo, theme: Theme, signedIn: boolean) {
  const errors: string[] = [];
  hydrationErrors.set(page, errors);
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text())) errors.push(message.text().slice(0, 300));
  });
  await page.clock.setSystemTime(new Date(VISUAL_FIXED_NOW));
  await page.addInitScript(([key, value]) => {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
    // Keep the presentation walkthrough closed; it would cover every screen.
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (name: string) {
      return name.startsWith("closespan-demo-guide:") && name.endsWith(":seen") ? "true" : getItem.call(this, name);
    };
  }, [COLOR_THEME_STORAGE_KEY, theme] as const);
  if (signedIn) await signIn(page, testInfo);
}

/** Open a screen and wait until it is stable enough to capture. */
export async function openScreen(page: Page, screen: Screen, signedIn: boolean) {
  const path = screen.path.startsWith("issue:") ? await issuePath(page, Number(screen.path.slice(6))) : screen.path;
  const response = await page.goto(path);
  expect(response?.ok(), `${path} responded ${response?.status()}`).toBe(true);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  // Skeletons are replaced by streamed content; wait until none remain.
  await expect(page.locator('[aria-busy="true"], .skeleton')).toHaveCount(0, { timeout: 15_000 }).catch(() => undefined);
  // Next's development error indicator is tooling, not product UI.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await fitViewportToContent(page);
  // Guard: workspace baselines must come from the seeded demo, never a real workspace.
  if (signedIn) await expect(page.locator("body")).toContainText("Demo");
  // Route error boundaries still respond 200; a baseline of one is useless.
  await expect(page.getByRole("heading", { name: "This page could not load" })).toHaveCount(0);
  // Server and browser must render the same markup.
  expect(hydrationErrors.get(page) ?? [], "hydration errors").toEqual([]);
}
