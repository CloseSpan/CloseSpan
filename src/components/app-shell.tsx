import { Bell, LogOut, Search, UserRound } from "lucide-react";
import Link from "next/link";
import { signOutCurrentUser } from "@/app/auth-actions";
import type { WorkspaceUser } from "@/lib/auth-user";
import { MobileNavigation, Sidebar } from "./sidebar";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "U";
}

export function AppShell({
  section,
  user,
  children,
}: {
  section: string;
  user: WorkspaceUser;
  children: React.ReactNode;
}) {
  return <div className="shell"><a className="skip-link" href="#main-content">Skip to content</a><Sidebar/><main className="main"><header className="topbar"><MobileNavigation/><div className="crumb">{section}</div><div className="top-actions"><Link className="btn search-action" href="/feedback"><Search size={15}/><span>Search feedback</span></Link><Link className="btn icon-btn" href="/approvals" aria-label="Approval notifications"><Bell size={15}/><span className="notification-dot" aria-hidden="true"/></Link><details className="user-menu"><summary aria-label={`Open account menu for ${user.name}`}><span className="avatar" aria-hidden="true">{initials(user.name)}</span></summary><div className="user-menu-panel"><div className="user-menu-identity"><UserRound aria-hidden="true" size={17}/><span><strong>{user.name}</strong><small>{user.email}</small></span></div><span className="user-role">{user.role}</span><form action={signOutCurrentUser}><button type="submit"><LogOut aria-hidden="true" size={15}/>Sign out</button></form></div></details></div></header><div className="content" id="main-content">{children}</div></main></div>;
}
