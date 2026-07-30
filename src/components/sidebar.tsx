"use client";

import {
  Activity,
  BadgeCheck,
  Blocks,
  CircleGauge,
  GitPullRequest,
  Inbox,
  ListChecks,
  Network,
  Settings,
  Users,
} from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  WORKSPACE_NAVIGATION,
  type WorkspaceNavigationId,
} from "@/lib/workspace-navigation";
import { CloseSpanLogo } from "./closespan-logo";
import {
  OrganizationSwitcher,
  type OrganizationSwitcherItem,
} from "./organization-switcher";

const navigationIcons: Record<WorkspaceNavigationId, typeof CircleGauge> = {
  overview: CircleGauge,
  feedback: Inbox,
  problems: Network,
  prioritization: ListChecks,
  investigations: Activity,
  approvals: BadgeCheck,
  "follow-up": GitPullRequest,
  integrations: Blocks,
  customers: Users,
  settings: Settings,
};

function NavigationPendingIndicator() {
  const { pending } = useLinkStatus();
  return pending ? (
    <i className="nav-link-pending" aria-hidden="true" />
  ) : null;
}

function NavigationLinks() {
  const pathname = usePathname();
  return WORKSPACE_NAVIGATION.map(({ id, label, href }) => {
    const Icon = navigationIcons[id];
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        href={href}
        className={active ? "active" : ""}
        aria-current={active ? "page" : undefined}
        aria-label={label}
        data-nav-label={label}
        key={label}
      >
        <Icon aria-hidden="true" />
        <span>{label}</span>
        <NavigationPendingIndicator />
      </Link>
    );
  });
}

export function Sidebar({
  organizations,
  activeOrganizationId,
  demoMode,
  canRenameWorkspace,
}: {
  organizations: OrganizationSwitcherItem[];
  activeOrganizationId: string;
  demoMode: boolean;
  canRenameWorkspace: boolean;
}) {
  return (
    <aside className="sidebar">
      <Link className="brand" href="/overview" aria-label="CloseSpan overview">
        <CloseSpanLogo size="md" />
      </Link>
      <nav className="nav" aria-label="Primary navigation">
        <NavigationLinks />
      </nav>
      <div className="sidebar-footer">
        {demoMode && (
          <div className="demo-label">
            <strong>SIMULATED WORKSPACE</strong>
            Seeded data · no external systems connected
          </div>
        )}
        <OrganizationSwitcher
          organizations={organizations}
          activeOrganizationId={activeOrganizationId}
          canRenameWorkspace={canRenameWorkspace}
        />
      </div>
    </aside>
  );
}

export function MobileNavigation({
  organizations,
  activeOrganizationId,
  canRenameWorkspace,
}: {
  organizations: OrganizationSwitcherItem[];
  activeOrganizationId: string;
  canRenameWorkspace: boolean;
}) {
  const pathname = usePathname();
  const menuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const moveFocusToContent = menu.contains(document.activeElement);
    menu.open = false;

    if (moveFocusToContent) {
      window.requestAnimationFrame(() => {
        document.getElementById("main-content")?.focus();
      });
    }
  }, [pathname]);

  return (
    <details className="mobile-menu" ref={menuRef}>
      <summary>Menu</summary>
      <div className="mobile-menu-panel">
        <nav aria-label="Mobile navigation">
          <NavigationLinks />
        </nav>
        <OrganizationSwitcher
          organizations={organizations}
          activeOrganizationId={activeOrganizationId}
          canRenameWorkspace={canRenameWorkspace}
          variant="mobile"
        />
      </div>
    </details>
  );
}
