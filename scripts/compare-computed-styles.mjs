#!/usr/bin/env node
// Compare two computed-style snapshot directories from e2e/computed-styles.spec.ts.
// Exits non-zero and lists the first differences when any screen changed.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
// --ignore=--new-token,other-property skips properties a change adds on purpose.
const ignored = new Set(args.filter((arg) => arg.startsWith("--ignore=")).flatMap((arg) => arg.slice(9).split(",")));
const [before, after] = args.filter((arg) => !arg.startsWith("--ignore="));
if (!before || !after) {
  console.error("Usage: node scripts/compare-computed-styles.mjs <before-dir> <after-dir> [--ignore=prop,...]");
  process.exit(2);
}
const parse = (style) => Object.fromEntries(style.split(";").map((pair) => {
  const index = pair.indexOf(":");
  return [pair.slice(0, index), pair.slice(index + 1)];
}));
let changedScreens = 0;
for (const file of readdirSync(before).filter((name) => name.endsWith(".json")).sort()) {
  let next;
  try { next = JSON.parse(readFileSync(join(after, file), "utf8")); } catch { console.log(`${file}: missing in ${after}`); changedScreens++; continue; }
  const previous = JSON.parse(readFileSync(join(before, file), "utf8"));
  const differences = [];
  for (const element of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (previous[element] === next[element]) continue;
    if (!previous[element] || !next[element]) { differences.push(`${element}: ${previous[element] ? "removed" : "added"}`); continue; }
    const a = parse(previous[element]);
    const b = parse(next[element]);
    for (const property of new Set([...Object.keys(a), ...Object.keys(b)]))
      if (!ignored.has(property) && a[property] !== b[property]) differences.push(`${element} ${property}: ${a[property]} -> ${b[property]}`);
  }
  if (differences.length) {
    changedScreens++;
    console.log(`${file}: ${differences.length} difference(s)`);
    for (const line of differences.slice(0, 8)) console.log(`  ${line}`);
  }
}
console.log(changedScreens ? `${changedScreens} screen(s) changed` : "All computed styles identical");
process.exit(changedScreens ? 1 : 0);
