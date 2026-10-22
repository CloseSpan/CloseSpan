import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ratchet: raw `btn` / `badge` class strings outside the UI primitives may only
 * go down. When you convert more call sites, lower the budget to the new count.
 */
const RAW_CLASS_BUDGET = 108;
const RAW_CLASS = /className=\{?\s*["'`](?:btn|badge)\b/g;
const UI_DIR = join("src", "components", "ui");

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (path !== UI_DIR) sourceFiles(path, found); }
    else if (path.endsWith(".tsx") && !path.includes(".test.")) found.push(path);
  }
  return found;
}

describe("UI primitive adoption", () => {
  it("adds no new raw btn/badge class strings; use Button, ButtonLink or StatusBadge", () => {
    const counts = sourceFiles("src")
      .map((path) => [path, readFileSync(path, "utf8").match(RAW_CLASS)?.length ?? 0] as const)
      .filter(([, count]) => count > 0);
    const total = counts.reduce((sum, [, count]) => sum + count, 0);
    expect(total, `Raw class strings by file:\n${counts.map(([path, count]) => `${count}  ${path}`).join("\n")}`)
      .toBeLessThanOrEqual(RAW_CLASS_BUDGET);
  });
});
