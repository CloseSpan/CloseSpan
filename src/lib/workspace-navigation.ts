import { WORKSPACE_LABELS } from "./workspace-labels";

export const WORKSPACE_NAVIGATION_GROUPS = [
  { id: "work", label: null },
  { id: "workspace", label: null },
] as const;

/** The everyday sidebar: Issues is home; Settings holds secondary tools. */
export const WORKSPACE_NAVIGATION = [
  {
    id: "problems",
    label: WORKSPACE_LABELS["problems"],
    section: WORKSPACE_LABELS["problems"],
    href: "/problems",
    group: "work",
  },
  {
    id: "approvals",
    label: WORKSPACE_LABELS["approvals"],
    section: WORKSPACE_LABELS["approvals"],
    href: "/approvals",
    group: "work",
  },
  {
    id: "feedback",
    label: WORKSPACE_LABELS["feedback"],
    section: WORKSPACE_LABELS["feedback"],
    href: "/feedback",
    group: "work",
  },
  {
    id: "settings",
    label: WORKSPACE_LABELS["settings"],
    section: WORKSPACE_LABELS["settings"],
    href: "/settings",
    group: "workspace",
  },
] as const;

/**
 * Routes outside the sidebar, with the item that owns them and their
 * breadcrumb. Per-issue work belongs to Issues; tools and logs to Settings.
 */
const SECONDARY_ROUTES = [
  { href: "/pdd", owner: "/problems", section: WORKSPACE_LABELS["pdd"] },
  { href: "/investigations", owner: "/problems", section: WORKSPACE_LABELS["problems"] },
  { href: "/prioritization", owner: "/problems", section: WORKSPACE_LABELS["pdd"] },
  { href: "/follow-up", owner: "/problems", section: WORKSPACE_LABELS["follow-up"] },
  { href: "/customers", owner: "/settings", section: WORKSPACE_LABELS["customers"] },
  { href: "/agent-runs", owner: "/settings", section: WORKSPACE_LABELS["agent-runs"] },
  { href: "/integrations", owner: "/settings", section: WORKSPACE_LABELS["integrations"] },
] as const;

export type WorkspaceNavigationId = (typeof WORKSPACE_NAVIGATION)[number]["id"];
export type WorkspaceRouteDirection = "forward" | "backward" | "none";

function pathnameOnly(value: string): string {
  return value.split(/[?#]/, 1)[0] || "/";
}

function matchesRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function workspaceRouteIndex(pathname: string): number | null {
  const normalized = pathnameOnly(pathname);
  const directIndex = WORKSPACE_NAVIGATION.findIndex(
    ({ href }) => matchesRoute(normalized, href),
  );
  if (directIndex >= 0) return directIndex;
  const secondary = SECONDARY_ROUTES.find(({ href }) => matchesRoute(normalized, href));
  return secondary ? WORKSPACE_NAVIGATION.findIndex(({ href }) => href === secondary.owner) : null;
}

/** The sidebar item that should appear active for a route, if any. */
export function workspaceNavigationOwner(pathname: string): WorkspaceNavigationId | null {
  const index = workspaceRouteIndex(pathname);
  return index === null ? null : WORKSPACE_NAVIGATION[index].id;
}

export function workspaceRouteDirection(
  previousPathname: string | null,
  nextPathname: string,
): WorkspaceRouteDirection {
  if (!previousPathname) return "none";
  const previousIndex = workspaceRouteIndex(previousPathname);
  const nextIndex = workspaceRouteIndex(nextPathname);
  if (previousIndex === null || nextIndex === null) {
    return "none";
  }
  if (previousIndex === nextIndex) {
    const previousNormalized = pathnameOnly(previousPathname);
    const nextNormalized = pathnameOnly(nextPathname);
    if (previousNormalized === nextNormalized) return "none";

    const previousDepth = previousNormalized.split("/").filter(Boolean).length;
    const nextDepth = nextNormalized.split("/").filter(Boolean).length;
    return nextDepth < previousDepth ? "backward" : "forward";
  }
  return nextIndex > previousIndex ? "forward" : "backward";
}

export function workspaceSection(pathname: string): string {
  const normalized = pathnameOnly(pathname);
  if (
    normalized === "/settings/appearance" ||
    normalized.startsWith("/settings/appearance/")
  ) {
    return "Appearance";
  }
  if (normalized === "/settings/connections") return "Connections";
  if (normalized === "/settings" || normalized.startsWith("/settings/")) {
    return WORKSPACE_LABELS.settings;
  }
  if (normalized === "/notifications" || normalized.startsWith("/notifications/")) {
    return "Notifications";
  }
  if (
    normalized === "/admin/users" ||
    normalized === "/admin/waitlist"
  ) {
    return "Active users";
  }
  return (
    WORKSPACE_NAVIGATION.find(({ href }) => matchesRoute(normalized, href))?.section
      ?? SECONDARY_ROUTES.find(({ href }) => matchesRoute(normalized, href))?.section
      ?? "Workspace"
  );
}
