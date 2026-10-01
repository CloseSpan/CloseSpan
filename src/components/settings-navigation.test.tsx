import { renderToStaticMarkup } from "react-dom/server";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_SECTIONS, SettingsNavigation, readSettingsSection, sectionFromHash, subscribeSettingsSection } from "./settings-navigation";

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
    // A server render cannot know #members: never flash a guessed selection.
    expect(markup).not.toContain('aria-current="location"');
    expect(markup).not.toContain('aria-current="page"');
    expect(markup).toContain('href="/settings/technical"');
    expect(markup).not.toContain("Prompt drafting");
    expect(markup).not.toContain("Execution environments");
    expect(markup.indexOf(">Personal</span>")).toBeLessThan(markup.indexOf(">Workspace</span>"));
  });

  it.each([false, true])("links directly to Members from More settings (mobile: %s)", (mobile) => {
    navigation.pathname = "/settings/technical";
    const markup = renderToStaticMarkup(<SettingsNavigation mobile={mobile} />);
    expect(markup).toMatch(/<a\b(?=[^>]*href="\/settings#members")(?=[^>]*aria-label="Members &amp; roles")/);
    expect(markup.match(/aria-current=/g)).toHaveLength(1);
    expect(markup).toMatch(/<a\b(?=[^>]*href="\/settings\/technical")(?=[^>]*aria-current="page")/);
  });

  it.each([false, true])("keeps Connections selected inside settings (mobile: %s)", (mobile) => {
    navigation.pathname = "/settings/connections";
    const markup = renderToStaticMarkup(<SettingsNavigation mobile={mobile} />);
    expect(markup).toMatch(/<a\b(?=[^>]*href="\/settings\/connections")(?=[^>]*class="active")(?=[^>]*aria-current="page")/);
    expect(markup.match(/aria-current=/g)).toHaveLength(1);
    expect(markup).not.toContain('href="/integrations"');
    expect(markup).toContain('href="/settings#members"');
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

describe("settings URL selection", () => {
  let browser: EventTarget & { location: { pathname: string; hash: string } };
  beforeEach(() => {
    browser = Object.assign(new EventTarget(), { location: { pathname: "/settings", hash: "#members" } });
    vi.stubGlobal("window", browser);
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(SETTINGS_SECTIONS)("reads #%s synchronously without an Automation intermediate state", (id) => {
    browser.location.hash = `#${id}`;
    expect(readSettingsSection()).toBe(id);
  });

  it.each(["", "#unknown"])("uses Automation only for an empty or unknown fragment (%s)", (hash) => {
    expect(sectionFromHash(hash)).toBe("agent");
  });

  it("does not select an old section on other settings routes", () => {
    browser.location.pathname = "/settings/technical";
    expect(readSettingsSection()).toBeNull();
    browser.location.pathname = "/settings/appearance";
    expect(readSettingsSection()).toBeNull();
    browser.location.pathname = "/settings/";
    expect(readSettingsSection()).toBe("members");
  });

  it("tracks native hash navigation and browser history, then cleans up", () => {
    const onChange = vi.fn(() => readSettingsSection());
    const unsubscribe = subscribeSettingsSection(onChange);
    browser.location.hash = "#data";
    browser.dispatchEvent(new Event("hashchange"));
    expect(onChange).toHaveLastReturnedWith("data");
    browser.location.hash = "#members";
    browser.dispatchEvent(new Event("popstate"));
    expect(onChange).toHaveLastReturnedWith("members");
    unsubscribe();
    browser.dispatchEvent(new Event("hashchange"));
    browser.dispatchEvent(new Event("popstate"));
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
