import { Bell, Search } from "lucide-react";
import Link from "next/link";
import { MobileNavigation, Sidebar } from "./sidebar";

export function AppShell({ section, children }: { section: string; children: React.ReactNode }) {
  return <div className="shell"><a className="skip-link" href="#main-content">Skip to content</a><Sidebar/><main className="main"><header className="topbar"><MobileNavigation/><div className="crumb">{section}</div><div className="top-actions"><Link className="btn search-action" href="/feedback"><Search size={15}/><span>Search feedback</span></Link><Link className="btn icon-btn" href="/approvals" aria-label="Approval notifications"><Bell size={15}/><span className="notification-dot" aria-hidden="true"/></Link><div className="avatar" title="Avery Chen">AC</div></div></header><div className="content" id="main-content">{children}</div></main></div>;
}
