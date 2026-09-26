import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WORKSPACE_NAVIGATION } from "@/lib/workspace-navigation";
import { MobileNavigation, Sidebar } from "./sidebar";

vi.mock("next/navigation", () => ({ usePathname: () => "/problems" }));
vi.mock("next/link", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/link")>(),
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock("./closespan-3d-logo", () => ({ CloseSpan3DLogo: () => <span>CloseSpan</span> }));
vi.mock("./organization-switcher", () => ({ OrganizationSwitcher: () => <span>Workspace</span> }));

const props = {
  organizations: [], activeOrganizationId: "org-1", canRenameWorkspace: false,
  pendingApprovalCount: 3,
};

describe("Always-expanded workspace navigation", () => {
  it.each(["desktop", "mobile"])("shows every navigation link without a group toggle on %s", (mode) => {
    const markup = renderToStaticMarkup(mode === "desktop"
      ? <Sidebar {...props} demoMode={false} />
      : <MobileNavigation {...props} />);
    for (const item of WORKSPACE_NAVIGATION) {
      expect(markup).toContain(`href="${item.href}"`);
      expect(markup).toContain(`data-nav-label="${item.label}"`);
    }
    expect(markup).not.toContain("nav-section-toggle");
    expect(markup).not.toContain('data-collapsed="true"');
    expect(markup).not.toContain('data-open="false"');
    expect(markup).not.toContain('inert=""');
    expect(markup).toContain("Action approvals, 3 pending");
    expect(markup.match(/data-nav-label=/g)).toHaveLength(WORKSPACE_NAVIGATION.length);
    expect(markup).toContain('aria-current="page"');
  });
});
