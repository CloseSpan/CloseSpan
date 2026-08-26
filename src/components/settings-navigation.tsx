"use client";

import {
  ArrowLeft,
  Bot,
  Boxes,
  Cpu,
  FilePenLine,
  FlaskConical,
  Gauge,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export const SETTINGS_SECTIONS = [
  ["agent", "Agent autonomy"],
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

function sectionFromHash(hash: string): SettingsSectionId {
  const candidate = hash.replace(/^#/, "");
  return SETTINGS_SECTIONS.some(([id]) => id === candidate)
    ? (candidate as SettingsSectionId)
    : "agent";
}

export function SettingsNavigation({ mobile = false }: { mobile?: boolean }) {
  const [activeSection, setActiveSection] =
    useState<SettingsSectionId>("agent");

  useEffect(() => {
    function syncSectionFromHash(): void {
      setActiveSection(sectionFromHash(window.location.hash));
    }

    syncSectionFromHash();
    window.addEventListener("hashchange", syncSectionFromHash);
    return () => window.removeEventListener("hashchange", syncSectionFromHash);
  }, []);

  return (
    <nav
      className={`nav settings-sidebar-navigation${mobile ? " settings-mobile-navigation" : ""}`}
      aria-label="Settings sections"
    >
      <Link className="settings-back-link" href="/overview" prefetch={false}>
        <ArrowLeft aria-hidden="true" size={17} />
        <span>Back to workspace</span>
      </Link>
      <span className="nav-section-label settings-navigation-label">
        Settings
      </span>
      <div className="settings-sidebar-sections">
        {SETTINGS_SECTIONS.map(([id, label]) => {
          const Icon = settingsIcons[id];
          return (
            <a
              className={activeSection === id ? "active" : undefined}
              href={`#${id}`}
              aria-current={activeSection === id ? "location" : undefined}
              aria-label={label}
              title={label}
              onClick={() => setActiveSection(id)}
              key={id}
            >
              <Icon aria-hidden="true" size={17} />
              <span>{label}</span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
