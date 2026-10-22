"use client";

import { Button, StatusBadge } from "@/components/ui";
import { useState } from "react";
import { autonomyDescription, autonomyLevels, type AutonomyLevel } from "@/lib/autonomy-policy";
import { CustomSelect } from "../custom-select";
import { CUSTOM_RETENTION_OPTION, CustomRetentionInput, initialRetentionSelection, isValidCustomRetention } from "../custom-retention-input";
import type { SettingsView } from "@/lib/workspace-repository";
import { PageTitle } from "./shared";

export function SettingsScreen({
  settings,
}: {
  settings: SettingsView;
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
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const retentionValid =
    retention !== CUSTOM_RETENTION_OPTION ||
    isValidCustomRetention(customRetention);
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
        action={
          <Button
            type="button"
            variant="primary"
            disabled={total !== 100 || !retentionValid}
            onClick={() => setSaved(true)}
          >
            Save demo policy
          </Button>
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
          <a className="active" href="#agent">
            Agent autonomy
          </a>
          <a href="#model">AI model</a>
          <a href="#priority">Prioritization</a>
          <a href="#data">Data & privacy</a>
          <a href="#members">Members & roles</a>
          <a href="#usage">Usage limits</a>
        </nav>
        <div className="detail-stack">
          <section className="card" id="agent">
            <div className="card-head">
              <div>
                <h2>Agent autonomy</h2>
              </div>
            </div>
            <div className="card-body">
              <div className="field">
                <span>Autonomy level</span>
                <CustomSelect
                  ariaLabel="Autonomy level"
                  value={autonomy}
                  options={[...autonomyLevels]}
                  onValueChange={(value) => {
                    setAutonomy(value as AutonomyLevel);
                    setSaved(false);
                  }}
                />
                <span className="subtle">{autonomyDescription(autonomy as AutonomyLevel)}</span>
              </div>
              <div className="callout section-gap-sm">
                <div className="callout-title">Execution boundary</div>
                <p className="subtle">
                  {autonomy === "Full autonomy" || autonomy === "Automatic coding, human merge"
                    ? "Agent codes automatically under workspace policy. A human approves every merge or deployment."
                    : autonomy === "Execute with approval"
                      ? "A human must approve the Tenki run and the commit-locked merge or deployment."
                      : "Tenki runs, merge, and deployment are blocked at this level."}
                </p>
              </div>
            </div>
          </section>
          <section className="card" id="model">
            <div className="card-head">
              <div>
                <h2>AI model</h2>
              </div>
              <span
                className={`badge ${settings.ai.configured ? "success" : "medium"}`}
              >
                {settings.ai.configured ? "Configured" : "Key required"}
              </span>
            </div>
            <div className="card-body">
              <div className="grid cols-3">
                <div>
                  <div className="metric-label">Provider</div>
                  <strong>{settings.ai.provider}</strong>
                </div>
                <div>
                  <div className="metric-label">Model</div>
                  <strong>{settings.ai.model}</strong>
                </div>
                <div>
                  <div className="metric-label">Prompt</div>
                  <strong>
                    Feedback intelligence {settings.ai.promptVersion}
                  </strong>
                </div>
              </div>
              <div
                className={`callout section-gap-sm ${settings.ai.configured ? "" : "warning"}`}
              >
                <div className="callout-title">
                  {settings.ai.configured
                    ? "Ready for governed analysis"
                    : `Add your ${settings.ai.providerLabel} key`}
                </div>
                <p className="subtle">
                  {settings.ai.configured
                    ? `${settings.ai.providerLabel} calls use strict structured outputs, no tools, provider storage disabled, PII preprocessing, and review-only cluster recommendations.`
                    : "Add the provider key in AI settings or configure the matching server environment secret, then restart the app. Credentials are read only by the server and are never returned to the browser."}
                </p>
              </div>
              {settings.ai.lastRunStatus && (
                <p className="subtle section-gap-sm">
                  Last model run: {settings.ai.lastRunStatus} ·{" "}
                  {settings.ai.lastRunAt
                    ? new Date(settings.ai.lastRunAt).toLocaleString()
                    : "time unavailable"}
                </p>
              )}
            </div>
          </section>
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
              <StatusBadge>{settings.members.length} members</StatusBadge>
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
          <section className="card" id="usage">
            <div className="card-head">
              <h2>Usage & cost limits</h2>
              <StatusBadge tone="success">Within policy</StatusBadge>
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
