import { expect, test } from "@playwright/test";
import { openScreen, prepare, PUBLIC_SCREENS, THEMES, WORKSPACE_SCREENS } from "./screens";

// Desktop baselines for workspace and public screens. Run `npm run test:visual`
// to compare, or with `-- --update-snapshots` after an intended visual change.
for (const theme of THEMES) {
  for (const [group, screens, signedIn] of [["workspace", WORKSPACE_SCREENS, true], ["public", PUBLIC_SCREENS, false]] as const) {
    test.describe(`${theme} theme · ${group}`, () => {
      test.beforeEach(async ({ page }, testInfo) => prepare(page, testInfo, theme, signedIn));
      for (const screen of screens) {
        test(screen.name, async ({ page }) => {
          await openScreen(page, screen, signedIn);
          await expect(page).toHaveScreenshot(`${screen.name}-${theme}.png`, {
            fullPage: true,
            // Dates move daily and video buffering varies; neither is layout.
            mask: [page.locator("time"), page.locator("video")],
          });
        });
      }
    });
  }
}
