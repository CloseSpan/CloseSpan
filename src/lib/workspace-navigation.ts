export const WORKSPACE_NAVIGATION = [
  {
    id: "overview",
    label: "Overview",
    section: "Executive overview",
    href: "/overview",
  },
  {
    id: "feedback",
    label: "Feedback inbox",
    section: "Feedback inbox",
    href: "/feedback",
  },
  {
    id: "problems",
    label: "Product problems",
    section: "Product problems",
    href: "/problems",
  },
  {
    id: "prioritization",
    label: "Prioritization",
    section: "Prioritization",
    href: "/prioritization",
  },
  {
    id: "investigations",
    label: "Investigations",
    section: "AI investigations",
    href: "/investigations",
  },
  {
    id: "approvals",
    label: "Approvals",
    section: "Approval center",
    href: "/approvals",
  },
  {
    id: "follow-up",
    label: "Follow-up",
    section: "Customer follow-up",
    href: "/follow-up",
  },
  {
    id: "integrations",
    label: "Integrations",
    section: "Integrations",
    href: "/integrations",
  },
  {
    id: "customers",
    label: "Customers",
    section: "Customers",
    href: "/customers",
  },
  {
    id: "settings",
    label: "Settings",
    section: "Settings & governance",
    href: "/settings",
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

  // Agent-run detail pages are part of the reviewed approval workflow.
  if (normalized === "/agent-runs" || normalized.startsWith("/agent-runs/")) {
    return WORKSPACE_NAVIGATION.findIndex(({ id }) => id === "approvals");
  }

  return null;
}

export function workspaceRouteDirection(
  previousPathname: string | null,
  nextPathname: string,
): WorkspaceRouteDirection {
  if (!previousPathname) return "none";
  const previousIndex = workspaceRouteIndex(previousPathname);
  const nextIndex = workspaceRouteIndex(nextPathname);
  if (previousIndex === null || nextIndex === null || previousIndex === nextIndex) {
    return "none";
  }
  return nextIndex > previousIndex ? "forward" : "backward";
}

export function workspaceSection(pathname: string): string {
  const normalized = pathnameOnly(pathname);
  if (normalized === "/agent-runs" || normalized.startsWith("/agent-runs/")) {
    return "Agent run results";
  }
  return (
    WORKSPACE_NAVIGATION.find(
      ({ href }) => normalized === href || normalized.startsWith(`${href}/`),
    )?.section ?? "Workspace"
  );
}
