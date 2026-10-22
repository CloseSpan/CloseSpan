import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

// Visual baselines run against the seeded in-memory demo workspace only. Every
// persistence setting is passed explicitly so a local .env pointing at a real
// database is never used, and the session secret below exists only here.
export const VISUAL_PORT = 3100;
export const VISUAL_AUTH_SECRET = "closespan-visual-baseline-local-only-secret";
const baseURL = `http://localhost:${VISUAL_PORT}`;
// Seeded data is dated relative to now; pin both server and browser clocks.
// The instant is in the future: the browser expires cookies on the real clock,
// so a refreshed session stamped in the past would be dropped immediately.
export const VISUAL_FIXED_NOW = "2030-01-07T12:00:00.000Z";

export default defineConfig({
  testDir: "e2e",
  snapshotPathTemplate: "e2e/__screenshots__/{arg}{ext}",
  workers: 1,
  timeout: 90_000,
  reporter: [["list"]],
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: "disabled", caret: "hide", scale: "css" },
  },
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
  },
  webServer: {
    command: `npx next dev -p ${VISUAL_PORT}`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      PERSISTENCE_MODE: "memory",
      APP_MODE: "demo",
      DATABASE_URL: "",
      AUTH_SECRET: VISUAL_AUTH_SECRET,
      AUTH_URL: baseURL,
      AUTH_TRUST_HOST: "true",
      CLOSESPAN_UI_RESET: "false",
      CLOSESPAN_APP_DOMAIN_ENABLED: "false",
      NEXT_TELEMETRY_DISABLED: "1",
      TZ: "UTC",
      VISUAL_FIXED_NOW,
      NODE_OPTIONS: `--require ${JSON.stringify(resolve("e2e/fixed-clock.cjs"))}`,
    },
  },
});
