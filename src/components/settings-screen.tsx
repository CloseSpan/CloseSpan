"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { launchPricingNote } from "@/lib/plans";
import type { SettingsView } from "@/lib/workspace-repository";
import { AiProviderSettings } from "./ai-provider-settings";
import {
  CUSTOM_RETENTION_OPTION,
  CustomRetentionInput,
  initialRetentionSelection,
  isValidCustomRetention,
  parseCustomRetention,
} from "./custom-retention-input";
import { CustomSelect } from "./custom-select";
import { PageTitle } from "./screens";
import { TenkiSandboxCheck } from "./tenki-sandbox-check";

const settingsSections = [
  ["agent", "Agent autonomy"],
  ["prompt-drafts", "Prompt drafting"],
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
  userRole,
  tenkiConfigured,
  promptEmailConfigured,
}: {
  settings: SettingsView;
  orgId: string;
  userRole: string;
  tenkiConfigured: boolean;
  promptEmailConfigured: boolean;
}) {
  const [weights, setWeights] = useState<Record<string, number>>(
    settings.priorityWeights,
  );
  const [autonomy, setAutonomy] = useState(settings.autonomyLevel);
  const initialRetention = initialRetentionSelection(settings.retentionDays);
  const [retention, setRetention] = useState(initialRetention.option);
  const [customRetention, setCustomRetention] = useState(
    initialRetention.customValue,
  );
  const [pii, setPii] = useState(settings.piiRedaction);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [promptDraftPolicy, setPromptDraftPolicy] = useState(
    settings.promptDraftPolicy,
  );
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
  const retentionValid =
    retention !== CUSTOM_RETENTION_OPTION ||
    isValidCustomRetention(customRetention);
  const saveDisabledReason =
    userRole !== "Admin"
      ? "Only workspace admins can change policy."
      : total !== 100
        ? "Prioritization weights must total 100%."
        : !retentionValid
          ? "Enter a valid feedback-retention period."
          : undefined;
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

  function retentionDays(): number {
    if (retention !== CUSTOM_RETENTION_OPTION) return Number.parseInt(retention, 10);
    const parsed = parseCustomRetention(customRetention);
    if (!parsed) return settings.retentionDays;
    const quantity = Number(parsed.quantity);
    return parsed.unit === "days" ? quantity : parsed.unit === "months" ? quantity * 30 : quantity * 365;
  }

  async function savePolicy(): Promise<void> {
    setSaving(true);
    setSaved(false);
    setSaveError(undefined);
    try {
      const response = await fetch("/api/settings/policy", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-org-id": orgId,
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify({
          autonomyLevel: autonomy,
          piiRedaction: pii,
          retentionDays: retentionDays(),
          priorityWeights: weights,
          promptDraftPolicy,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Workspace policy could not be saved.");
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Workspace policy could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageTitle
        title="Settings & governance"
        description="Define permissions, data controls, model policies, and spending boundaries."
        action={
          <div className="settings-save-action">
            <button
              type="button"
              className="btn primary"
              disabled={Boolean(saveDisabledReason) || saving}
              aria-describedby={saveDisabledReason ? "settings-save-reason" : undefined}
              onClick={savePolicy}
            >
              {saving ? "Saving…" : "Save policy"}
            </button>
            {saveDisabledReason && (
              <span className="subtle" id="settings-save-reason">
                {saveDisabledReason}
              </span>
            )}
          </div>
        }
      />
      {saved && (
        <p className="toast success" role="status">
          Workspace policy saved. New grouped reports will follow these prompt-drafting rules.
        </p>
      )}
      {saveError && <p className="toast error" role="alert">{saveError}</p>}
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
              <div className="field">
                <span>Autonomy level</span>
                <CustomSelect
                  ariaLabel="Autonomy level"
                  value={autonomy}
                  options={[
                    "Observe",
                    "Recommend",
                    "Organize",
                    "Execute with approval",
                    "Limited autonomy",
                  ]}
                  onValueChange={(value) => {
                    setAutonomy(value);
                    setSaved(false);
                  }}
                />
              </div>
              <div className="callout section-gap-sm">
                <div className="callout-title">Protected actions</div>
                <p className="subtle">
                  Production code merges and deployments always require a human.
                  This cannot be overridden by workspace autonomy.
                </p>
              </div>
              <TenkiSandboxCheck
                orgId={orgId}
                configured={tenkiConfigured}
                isAdmin={userRole === "Admin"}
              />
            </div>
          </section>
          <section className="card" id="prompt-drafts">
            <div className="card-head">
              <div>
                <h2>Implementation prompt drafting</h2>
                <p className="subtle">Choose when the agent creates a reviewable .prompt artifact from grouped feedback.</p>
              </div>
              <span className={`badge ${promptDraftPolicy.mode === "automatic" ? "brand" : ""}`}>
                {promptDraftPolicy.mode === "automatic" ? "Automatic drafts" : "Manual"}
              </span>
            </div>
            <div className="card-body">
              <div className="field">
                <span>Draft creation</span>
                <CustomSelect
                  ariaLabel="Prompt draft creation"
                  value={promptDraftPolicy.mode}
                  options={[
                    { label: "Manual", value: "manual" },
                    { label: "Automatic draft", value: "automatic" },
                  ]}
                  onValueChange={(mode) => {
                    setPromptDraftPolicy((value) => ({ ...value, mode: mode as "manual" | "automatic" }));
                    setSaved(false);
                  }}
                />
              </div>
              <div className="callout section-gap-sm">
                <div className="callout-title">Drafts cannot execute code</div>
                <p className="subtle">A product manager must promote the draft through PDD and explicitly approve each isolated Tenki run. Automatic merge and deployment remain blocked.</p>
              </div>
              <label className="toggle-row section-gap-sm">
                <div><strong>Bug and incident reports</strong><p className="subtle">Draft a suggested fix after the evidence threshold is met.</p></div>
                <input type="checkbox" checked={promptDraftPolicy.bugReports} disabled={promptDraftPolicy.mode !== "automatic"} onChange={(event) => { setPromptDraftPolicy((value) => ({ ...value, bugReports: event.target.checked })); setSaved(false); }} />
              </label>
              <label className="toggle-row">
                <div><strong>Feature requests</strong><p className="subtle">Draft a product-change prompt from a grouped request.</p></div>
                <input type="checkbox" checked={promptDraftPolicy.featureRequests} disabled={promptDraftPolicy.mode !== "automatic"} onChange={(event) => { setPromptDraftPolicy((value) => ({ ...value, featureRequests: event.target.checked })); setSaved(false); }} />
              </label>
              <label className="weight-row">
                <span>Minimum reports</span>
                <input type="range" min="1" max="20" value={promptDraftPolicy.minimumEvidence} disabled={promptDraftPolicy.mode !== "automatic"} onChange={(event) => { setPromptDraftPolicy((value) => ({ ...value, minimumEvidence: Number(event.target.value) })); setSaved(false); }} />
                <strong>{promptDraftPolicy.minimumEvidence}</strong>
              </label>
              <label className="weight-row">
                <span>Confidence</span>
                <input type="range" min="50" max="100" step="5" value={Math.round(promptDraftPolicy.minimumConfidence * 100)} disabled={promptDraftPolicy.mode !== "automatic"} onChange={(event) => { setPromptDraftPolicy((value) => ({ ...value, minimumConfidence: Number(event.target.value) / 100 })); setSaved(false); }} />
                <strong>{Math.round(promptDraftPolicy.minimumConfidence * 100)}%</strong>
              </label>
              <div className="field section-gap-sm">
                <span>Assigned reviewer</span>
                <CustomSelect
                  ariaLabel="Prompt draft reviewer"
                  disabled={promptDraftPolicy.mode !== "automatic"}
                  value={promptDraftPolicy.reviewerId ?? ""}
                  options={[
                    { label: "Unassigned", value: "" },
                    ...settings.members.map((member) => ({ label: `${member.name} · ${member.role}`, value: member.id })),
                  ]}
                  onValueChange={(reviewerId) => { setPromptDraftPolicy((value) => ({ ...value, reviewerId: reviewerId || null })); setSaved(false); }}
                />
              </div>
              <label className="toggle-row section-gap-sm">
                <div><strong>In-app notification</strong><p className="subtle">Add the prompt to the reviewer&apos;s CloseSpan notification inbox.</p></div>
                <input type="checkbox" checked={promptDraftPolicy.inAppNotifications} disabled={promptDraftPolicy.mode !== "automatic" || !promptDraftPolicy.reviewerId} onChange={(event) => { setPromptDraftPolicy((value) => ({ ...value, inAppNotifications: event.target.checked })); setSaved(false); }} />
              </label>
              <label className="toggle-row">
                <div><strong>Email alert</strong><p className="subtle">Email the assigned reviewer when the prompt draft is ready.</p></div>
                <input type="checkbox" checked={promptDraftPolicy.emailNotifications} disabled={promptDraftPolicy.mode !== "automatic" || !promptDraftPolicy.reviewerId} onChange={(event) => { setPromptDraftPolicy((value) => ({ ...value, emailNotifications: event.target.checked })); setSaved(false); }} />
              </label>
              {promptDraftPolicy.emailNotifications && !promptEmailConfigured && (
                <div className="callout warning" role="status">
                  <div className="callout-title">Email delivery needs configuration</div>
                  <p className="subtle">The preference will be saved and alerts will remain safely queued until Cloudflare Email Service credentials and a verified sender are configured.</p>
                </div>
              )}
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
          <section className="card settings-data-card" id="data">
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
              <div className="field">
                <span>Feedback retention</span>
                <CustomSelect
                  ariaLabel="Feedback retention"
                  className="settings-retention-select"
                  inlineMenu
                  value={retention}
                  options={["90 days", "365 days", CUSTOM_RETENTION_OPTION]}
                  onValueChange={(value) => {
                    setRetention(value);
                    setSaved(false);
                  }}
                />
                <CustomRetentionInput
                  open={retention === CUSTOM_RETENTION_OPTION}
                  value={customRetention}
                  onValueChange={(value) => {
                    setCustomRetention(value);
                    setSaved(false);
                  }}
                />
              </div>
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
