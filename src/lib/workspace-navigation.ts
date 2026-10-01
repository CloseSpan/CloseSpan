import { WORKSPACE_LABELS } from "./workspace-labels";

export const WORKSPACE_NAVIGATION_GROUPS = [
  { id: "overview", label: null },
  { id: "workflow", label: "Workflow" },
  { id: "workspace", label: "Workspace" },
] as const;

export const WORKSPACE_NAVIGATION = [
  {
    id: "overview",
    label: WORKSPACE_LABELS["overview"],
    section: WORKSPACE_LABELS["overview"],
    href: "/overview",
    group: "overview",
  },
  {
    id: "customers",
    label: WORKSPACE_LABELS["customers"],
    section: WORKSPACE_LABELS["customers"],
    href: "/customers",
    group: "overview",
  },
  {
    id: "feedback",
    label: WORKSPACE_LABELS["feedback"],
    section: WORKSPACE_LABELS["feedback"],
    href: "/feedback",
    group: "workflow",
  },
  {
    id: "problems",
    label: WORKSPACE_LABELS["problems"],
    section: WORKSPACE_LABELS["problems"],
    href: "/problems",
    group: "workflow",
  },
  {
    id: "pdd",
    label: WORKSPACE_LABELS["pdd"],
    section: WORKSPACE_LABELS["pdd"],
    href: "/pdd",
    group: "workflow",
  },
  {
    id: "approvals",
    label: WORKSPACE_LABELS["approvals"],
    section: WORKSPACE_LABELS["approvals"],
    href: "/approvals",
    group: "workflow",
  },
  {
    id: "agent-runs",
    label: WORKSPACE_LABELS["agent-runs"],
    section: WORKSPACE_LABELS["agent-runs"],
    href: "/agent-runs",
    group: "workflow",
  },
  {
    id: "follow-up",
    label: WORKSPACE_LABELS["follow-up"],
    section: WORKSPACE_LABELS["follow-up"],
    href: "/follow-up",
    group: "workflow",
  },
  {
    id: "integrations",
    label: WORKSPACE_LABELS["integrations"],
    section: WORKSPACE_LABELS["integrations"],
    href: "/integrations",
    group: "workspace",
  },
  {
    id: "settings",
    label: WORKSPACE_LABELS["settings"],
    section: WORKSPACE_LABELS["settings"],
    href: "/settings",
    group: "workspace",
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
  if (
    normalized === "/integrations" ||
    normalized.startsWith("/integrations/")
  ) {
    return WORKSPACE_LABELS.integrations;
  }
  if (
    normalized === "/admin/users" ||
    normalized === "/admin/waitlist"
  ) {
    return "Active users";
  }
  return (
    WORKSPACE_NAVIGATION.find(
      ({ href }) => normalized === href || normalized.startsWith(`${href}/`),
    )?.section ?? "Workspace"
  );
}
