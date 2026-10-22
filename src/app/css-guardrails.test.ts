import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Ratchets for the global stylesheets: each count may only go down. When a
 * change lowers one, lower its budget here so it cannot creep back.
 * New styling should use theme.css tokens (colours, --text-*, --weight-*,
 * --radius-*) and rely on selector order rather than !important.
 */
const BUDGET = {
  important: 223,
  hexOutsideTokens: 428,
  rawFontSize: 121,
  rawWeight: 102,
  rawRadius: 137,
};

const files = ["globals.css", "theme.css", "product-theme.css"];
const css = files
  .map((file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""))
  .join("\n");
const declarations = css.split(/[;{}]/).map((part) => part.trim()).filter(Boolean);
const countDeclarations = (pattern: RegExp) => declarations.filter((declaration) => pattern.test(declaration)).length;

describe("global CSS guardrails", () => {
  it.each([
    ["important", (css.match(/!important/g) ?? []).length],
    ["hexOutsideTokens", declarations.filter((declaration) => !declaration.startsWith("--") && /#[0-9a-fA-F]{3,8}\b/.test(declaration)).length],
    ["rawFontSize", countDeclarations(/^font-size:\s*[\d.]+(px|rem)/)],
    ["rawWeight", countDeclarations(/^font-weight:\s*\d/)],
    ["rawRadius", countDeclarations(/^border-radius:\s*[\d.]+px/)],
  ] as const)("does not add %s beyond its budget", (name, count) => {
    expect(count).toBeLessThanOrEqual(BUDGET[name]);
  });
});
