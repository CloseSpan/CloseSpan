export const WORKSPACE_NAVIGATION_GROUPS = [
  { id: "overview", label: null },
  { id: "workflow", label: "Workflow" },
] as const;

export const WORKSPACE_NAVIGATION = [
  {
    id: "overview",
    label: "Overview",
    section: "Executive overview",
    href: "/overview",
    group: "overview",
  },
  {
    id: "customers",
    label: "Customers",
    section: "Customers",
    href: "/customers",
    group: "overview",
  },
  {
    id: "feedback",
    label: "Feedback inbox",
    section: "Feedback inbox",
    href: "/feedback",
    group: "workflow",
  },
  {
    id: "problems",
    label: "Product problems",
    section: "Product problems",
    href: "/problems",
    group: "workflow",
  },
  {
    id: "pdd",
    label: "PDD",
    section: "Prompt-driven development",
    href: "/pdd",
    group: "workflow",
  },
  {
    id: "approvals",
    label: "Action approvals",
    section: "Action approvals",
    href: "/approvals",
    group: "workflow",
  },
  {
    id: "agent-runs",
    label: "Agent runs & verification",
    section: "Agent runs & verification",
    href: "/agent-runs",
    group: "workflow",
  },
  {
    id: "follow-up",
    label: "Follow-up",
    section: "Customer follow-up",
    href: "/follow-up",
    group: "workflow",
  },
] as const;

export type WorkspaceNavigationId = (typeof WORKSPACE_NAVIGATION)[number]["id"];
export type WorkspaceRouteDirection = "forward" | "backward" | "none";

function pathnameOnly(value: string): string {
  return value.split(/[?#]/, 1)[0] || "/";
}

export function workspaceRouteIndex(pathname: string): number | null {
  const normalized = pathnameOnly(pathname);
  const directIndex = WORKSPACE_NAVIGATION.findIndex(
    ({ href }) => normalized === href || normalized.startsWith(`${href}/`),
  );
  if (directIndex >= 0) return directIndex;

  return null;
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
  if (normalized === "/settings" || normalized.startsWith("/settings/")) {
    return "Settings & governance";
  }
  if (
    normalized === "/integrations" ||
    normalized.startsWith("/integrations/")
  ) {
    return "Integrations";
  }
  if (normalized === "/admin/waitlist") return "Waitlist users";
  return (
    WORKSPACE_NAVIGATION.find(
      ({ href }) => normalized === href || normalized.startsWith(`${href}/`),
    )?.section ?? "Workspace"
  );
}
