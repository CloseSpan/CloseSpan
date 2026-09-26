import { renderToStaticMarkup } from "react-dom/server";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_SECTIONS, SettingsNavigation } from "./settings-navigation";

const navigation = vi.hoisted(() => ({ pathname: "/settings" }));

vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
vi.mock("next/link", () => ({
  default: ({ prefetch, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => {
    void prefetch;
    return <a {...props} data-client-navigation="true" />;
  },
}));

describe("Settings navigation", () => {
  beforeEach(() => {
    navigation.pathname = "/settings";
  });

  it("keeps workspace section links on the current settings page", () => {
    const markup = renderToStaticMarkup(<SettingsNavigation />);

    for (const [id] of SETTINGS_SECTIONS.filter(([id]) => ["agent", "data", "members", "usage"].includes(id))) {
      expect(markup).toContain(`href="#${id}"`);
      const anchor = markup.match(new RegExp(`<a\\b[^>]*href="#${id}"[^>]*>`))?.[0];
      // Native fragment navigation updates CSS :target and emits hashchange.
      expect(anchor).not.toContain("data-client-navigation");
    }
    expect(markup).toContain('href="/settings/appearance"');
    expect(markup).toMatch(/<a\b(?=[^>]*aria-current="location")(?=[^>]*href="#agent")/);
    expect(markup).not.toContain('aria-current="page"');
    expect(markup).toContain('href="/settings/technical"');
    expect(markup).not.toContain("Prompt drafting");
    expect(markup).not.toContain("Execution environments");
    expect(markup.indexOf(">Personal</span>")).toBeLessThan(markup.indexOf(">Workspace</span>"));
  });

  it.each([false, true])("links back to workspace sections from Appearance (mobile: %s)", (mobile) => {
    navigation.pathname = "/settings/appearance";
    const markup = renderToStaticMarkup(<SettingsNavigation mobile={mobile} />);

    for (const [id] of SETTINGS_SECTIONS.filter(([id]) => ["agent", "data", "members", "usage"].includes(id))) {
      expect(markup).toContain(`href="/settings#${id}"`);
      expect(markup).not.toContain(`href="#${id}"`);
    }
    expect(markup).toContain('aria-current="page" aria-label="Appearance"');
    expect(markup.match(/aria-current=/g)).toHaveLength(1);
    expect(markup).not.toContain('aria-current="location"');
    expect(markup).toContain('href="/problems"');
  });
});
