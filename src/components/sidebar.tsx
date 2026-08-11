"use client";

import {
  Activity,
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
  useSyncExternalStore,
} from "react";
import {
  WORKSPACE_NAVIGATION,
  WORKSPACE_NAVIGATION_GROUPS,
  type WorkspaceNavigationId,
} from "@/lib/workspace-navigation";
import { CloseSpan3DLogo } from "./closespan-3d-logo";
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
}: {
  collapsibleWorkflow?: boolean;
}) {
  const pathname = usePathname();
  const workflowContentId = useId();
  const storedWorkflowExpanded = useSyncExternalStore(
    subscribeToWorkflowPreference,
    readWorkflowPreference,
    () => true,
  );
  const workflowExpanded = collapsibleWorkflow
    ? storedWorkflowExpanded
    : true;

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
                    return (
                      <Link
                        href={href}
                        prefetch={false}
                        className={active ? "active" : ""}
                        aria-current={active ? "page" : undefined}
                        aria-label={label}
                        data-nav-label={label}
                        style={{
                          "--nav-enter-delay": `${index * 34}ms`,
                          "--nav-exit-delay": `${(items.length - index - 1) * 18}ms`,
                        } as CSSProperties}
                        key={label}
                      >
                        <Icon aria-hidden="true" />
                        <span>{label}</span>
                        <NavigationPendingIndicator />
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
                    return (
                      <Link
                        href={href}
                        prefetch={false}
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
}: {
  organizations: OrganizationSwitcherItem[];
  activeOrganizationId: string;
  demoMode: boolean;
  canRenameWorkspace: boolean;
}) {
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
      <nav className="nav" aria-label="Primary navigation">
        <NavigationLinks collapsibleWorkflow />
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
