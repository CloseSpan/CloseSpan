"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { launchPricingNote } from "@/lib/plans";
import type { SettingsView } from "@/lib/workspace-repository";
import { AiProviderSettings } from "./ai-provider-settings";
import { PageTitle } from "./screens";

const settingsSections = [
  ["agent", "Agent autonomy"],
  ["model", "AI provider"],
  ["priority", "Prioritization"],
  ["data", "Data & privacy"],
  ["members", "Members & roles"],
  ["billing", "Plan & billing"],
  ["usage", "Usage limits"],
] as const;

type SettingsSectionId = (typeof settingsSections)[number][0];

function sectionFromHash(hash: string): SettingsSectionId {
  const candidate = hash.replace(/^#/, "");
  return settingsSections.some(([id]) => id === candidate)
    ? (candidate as SettingsSectionId)
    : "agent";
}

export function SettingsScreen({
  settings,
  orgId,
}: {
  settings: SettingsView;
  orgId: string;
}) {
  const [weights, setWeights] = useState<Record<string, number>>(
    settings.priorityWeights,
  );
  const [autonomy, setAutonomy] = useState(settings.autonomyLevel);
  const [pii, setPii] = useState(settings.piiRedaction);
  const [saved, setSaved] = useState(false);
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
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const labels: Record<string, string> = {
    frequency: "Frequency",
    severity: "Severity",
    revenue: "Revenue",
    churnRisk: "Churn risk",
    customerTier: "Customer tier",
    strategicAlignment: "Strategic alignment",
    sla: "SLA",
    engineeringEffort: "Effort",
  };

  return (
    <>
      <PageTitle
        title="Settings & governance"
        description="Define permissions, data controls, model policies, and spending boundaries."
        action={
          <button
            type="button"
            className="btn primary"
            disabled={total !== 100}
            onClick={() => setSaved(true)}
          >
            Save demo policy
          </button>
        }
      />
      {saved && (
        <p className="toast success" role="status">
          Policy draft saved for this browser session. Server-side policy
          mutation is the next connector boundary.
        </p>
      )}
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {settingsSections.map(([id, label]) => (
            <a
              className={activeSection === id ? "active" : undefined}
              href={`#${id}`}
              aria-current={activeSection === id ? "location" : undefined}
              onClick={() => setActiveSection(id)}
              key={id}
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="detail-stack">
          <section className="card" id="agent">
            <div className="card-head">
              <div>
                <h2>Agent autonomy</h2>
                <p className="subtle">Default policy for all agent workflows</p>
              </div>
            </div>
            <div className="card-body">
              <label className="field">
                Autonomy level
                <select
                  value={autonomy}
                  onChange={(event) => {
                    setAutonomy(event.target.value);
                    setSaved(false);
                  }}
                >
                  <option>Observe</option>
                  <option>Recommend</option>
                  <option>Organize</option>
                  <option>Execute with approval</option>
                  <option>Limited autonomy</option>
                </select>
              </label>
              <div className="callout section-gap-sm">
                <div className="callout-title">Protected actions</div>
                <p className="subtle">
                  Production code merges and deployments always require a human.
                  This cannot be overridden by workspace autonomy.
                </p>
              </div>
            </div>
          </section>
          <AiProviderSettings initial={settings.ai} orgId={orgId} />
          <section className="card" id="priority">
            <div className="card-head">
              <h2>Prioritization weights</h2>
              <span className={`badge ${total === 100 ? "success" : "high"}`}>
                {total}% allocated
              </span>
            </div>
            <div className="card-body">
              {Object.entries(weights).map(([key, weight]) => (
                <label className="weight-row" key={key}>
                  <span>{labels[key] ?? key}</span>
                  <input
                    type="range"
                    min="0"
                    max="40"
                    value={weight}
                    onChange={(event) => {
                      setWeights((value) => ({
                        ...value,
                        [key]: Number(event.target.value),
                      }));
                      setSaved(false);
                    }}
                  />
                  <strong>{weight}%</strong>
                </label>
              ))}
            </div>
          </section>
          <section className="card" id="data">
            <div className="card-head">
              <h2>Data protection</h2>
            </div>
            <div className="card-body">
              <label className="toggle-row">
                <div>
                  <strong>PII redaction</strong>
                  <p className="subtle">
                    Redact sensitive values before model processing
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={pii}
                  onChange={(event) => {
                    setPii(event.target.checked);
                    setSaved(false);
                  }}
                />
              </label>
              <label className="field">
                Feedback retention
                <select defaultValue={`${settings.retentionDays} days`}>
                  <option>90 days</option>
                  <option>365 days</option>
                  <option>Custom policy</option>
                </select>
              </label>
            </div>
          </section>
          <section className="card" id="members">
            <div className="card-head">
              <h2>Members & roles</h2>
              <span className="badge">{settings.members.length} members</span>
            </div>
            <div className="card-body">
              {settings.members.map((member) => (
                <div className="rank-row" key={member.id}>
                  <div>
                    <strong>{member.name}</strong>
                    <p className="subtle">
                      {member.email} · {member.team}
                    </p>
                  </div>
                  <span
                    className={`badge ${member.role === "Admin" ? "brand" : ""}`}
                  >
                    {member.role}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section className="card" id="billing">
            <div className="card-head">
              <div>
                <h2>Plan & billing</h2>
                <p className="subtle">
                  Transparent sandbox boundary and early-access packaging
                </p>
              </div>
              <span className="badge brand">{settings.planName}</span>
            </div>
            <div className="card-body">
              <div className="split plan-summary">
                <div>
                  <div className="metric-label">Current price</div>
                  <strong>{settings.planPrice}</strong>
                  <p className="subtle">
                    Seeded workspace · no live customer data · no external
                    writes
                  </p>
                </div>
                <Link className="btn" href="/#pricing">
                  View early-access pricing
                </Link>
              </div>
              <div className="callout section-gap-sm">
                <div className="callout-title">No automatic upgrades</div>
                <p className="subtle">
                  {launchPricingNote} Production usage limits stop processing at
                  the configured cap instead of creating surprise charges.
                </p>
              </div>
            </div>
          </section>
          <section className="card" id="usage">
            <div className="card-head">
              <h2>Usage & cost limits</h2>
              <span className="badge success">Within policy</span>
            </div>
            <div className="card-body">
              <div className="grid cols-3">
                <div>
                  <div className="metric-label">Monthly model budget</div>
                  <strong>${settings.monthlyModelBudget}</strong>
                </div>
                <div>
                  <div className="metric-label">Used this month</div>
                  <strong>${settings.usedModelCost}</strong>
                </div>
                <div>
                  <div className="metric-label">Hard stop</div>
                  <strong>{settings.hardStop ? "Enabled" : "Disabled"}</strong>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
