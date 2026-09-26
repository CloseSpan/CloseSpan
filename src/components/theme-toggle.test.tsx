import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThemeToggle } from "./theme-toggle";

describe("Theme toggle", () => {
  it("links to Appearance while preserving the quick theme switch", () => {
    const markup = renderToStaticMarkup(<ThemeToggle />);

    expect(markup).toContain('href="/settings/appearance"><strong>Appearance</strong></a>');
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="false"');
    expect(markup).toContain('aria-label="Switch to dark mode"');
    expect(markup).not.toContain("Light and dark");
  });
});
