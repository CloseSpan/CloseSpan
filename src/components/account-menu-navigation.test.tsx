import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountMenuNavigation } from "./account-menu-navigation";

const navigation = vi.hoisted(() => ({ pathname: "/admin/requests" }));

vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

beforeEach(() => {
  navigation.pathname = "/admin/requests";
});

describe("Account appearance navigation", () => {
  it.each([
    ["/settings", "Settings"],
    ["/settings/appearance", "Appearance"],
  ])("marks only the matching account destination active on %s", (pathname, label) => {
    navigation.pathname = pathname;
    const markup = renderToStaticMarkup(<AccountMenuNavigation showPlatformAdmin={false} />);
    const activeLinks = markup.match(/<a\b[^>]*aria-current="page"[^>]*>.*?<\/a>/g);

    expect(markup).toContain('href="/settings/appearance"');
    expect(markup).toContain('href="/settings"');
    expect(activeLinks).toHaveLength(1);
    expect(activeLinks![0]).toContain(`<span>${label}</span>`);
  });
});

describe("Account menu moderation navigation", () => {
  it("shows the moderation route for moderators without granting platform administration", () => {
    const markup = renderToStaticMarkup(
      <AccountMenuNavigation showPlatformAdmin={false} showFeatureRequestModeration />,
    );
    expect(markup).toContain('href="/admin/requests"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).not.toContain('href="/admin/users"');
  });

  it("does not infer moderation permission from platform administration", () => {
    const markup = renderToStaticMarkup(
      <AccountMenuNavigation showPlatformAdmin />,
    );
    expect(markup).toContain('href="/admin/users"');
    expect(markup).not.toContain('href="/admin/requests"');
  });
});
