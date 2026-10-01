"use client";

import {
  ArrowLeft,
  Bot,
  Cable,
  Boxes,
  Cpu,
  FilePenLine,
  FlaskConical,
  Gauge,
  Palette,
  ShieldCheck,
  SlidersHorizontal,
  Settings2,
  Users,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { NavigationIcon } from "./navigation-icon";

export const SETTINGS_SECTIONS = [
  ["agent", "Automation"],
  ["prompt-drafts", "Prompt drafting"],
  ["prompt-evaluation", "Prompt evaluation"],
  ["execution", "Execution environments"],
  ["orchestration", "Workflow orchestration"],
  ["model", "AI provider"],
  ["priority", "Prioritization"],
  ["data", "Data & privacy"],
  ["members", "Members & roles"],
  ["usage", "Usage limits"],
] as const;

type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number][0];

const settingsIcons: Record<SettingsSectionId, typeof Bot> = {
  agent: Bot,
  "prompt-drafts": FilePenLine,
  "prompt-evaluation": FlaskConical,
  execution: Boxes,
  orchestration: Workflow,
  model: Cpu,
  priority: SlidersHorizontal,
  data: ShieldCheck,
  members: Users,
  usage: Gauge,
};

export function sectionFromHash(hash: string): SettingsSectionId {
  const candidate = hash.replace(/^#/, "");
  return SETTINGS_SECTIONS.some(([id]) => id === candidate)
    ? (candidate as SettingsSectionId)
    : "agent";
}

export function readSettingsSection(): SettingsSectionId | null {
  if (window.location.pathname !== "/settings" && window.location.pathname !== "/settings/") return null;
  return sectionFromHash(window.location.hash);
}

export function subscribeSettingsSection(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

// URL fragments are absent from server requests. Don't guess Automation while
// hydrating a deep link; the browser snapshot supplies the actual destination.
function serverSettingsSection(): null {
  return null;
}

export function SettingsNavigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  const isWorkspaceSettings = pathname === "/settings" || pathname === "/settings/";
  const isAppearance = pathname === "/settings/appearance" || pathname.startsWith("/settings/appearance/");
  const isTechnical = pathname === "/settings/technical";
  const isConnections = pathname === "/settings/connections";
  const activeSection = useSyncExternalStore(
    subscribeSettingsSection,
    readSettingsSection,
    serverSettingsSection,
  );
  const isMoreSettings = isTechnical || (isWorkspaceSettings && activeSection !== null && !["agent", "data", "members", "usage"].includes(activeSection));

  return (
    <nav
      className={`nav settings-sidebar-navigation${mobile ? " settings-mobile-navigation" : ""}`}
      aria-label="Settings sections"
    >
      <Link className="settings-back-link" href="/problems" prefetch={false}>
        <ArrowLeft aria-hidden="true" size={17} />
        <span>Back to issues</span>
      </Link>
      <span className="nav-section-label settings-navigation-label">
        Personal
      </span>
      <div className="settings-sidebar-sections">
        <Link
          href="/settings/appearance"
          className={isAppearance ? "active" : undefined}
          aria-current={isAppearance ? "page" : undefined}
          aria-label="Appearance"
          title="Appearance"
          prefetch={false}
        >
          <NavigationIcon icon={Palette} active={isAppearance} />
          <span>Appearance</span>
        </Link>
      </div>
      <span className="nav-section-label settings-navigation-label">
        Workspace
      </span>
      <div className="settings-sidebar-sections">
        <Link href="/settings/connections" prefetch={false}
          className={isConnections ? "active" : undefined}
          aria-current={isConnections ? "page" : undefined}>
          <NavigationIcon icon={Cable} active={isConnections} /><span>Connections</span>
        </Link>
        {SETTINGS_SECTIONS.filter(([id]) => ["agent", "data", "members", "usage"].includes(id)).map(([id, label]) => {
          const Icon = settingsIcons[id];
          const active = isWorkspaceSettings && activeSection === id;
          return (
            <a
              className={active ? "active" : undefined}
              href={isWorkspaceSettings ? `#${id}` : `/settings#${id}`}
              aria-current={active ? "location" : undefined}
              aria-label={label}
              title={label}
              key={id}
            >
              <NavigationIcon icon={Icon} active={active} />
              <span>{label}</span>
            </a>
          );
        })}
        <Link href="/settings/technical" prefetch={false}
          className={isMoreSettings ? "active" : undefined}
          aria-current={isTechnical ? "page" : undefined}>
          <NavigationIcon icon={Settings2} active={isMoreSettings} /><span>More settings</span>
        </Link>
      </div>
    </nav>
  );
}
