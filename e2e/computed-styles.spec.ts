import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "@playwright/test";
import { openScreen, prepare, PUBLIC_SCREENS, THEMES, WORKSPACE_SCREENS } from "./screens";

/**
 * CSS refactoring safety net. With STYLE_SNAPSHOT_DIR set, records the final
 * computed style of every element (and its ::before/::after) on each screen.
 * Compare two runs with `node scripts/compare-computed-styles.mjs <before> <after>`.
 */
const outputDir = process.env.STYLE_SNAPSHOT_DIR;
test.skip(!outputDir, "Set STYLE_SNAPSHOT_DIR to record computed styles.");

for (const theme of THEMES) {
  for (const [screens, signedIn] of [[WORKSPACE_SCREENS, true], [PUBLIC_SCREENS, false]] as const) {
    for (const screen of screens) {
      test(`${screen.name} · ${theme}`, async ({ page }, testInfo) => {
        await prepare(page, testInfo, theme, signedIn);
        await openScreen(page, screen, signedIn);
        const styles = await page.evaluate(() => {
          const key = (element: Element): string => {
            const parts: string[] = [];
            for (let node: Element | null = element; node && node !== document.documentElement; node = node.parentElement) {
              const index = node.parentElement ? Array.prototype.indexOf.call(node.parentElement.children, node) : 0;
              parts.unshift(`${node.tagName.toLowerCase()}:${index}`);
            }
            return parts.join(">");
          };
          const serialize = (style: CSSStyleDeclaration) =>
            Array.from(style).sort().map((property) => `${property}:${style.getPropertyValue(property)}`).join(";");
          const result: Record<string, string> = {};
          for (const element of [document.documentElement, ...document.querySelectorAll("body, body *")]) {
            if (element.closest("nextjs-portal")) continue;
            const id = key(element);
            result[id] = serialize(getComputedStyle(element));
            for (const pseudo of ["::before", "::after"]) {
              const style = getComputedStyle(element, pseudo);
              if (style.content && style.content !== "none") result[`${id}${pseudo}`] = serialize(style);
            }
          }
          return result;
        });
        mkdirSync(outputDir!, { recursive: true });
        writeFileSync(join(outputDir!, `${screen.name}-${theme}.json`), JSON.stringify(styles));
      });
    }
  }
}
