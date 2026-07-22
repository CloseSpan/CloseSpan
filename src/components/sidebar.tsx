"use client";

import {
  Activity,
  BadgeCheck,
  Blocks,
  CircleGauge,
  GitPullRequest,
  Inbox,
  ListChecks,
  Lightbulb,
  Network,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClosespanLogo } from "./closespan-logo";
import {
  OrganizationSwitcher,
  type OrganizationSwitcherItem,
} from "./organization-switcher";

export const navigationItems = [
  [CircleGauge, "Overview", "/overview"],
  [Inbox, "Feedback inbox", "/feedback"],
  [Network, "Product problems", "/problems"],
  [ListChecks, "Prioritization", "/prioritization"],
  [Activity, "Investigations", "/investigations"],
  [BadgeCheck, "Approvals", "/approvals"],
  [GitPullRequest, "Follow-up", "/follow-up"],
  [Lightbulb, "Requests", "/requests"],
  [Blocks, "Integrations", "/integrations"],
  [Users, "Customers", "/customers"],
  [Settings, "Settings", "/settings"],
] as const;

function NavigationLinks() {
  const pathname = usePathname();
  return navigationItems.map(([Icon, label, href]) => {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        href={href}
        className={active ? "active" : ""}
        aria-current={active ? "page" : undefined}
        aria-label={label}
        title={label}
        key={label}
      >
        <Icon aria-hidden="true" />
        <span>{label}</span>
      </Link>
    );
  });
}

export function Sidebar({
  organizations,
  activeOrganizationId,
  demoMode,
}: {
  organizations: OrganizationSwitcherItem[];
  activeOrganizationId: string;
  demoMode: boolean;
}) {
  return (
    <aside className="sidebar">
      <Link className="brand" href="/overview" aria-label="Closespan overview">
        <ClosespanLogo size="md" />
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
        />
      </div>
    </aside>
  );
}

export function MobileNavigation({
  organizations,
  activeOrganizationId,
}: {
  organizations: OrganizationSwitcherItem[];
  activeOrganizationId: string;
}) {
  return (
    <details className="mobile-menu">
      <summary>Menu</summary>
      <div className="mobile-menu-panel">
        <nav aria-label="Mobile navigation">
          <NavigationLinks />
        </nav>
        <OrganizationSwitcher
          organizations={organizations}
          activeOrganizationId={activeOrganizationId}
          variant="mobile"
        />
      </div>
    </details>
  );
}
