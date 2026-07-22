import { Bell, LogOut, Search, UserRound } from "lucide-react";
import Link from "next/link";
import { signOutCurrentUser } from "@/app/auth-actions";
import { applicationMode, type WorkspaceUser } from "@/lib/auth-user";
import { getWorkspaceDemoGuide } from "@/lib/demo-guide-repository";
import { CloseSpanLogo } from "./closespan-logo";
import { GuidedDemo } from "./guided-demo";
import { OrganizationSwitcher } from "./organization-switcher";
import { MobileNavigation, Sidebar } from "./sidebar";

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

export async function AppShell({
  section,
  user,
  children,
  immersive = false,
}: {
  section: string;
  user: WorkspaceUser;
  children: React.ReactNode;
  immersive?: boolean;
}) {
  const demoGuide = await getWorkspaceDemoGuide(user.orgId);
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
              aria-label="CloseSpan overview"
            >
              <CloseSpanLogo size="sm" />
            </Link>
            <div className="immersive-top-actions">
              <OrganizationSwitcher
                organizations={user.organizations}
                activeOrganizationId={user.orgId}
                variant="topbar"
              />
              <Link className="btn" href="/settings#ai">
                AI settings
              </Link>
              <details className="user-menu">
                <summary aria-label={`Open account menu for ${user.name}`}>
                  <span className="avatar" aria-hidden="true">
                    {initials(user.name)}
                  </span>
                </summary>
                <div className="user-menu-panel">
                  <div className="user-menu-identity">
                    <UserRound aria-hidden="true" size={17} />
                    <span>
                      <strong>{user.name}</strong>
                      <small>{user.email}</small>
                    </span>
                  </div>
                  <span className="user-role">{user.role}</span>
                  <form action={signOutCurrentUser}>
                    <button type="submit">
                      <LogOut aria-hidden="true" size={15} />
                      Sign out
                    </button>
                  </form>
                </div>
              </details>
            </div>
          </header>
          <div className="content immersive-content" id="main-content">
            {children}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="shell app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Sidebar
        organizations={user.organizations}
        activeOrganizationId={user.orgId}
        demoMode={applicationMode() === "demo"}
      />
      <main className="main">
        <header className="topbar">
          <MobileNavigation
            organizations={user.organizations}
            activeOrganizationId={user.orgId}
          />
          <div className="crumb">{section}</div>
          <div className="top-actions">
            <Link className="btn search-action" href="/feedback">
              <Search size={15} />
              <span>Search feedback</span>
            </Link>
            <Link className="btn icon-btn" href="/approvals" aria-label="Open approvals">
              <Bell size={15} />
            </Link>
            <details className="user-menu">
              <summary aria-label={`Open account menu for ${user.name}`}>
                <span className="avatar" aria-hidden="true">
                  {initials(user.name)}
                </span>
              </summary>
              <div className="user-menu-panel">
                <div className="user-menu-identity">
                  <UserRound aria-hidden="true" size={17} />
                  <span>
                    <strong>{user.name}</strong>
                    <small>{user.email}</small>
                  </span>
                </div>
                <span className="user-role">{user.role}</span>
                <form action={signOutCurrentUser}>
                  <button type="submit">
                    <LogOut aria-hidden="true" size={15} />
                    Sign out
                  </button>
                </form>
              </div>
            </details>
          </div>
        </header>
        <div className="content" id="main-content">
          {children}
        </div>
      </main>
      {demoGuide && <GuidedDemo guide={demoGuide} orgId={user.orgId} />}
    </div>
  );
}
