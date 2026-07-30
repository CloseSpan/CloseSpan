"use client";

import { usePathname } from "next/navigation";
import { workspaceSection } from "@/lib/workspace-navigation";

export function WorkspaceBreadcrumb() {
  return <div className="crumb">{workspaceSection(usePathname())}</div>;
}
