"use client";

import { Activity, BadgeCheck, Blocks, CircleGauge, GitPullRequest, Inbox, ListChecks, Network, Settings, Users } from "lucide-react";
import { usePathname } from "next/navigation";
import Link from "next/link";

export const navigationItems = [
  [CircleGauge, "Overview", "/overview"], [Inbox, "Feedback inbox", "/feedback"], [Network, "Product problems", "/problems"], [ListChecks, "Prioritization", "/prioritization"],
  [Activity, "Investigations", "/investigations"], [BadgeCheck, "Approvals", "/approvals"], [GitPullRequest, "Follow-up", "/follow-up"], [Blocks, "Integrations", "/integrations"], [Users, "Customers", "/customers"], [Settings, "Settings", "/settings"],
] as const;

export function Sidebar() {
  const pathname = usePathname();
  return <aside className="sidebar">
    <Link className="brand" href="/" aria-label="FeedbackFlow AI home"><div className="brandmark">F</div><span>FeedbackFlow AI</span></Link>
    <div className="workspace">Northstar workspace</div>
    <nav className="nav" aria-label="Primary navigation">{navigationItems.map(([Icon, label, href]) => { const active = pathname === href || pathname.startsWith(`${href}/`); return <Link href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined} aria-label={label} title={label} key={label}><Icon aria-hidden="true"/><span>{label}</span></Link>})}</nav>
    <div className="demo-label"><strong>SIMULATED WORKSPACE</strong>Seeded data · no external systems connected</div>
  </aside>;
}

export function MobileNavigation() {
  const pathname = usePathname();
  return <details className="mobile-menu"><summary>Menu</summary><nav aria-label="Mobile navigation">{navigationItems.map(([Icon, label, href]) => { const active = pathname === href || pathname.startsWith(`${href}/`); return <Link href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined} key={label}><Icon aria-hidden="true"/><span>{label}</span></Link>})}</nav></details>;
}
