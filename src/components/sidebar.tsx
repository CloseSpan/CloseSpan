"use client";

import {
  BadgeCheck,
  Bot,
  CircleGauge,
  GitPullRequest,
  Inbox,
  ListChecks,
  Minus,
  Network,
  Plus,
  Users,
} from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
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

const navigationIcons: Record<WorkspaceNavigationId, typeof CircleGauge> = {
  overview: CircleGauge,
  feedback: Inbox,
  problems: Network,
  pdd: ListChecks,
  approvals: BadgeCheck,
  "agent-runs": Bot,
  "follow-up": GitPullRequest,
  customers: Users,
};

function NavigationPendingIndicator() {
  const { pending } = useLinkStatus();
  return pending ? (
    <i className="nav-link-pending" aria-hidden="true" />
  ) : null;
}

const WORKFLOW_EXPANDED_STORAGE_KEY = "closespan.sidebar.workflow-expanded.v2";
const WORKFLOW_EXPANDED_EVENT = "closespan:workflow-expanded-change";
let workflowExpandedFallback = true;

function subscribeToWorkflowPreference(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(WORKFLOW_EXPANDED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(WORKFLOW_EXPANDED_EVENT, onChange);
  };
}

function readWorkflowPreference(): boolean {
  try {
    const stored = window.localStorage.getItem(WORKFLOW_EXPANDED_STORAGE_KEY);
    return stored === null ? workflowExpandedFallback : stored !== "false";
  } catch {
    return workflowExpandedFallback;
  }
}

function storeWorkflowPreference(expanded: boolean): void {
  workflowExpandedFallback = expanded;
  try {
    window.localStorage.setItem(
      WORKFLOW_EXPANDED_STORAGE_KEY,
      String(expanded),
    );
  } catch {
    // The collapse control remains usable when persistence is unavailable.
  }
  window.dispatchEvent(new Event(WORKFLOW_EXPANDED_EVENT));
}

function NavigationLinks({
  collapsibleWorkflow = false,
  pendingApprovalCount = 0,
}: {
  collapsibleWorkflow?: boolean;
  pendingApprovalCount?: number;
}) {
  const pathname = usePathname();
  const workflowContentId = useId();
  const [visiblePendingApprovalCount, setVisiblePendingApprovalCount] = useState(
    pendingApprovalCount,
  );
  const storedWorkflowExpanded = useSyncExternalStore(
    subscribeToWorkflowPreference,
    readWorkflowPreference,
    () => true,
  );
  const workflowExpanded = collapsibleWorkflow
    ? storedWorkflowExpanded
    : true;

  useEffect(() => {
    const handleCountChange = (event: Event) => {
      const delta = (event as CustomEvent<PendingApprovalCountChange>).detail?.delta;
      if (!Number.isFinite(delta)) return;
      setVisiblePendingApprovalCount((current) => Math.max(0, current + delta));
    };
    window.addEventListener(PENDING_APPROVAL_COUNT_EVENT, handleCountChange);
    return () => window.removeEventListener(PENDING_APPROVAL_COUNT_EVENT, handleCountChange);
  }, []);

  function toggleWorkflow(): void {
    storeWorkflowPreference(!workflowExpanded);
  }

  return (
    <>
      {WORKSPACE_NAVIGATION_GROUPS.map((group) => {
        const items = WORKSPACE_NAVIGATION.filter(
          (item) => item.group === group.id,
        );
        const hasActiveRoute = items.some(
          ({ href }) => pathname === href || pathname.startsWith(`${href}/`),
        );
        const collapsible = collapsibleWorkflow && group.id === "workflow";
        const collapsed = collapsible && !workflowExpanded;
        return (
          <div
            className={`nav-group nav-group-${group.id}${hasActiveRoute ? " has-active-route" : ""}`}
            role="group"
            aria-label={group.label ?? "Workspace"}
            data-collapsed={collapsed || undefined}
            data-state={collapsed ? "collapsed" : "expanded"}
            key={group.id}
          >
            {collapsible ? (
              <button
                type="button"
                className="nav-section-toggle"
                aria-expanded={workflowExpanded}
                aria-controls={workflowContentId}
                onClick={toggleWorkflow}
              >
                <span>{group.label}</span>
                <i className="nav-active-indicator" aria-hidden="true" />
                <span className="nav-section-symbol" aria-hidden="true">
                  <Plus className="nav-section-symbol-plus" size={14} />
                  <Minus className="nav-section-symbol-minus" size={14} />
                </span>
              </button>
            ) : group.label ? (
              <span className="nav-section-label" aria-hidden="true">
                {group.label}
              </span>
            ) : null}
            {collapsible ? (
              <div
                className="nav-group-collapse"
                id={workflowContentId}
                data-open={collapsed ? "false" : "true"}
                aria-hidden={collapsed}
                inert={collapsed}
              >
                <div className="nav-group-items">
                  {items.map(({ id, label, href }, index) => {
                    const Icon = navigationIcons[id];
                    const active =
                      pathname === href || pathname.startsWith(`${href}/`);
                    const pendingCount = id === "approvals" ? visiblePendingApprovalCount : 0;
                    return (
                      <Link
                        href={href}
                        prefetch={false}
                        className={active ? "active" : ""}
                        aria-current={active ? "page" : undefined}
                        aria-label={pendingCount > 0 ? `${label}, ${pendingCount} pending` : label}
                        data-nav-label={label}
                        style={{
                          "--nav-enter-delay": `${index * 34}ms`,
                          "--nav-exit-delay": `${(items.length - index - 1) * 18}ms`,
                        } as CSSProperties}
                        key={label}
                      >
                        <Icon aria-hidden="true" />
                        <span>{label}</span>
                        <span className="nav-link-meta" aria-hidden="true">
                          {pendingCount > 0 && (
                            <span className="nav-pending-approval-count">
                              {pendingCount > 99 ? "99+" : pendingCount}
                            </span>
                          )}
                          <NavigationPendingIndicator />
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="nav-group-collapse" data-open="true">
                <div className="nav-group-items">
                  {items.map(({ id, label, href }) => {
                    const Icon = navigationIcons[id];
                    const active =
                      pathname === href || pathname.startsWith(`${href}/`);
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
                        <Icon aria-hidden="true" />
                        <span>{label}</span>
                        <span className="nav-link-meta" aria-hidden="true">
                          {pendingCount > 0 && (
                            <span className="nav-pending-approval-count">
                              {pendingCount > 99 ? "99+" : pendingCount}
                            </span>
                          )}
                          <NavigationPendingIndicator />
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
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
            collapsibleWorkflow
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
