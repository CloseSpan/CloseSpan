import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Building2, Clock3, FileCheck2, FileCode2, Settings2, Trash2 } from "lucide-react";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/icon-colors.css", import.meta.url), "utf8");
const productCss = readFileSync(new URL("../app/product-theme.css", import.meta.url), "utf8");

function tokens(selector: string) {
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...block.matchAll(/(--icon-[\w-]+):\s*(#[\da-f]{6});/gi)].map(([, key, value]) => [key, value]));
}

function contrast(a: string, b: string) {
  function luminance(hex: string) {
    return [1, 3, 5].map((offset) => {
      const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  }
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe("site-wide icon colors", () => {
  it.each([
    ["Settings2", Settings2, "teal"],
    ["Building2", Building2, "teal"],
    ["FileCheck2", FileCheck2, "green"],
    ["FileCode2", FileCode2, "violet"],
    ["Clock3", Clock3, "amber"],
    ["Trash2", Trash2, "red"],
  ] as const)("maps the actual %s library class to its color", (_, Icon, role) => {
    const markup = renderToStaticMarkup(createElement(Icon));
    const className = markup.match(/class="lucide (lucide-[^"]+)"/)?.[1];
    expect(className).toBeDefined();
    const group = [...css.matchAll(/svg\.lucide:is\(([^)]+)\)\s*\{([^}]+)\}/g)]
      .find((match) => match[1].split(",").map((name) => name.trim()).includes(`.${className}`));
    expect(group?.[2]).toContain(`--icon-kind: var(--icon-${role})`);
  });

  it.each([
    [":root", ["#ffffff", "#f0f0f2", "#e7e7e9"]],
    [':root[data-theme="dark"]', ["#17181a", "#202124", "#2c2e32"]],
  ] as const)("keeps all icon roles visible on %s surfaces", (selector, surfaces) => {
    const palette = tokens(selector);
    for (const role of ["blue", "violet", "teal", "green", "amber", "red"]) {
      expect(palette[`--icon-${role}`]).toBeDefined();
      for (const surface of surfaces) expect(contrast(palette[`--icon-${role}`], surface)).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives neutral solid actions a contrasting colored icon in both themes", () => {
    expect(contrast(tokens(":root")["--icon-on-solid"], "#242529")).toBeGreaterThanOrEqual(3);
    expect(contrast(tokens(':root[data-theme="dark"]')["--icon-on-solid"], "#f0f0f1")).toBeGreaterThanOrEqual(3);
  });

  it("covers all Lucide icons without recoloring brand paths or text", () => {
    expect(productCss).toContain('@import "./icon-colors.css";');
    expect(css).toContain(":root[data-theme] svg.lucide {");
    expect(css).toContain("var(--icon-context-color, var(--icon-kind, var(--icon-blue)))");
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(rules).not.toMatch(/\b(?:fill|stroke):/);
    expect(rules).not.toMatch(/filter:/);
  });

  it("retains semantic, disabled and high-contrast overrides", () => {
    expect(css).toContain('.callout.error, .toast.error, .btn.danger');
    expect(css).toContain('button:disabled, [aria-disabled="true"]');
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).toContain('color: inherit !important;');
    expect(css).toContain('[data-accent]:not([data-accent="neutral"])');
  });
});
