import {
  Bell,
  LogOut,
  Search,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { signOutCurrentUser } from "@/app/auth-actions";
import type { WorkspaceUser } from "@/lib/auth-user";
import { getWorkspaceDemoGuide } from "@/lib/demo-guide-repository";
import { workspacePersistenceMode } from "@/lib/workspace-persistence";
import { CloseSpan3DLogo } from "./closespan-3d-logo";
import { AccountMenuNavigation } from "./account-menu-navigation";
import { GuidedDemo } from "./guided-demo";
import { OrganizationSwitcher } from "./organization-switcher";
import { MobileNavigation, Sidebar } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { WorkspaceBreadcrumb } from "./workspace-breadcrumb";
import { WorkspaceRouteTransition } from "./workspace-route-transition";
import { BackgroundPromptTestProvider } from "./background-prompt-tests";
import { unreadPromptReviewNotificationCount } from "@/lib/prompt-review-notification-repository";
import { isCloseSpanPlatformAdmin } from "@/lib/workspace-access-policy";

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "U"
  );
}

function AccountMenu({
  user,
  showWaitlistAdmin,
}: {
  user: WorkspaceUser;
  showWaitlistAdmin: boolean;
}) {
  return (
    <UserMenu
      label={`Open account menu for ${user.name}`}
      avatar={initials(user.name)}
    >
      <div className="user-menu-identity">
        <UserRound aria-hidden="true" size={17} />
        <span>
          <strong>{user.name}</strong>
          <small>{user.email}</small>
        </span>
      </div>
      <span className="user-role">{user.role}</span>
      <AccountMenuNavigation showWaitlistAdmin={showWaitlistAdmin} />
      <ThemeToggle />
      <form action={signOutCurrentUser}>
        <button type="submit">
          <LogOut aria-hidden="true" size={15} />
          Sign out
        </button>
      </form>
    </UserMenu>
  );
}

export async function AppShell({
  user,
  children,
  immersive = false,
}: {
  user: WorkspaceUser;
  children: React.ReactNode;
  immersive?: boolean;
}) {
  const demoGuide = await getWorkspaceDemoGuide(user.orgId);
  const durableWorkspace = workspacePersistenceMode(user.orgId) === "postgres";
  const canRenameWorkspace = durableWorkspace && user.role === "Admin";
  const showWaitlistAdmin = isCloseSpanPlatformAdmin(user);
  const unreadNotifications = await unreadPromptReviewNotificationCount(user.orgId, user.id);
  if (immersive) {
    return (
      <div className="shell shell-immersive">
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <main className="main immersive-main">
          <header className="immersive-topbar">
            <Link
              className="immersive-brand"
              href="/overview"
              prefetch={false}
              aria-label="CloseSpan overview"
            >
              <CloseSpan3DLogo size="sm" />
            </Link>
            <div className="immersive-top-actions">
              <OrganizationSwitcher
                organizations={user.organizations}
                activeOrganizationId={user.orgId}
                canRenameWorkspace={canRenameWorkspace}
                variant="topbar"
              />
              <AccountMenu user={user} showWaitlistAdmin={showWaitlistAdmin} />
            </div>
          </header>
          <div
            className="content immersive-content"
            id="main-content"
            tabIndex={-1}
          >
            {children}
          </div>
        </main>
      </div>
    );
  }

  return (
    <BackgroundPromptTestProvider orgId={user.orgId} avoidGuidedDemo={Boolean(demoGuide)}>
    <div className="shell app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Sidebar
        organizations={user.organizations}
        activeOrganizationId={user.orgId}
        demoMode={!durableWorkspace || Boolean(demoGuide)}
        canRenameWorkspace={canRenameWorkspace}
      />
      <main className="main">
        <header className="topbar">
          <MobileNavigation
            organizations={user.organizations}
            activeOrganizationId={user.orgId}
            canRenameWorkspace={canRenameWorkspace}
          />
          <WorkspaceBreadcrumb />
          <div className="top-actions">
            <Link
              className="btn search-action"
              href="/feedback"
              prefetch={false}
            >
              <Search size={15} />
              <span>Search feedback</span>
            </Link>
            <Link
              className="btn icon-btn notification-button"
              href="/notifications"
              prefetch={false}
              aria-label={`Open notifications${unreadNotifications ? `, ${unreadNotifications} unread` : ""}`}
            >
              <Bell size={15} />
              {unreadNotifications > 0 && <span className="notification-count">{Math.min(unreadNotifications, 99)}</span>}
            </Link>
            <AccountMenu user={user} showWaitlistAdmin={showWaitlistAdmin} />
          </div>
        </header>
        <div className="content" id="main-content" tabIndex={-1}>
          <WorkspaceRouteTransition>{children}</WorkspaceRouteTransition>
        </div>
      </main>
      {demoGuide && <GuidedDemo guide={demoGuide} orgId={user.orgId} />}
    </div>
    </BackgroundPromptTestProvider>
  );
}
