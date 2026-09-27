"use client";

import {
  Bot,
  CircleCheck,
  CircleDot,
  createLucideIcon,
  FlaskConical,
  Grid2X2Plus,
  Inbox,
  LayoutGrid,
  Settings,
  Users,
} from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
} from "react";
import {
  WORKSPACE_NAVIGATION,
  WORKSPACE_NAVIGATION_GROUPS,
  type WorkspaceNavigationId,
} from "@/lib/workspace-navigation";
import {
  PENDING_APPROVAL_COUNT_EVENT,
  type PendingApprovalCountChange,
} from "@/lib/pending-approval-count-client";
import { CloseSpan3DLogo } from "./closespan-3d-logo";
import {
  OrganizationSwitcher,
  type OrganizationSwitcherItem,
} from "./organization-switcher";
import { SettingsNavigation } from "./settings-navigation";
import { NavigationIcon } from "./navigation-icon";

// The reference uses one rounded connection, not a branching pull-request glyph.
const FollowUpIcon = createLucideIcon("FollowUp", [
  ["circle", { cx: "6", cy: "5", r: "3", key: "start" }],
  ["path", { d: "M6 8v7a4 4 0 0 0 4 4h5", key: "connection" }],
  ["circle", { cx: "18", cy: "19", r: "3", key: "end" }],
]);

const navigationIcons: Record<WorkspaceNavigationId, typeof CircleDot> = {
  overview: LayoutGrid,
  customers: Users,
  feedback: Inbox,
  problems: CircleDot,
  pdd: FlaskConical,
  approvals: CircleCheck,
  "agent-runs": Bot,
  "follow-up": FollowUpIcon,
  integrations: Grid2X2Plus,
  settings: Settings,
};

function NavigationPendingIndicator() {
  const { pending } = useLinkStatus();
  return pending ? (
    <i className="nav-link-pending" aria-hidden="true" />
  ) : null;
}

function NavigationLinks({ pendingApprovalCount = 0 }: { pendingApprovalCount?: number }) {
  const pathname = usePathname();
  const [visiblePendingApprovalCount, setVisiblePendingApprovalCount] = useState(pendingApprovalCount);

  useEffect(() => {
    const handleCountChange = (event: Event) => {
      const delta = (event as CustomEvent<PendingApprovalCountChange>).detail?.delta;
      if (!Number.isFinite(delta)) return;
      setVisiblePendingApprovalCount((current) => Math.max(0, current + delta));
    };
    window.addEventListener(PENDING_APPROVAL_COUNT_EVENT, handleCountChange);
    return () => window.removeEventListener(PENDING_APPROVAL_COUNT_EVENT, handleCountChange);
  }, []);

  return (
    <>
      {WORKSPACE_NAVIGATION_GROUPS.map((group) => {
        const items = WORKSPACE_NAVIGATION.filter((item) => item.group === group.id);
        const hasActiveRoute = items.some(
          ({ href }) => pathname === href || pathname.startsWith(`${href}/`),
        );
        return (
          <div
            className={`nav-group nav-group-${group.id}${hasActiveRoute ? " has-active-route" : ""}`}
            role="group"
            aria-label={group.label ?? "Workspace"}
            data-state="expanded"
            key={group.id}
          >
            {group.label && <span className="nav-section-label" aria-hidden="true">{group.label}</span>}
            <div className="nav-group-items">
              {items.map(({ id, label, href }) => {
                const Icon = navigationIcons[id];
                const active = pathname === href || pathname.startsWith(`${href}/`);
                const pendingCount = id === "approvals" ? visiblePendingApprovalCount : 0;
                return (
                  <Link
                    href={href}
                    prefetch={false}
                    className={active ? "active" : ""}
                    aria-current={active ? "page" : undefined}
                    aria-label={pendingCount > 0 ? `${label}, ${pendingCount} pending` : label}
                    data-nav-label={label}
                    key={label}
                  >
                    <NavigationIcon icon={Icon} active={active} />
                    <span>{label}</span>
                    <span className="nav-link-meta" aria-hidden="true">
                      {pendingCount > 0 && <span className="nav-pending-approval-count">{pendingCount > 99 ? "99+" : pendingCount}</span>}
                      <NavigationPendingIndicator />
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

export function Sidebar({
  organizations,
  activeOrganizationId,
  demoMode,
  canRenameWorkspace,
  pendingApprovalCount,
}: {
  organizations: OrganizationSwitcherItem[];
  activeOrganizationId: string;
  demoMode: boolean;
  canRenameWorkspace: boolean;
  pendingApprovalCount: number;
}) {
  const pathname = usePathname();
  const settingsRoute =
    pathname === "/settings" || pathname.startsWith("/settings/");

  return (
    <aside className="sidebar">
      <Link
        className="brand"
        href="/overview"
        prefetch={false}
        aria-label="CloseSpan overview"
      >
        <CloseSpan3DLogo size="sm" />
      </Link>
      {settingsRoute ? (
        <SettingsNavigation />
      ) : (
        <nav className="nav" aria-label="Primary navigation">
          <NavigationLinks
            key={pendingApprovalCount}
            pendingApprovalCount={pendingApprovalCount}
          />
        </nav>
      )}
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
  pendingApprovalCount,
}: {
  organizations: OrganizationSwitcherItem[];
  activeOrganizationId: string;
  canRenameWorkspace: boolean;
  pendingApprovalCount: number;
}) {
  const pathname = usePathname();
  const settingsRoute =
    pathname === "/settings" || pathname.startsWith("/settings/");
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
        {settingsRoute ? (
          <SettingsNavigation mobile />
        ) : (
          <nav aria-label="Mobile navigation">
            <NavigationLinks
              key={pendingApprovalCount}
              pendingApprovalCount={pendingApprovalCount}
            />
          </nav>
        )}
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
