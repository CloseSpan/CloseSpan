"use client";

import { useEffect, useRef, useState } from "react";
import type { SettingsView } from "@/lib/workspace-repository";
import { AiProviderSettings } from "./ai-provider-settings";
import { OrchestrationProviderSettings } from "./orchestration-provider-settings";
import type { OrchestrationProviderPublicConfiguration } from "@/lib/orchestration-provider-repository";
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
import { ExecutionProfileSettings } from "./execution-profile-settings";
import {
  autonomyDescription,
  autonomyLevels,
  type AutonomyLevel,
} from "@/lib/autonomy-policy";
import type { PromptEvaluationMode } from "@/lib/prompt-evaluation-policy";
import { useWorkspaceChrome } from "./workspace-chrome";

export function SettingsScreen({
  settings,
  orgId,
  userRole,
  tenkiConfigured,
  promptEmailConfigured,
  orchestration,
}: {
  settings: SettingsView;
  orgId: string;
  userRole: string;
  tenkiConfigured: boolean;
  promptEmailConfigured: boolean;
  orchestration: OrchestrationProviderPublicConfiguration;
}) {
  const [weights, setWeights] = useState<Record<string, number>>(
    settings.priorityWeights,
  );
  const [autonomy, setAutonomy] = useState(settings.autonomyLevel);
  const [fullAutonomyConfirmed, setFullAutonomyConfirmed] = useState(
    settings.autonomyLevel === "Full autonomy",
  );
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
  const [promptEvaluationMode, setPromptEvaluationMode] = useState(
    settings.promptEvaluationMode,
  );
  const { setPrimaryAction, clearPrimaryAction } = useWorkspaceChrome();
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const retentionValid =
    retention !== CUSTOM_RETENTION_OPTION ||
    isValidCustomRetention(customRetention);
  const isAdmin = userRole === "Admin";
  const localEvaluationReady = settings.ai.configured;
  const saveDisabledReason =
    !isAdmin
      ? "Only workspace admins can change policy."
      : total !== 100
        ? "Prioritization weights must total 100%."
        : !retentionValid
          ? "Enter a valid feedback-retention period."
          : autonomy === "Full autonomy" && !fullAutonomyConfirmed
            ? "Confirm the full-autonomy execution policy before saving."
          : promptEvaluationMode === "pdd_local" && !localEvaluationReady
            ? "Configure a workspace AI provider before selecting local Prompt Driven evaluation."
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
    if (!isAdmin) return;
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
          promptEvaluationMode,
        }),
      });
      const payload = await response.json() as {
        error?: string;
        policy?: {
          promptDraftPolicy?: typeof promptDraftPolicy;
          promptEvaluationMode?: PromptEvaluationMode;
        };
      };
      if (!response.ok) throw new Error(payload.error ?? "Workspace policy could not be saved.");
      if (payload.policy?.promptDraftPolicy) setPromptDraftPolicy(payload.policy.promptDraftPolicy);
      if (payload.policy?.promptEvaluationMode) {
        setPromptEvaluationMode(payload.policy.promptEvaluationMode);
      }
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Workspace policy could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const savePolicyRef = useRef(savePolicy);
  useEffect(() => {
    savePolicyRef.current = savePolicy;
  });
  useEffect(() => {
    setPrimaryAction({
      id: "settings-save-policy",
      label: "Save policy",
      pendingLabel: "Saving…",
      pending: saving,
      disabled: Boolean(saveDisabledReason),
      disabledReason: saveDisabledReason,
      onTrigger: () => void savePolicyRef.current(),
    });
  }, [saveDisabledReason, saving, setPrimaryAction]);
  useEffect(
    () => () => clearPrimaryAction("settings-save-policy"),
    [clearPrimaryAction],
  );

  return (
    <>
      <PageTitle
        title="Settings & governance"
        description="Define permissions, data controls, model policies, and spending boundaries."
      />
      {saved && (
        <p className="toast success" role="status">
          Workspace policy saved. New grouped reports will follow these prompt-drafting rules.
        </p>
      )}
      {saveError && <p className="toast error" role="alert">{saveError}</p>}
      {!isAdmin && (
        <div className="callout settings-read-only" role="status">
          <div className="callout-title">Read-only settings</div>
          <p className="subtle">
            You can review workspace policy, but only an admin can change it or
            update provider credentials.
          </p>
        </div>
      )}
      <div className="settings-layout">
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
                  options={[...autonomyLevels]}
                  disabled={!isAdmin}
                  onValueChange={(value) => {
                    setAutonomy(value as AutonomyLevel);
                    if (value === "Full autonomy") {
                      setFullAutonomyConfirmed(false);
                      setPromptDraftPolicy((current) => ({ ...current, mode: "automatic" }));
                    } else {
                      setFullAutonomyConfirmed(true);
                    }
                    setSaved(false);
                  }}
                />
                <span className="subtle">
                  {autonomyDescription(autonomy as AutonomyLevel)}
                </span>
              </div>
              {autonomy === "Full autonomy" ? (
                <div className="callout warning section-gap-sm">
                  <div className="callout-title">End-to-end execution enabled</div>
                  <p className="subtle">
                    CloseSpan will automatically authorize immutable agent and final-execution records,
                    then use the configured repository, Tenki profile, deployment path, rollback plan,
                    and production verification checks. Scope, secrets, paths, commands, and SHA locks remain enforced.
                  </p>
                  <label className="toggle-row section-gap-xs">
                    <div>
                      <strong>I understand this permits automatic merge or deployment</strong>
                      <p className="subtle">Required once when switching this workspace to Full autonomy.</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={fullAutonomyConfirmed}
                      disabled={!isAdmin}
                      onChange={(event) => {
                        setFullAutonomyConfirmed(event.target.checked);
                        setSaved(false);
                      }}
                    />
                  </label>
                </div>
              ) : (
                <div className="callout section-gap-sm">
                  <div className="callout-title">Execution boundary</div>
                  <p className="subtle">
                    {autonomy === "Execute with approval"
                      ? "A human must approve the immutable Tenki run and the commit-locked merge or deployment."
                      : "Tenki agent runs, pull-request merge, and production deployment are blocked at this level."}
                  </p>
                </div>
              )}
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
                  disabled={!isAdmin}
                  onValueChange={(mode) => {
                    setPromptDraftPolicy((value) => ({ ...value, mode: mode as "manual" | "automatic" }));
                    setSaved(false);
                  }}
                />
              </div>
              <div className="callout section-gap-sm">
                <div className="callout-title">Drafts cannot execute code</div>
                <p className="subtle">
                  {autonomy === "Full autonomy"
                    ? "Full autonomy evaluates and revises the prompt, generates the Prompt Testing contract, and advances the immutable workflow automatically."
                    : "A product manager reviews the Prompt Testing result before any isolated Tenki run. Execution follows the autonomy boundary above."}
                </p>
              </div>
              <label className="toggle-row section-gap-sm">
                <div><strong>Bug and incident reports</strong><p className="subtle">Draft a suggested fix after the evidence threshold is met.</p></div>
                <input type="checkbox" checked={promptDraftPolicy.bugReports} disabled={!isAdmin || promptDraftPolicy.mode !== "automatic"} onChange={(event) => { setPromptDraftPolicy((value) => ({ ...value, bugReports: event.target.checked })); setSaved(false); }} />
              </label>
              <label className="toggle-row">
                <div><strong>Feature requests</strong><p className="subtle">Draft a product-change prompt from a grouped request.</p></div>
                <input type="checkbox" checked={promptDraftPolicy.featureRequests} disabled={!isAdmin || promptDraftPolicy.mode !== "automatic"} onChange={(event) => { setPromptDraftPolicy((value) => ({ ...value, featureRequests: event.target.checked })); setSaved(false); }} />
              </label>
              <label className="weight-row">
                <span>Minimum reports</span>
                <input type="range" min="1" max="20" value={promptDraftPolicy.minimumEvidence} disabled={!isAdmin || promptDraftPolicy.mode !== "automatic"} onChange={(event) => { setPromptDraftPolicy((value) => ({ ...value, minimumEvidence: Number(event.target.value) })); setSaved(false); }} />
                <strong>{promptDraftPolicy.minimumEvidence}</strong>
              </label>
              <label className="weight-row">
                <span>Confidence</span>
                <input type="range" min="50" max="100" step="5" value={Math.round(promptDraftPolicy.minimumConfidence * 100)} disabled={!isAdmin || promptDraftPolicy.mode !== "automatic"} onChange={(event) => { setPromptDraftPolicy((value) => ({ ...value, minimumConfidence: Number(event.target.value) / 100 })); setSaved(false); }} />
                <strong>{Math.round(promptDraftPolicy.minimumConfidence * 100)}%</strong>
              </label>
              <div className="field section-gap-sm">
                <span>Assigned reviewer</span>
                <CustomSelect
                  ariaLabel="Prompt draft reviewer"
                  disabled={!isAdmin || promptDraftPolicy.mode !== "automatic"}
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
                <input type="checkbox" checked={promptDraftPolicy.inAppNotifications} disabled={!isAdmin || promptDraftPolicy.mode !== "automatic" || !promptDraftPolicy.reviewerId} onChange={(event) => { setPromptDraftPolicy((value) => ({ ...value, inAppNotifications: event.target.checked })); setSaved(false); }} />
              </label>
              <label className="toggle-row">
                <div><strong>Email alert</strong><p className="subtle">Email the assigned reviewer when the prompt draft is ready.</p></div>
                <input type="checkbox" checked={promptDraftPolicy.emailNotifications} disabled={!isAdmin || promptDraftPolicy.mode !== "automatic" || !promptDraftPolicy.reviewerId} onChange={(event) => { setPromptDraftPolicy((value) => ({ ...value, emailNotifications: event.target.checked })); setSaved(false); }} />
              </label>
              {promptDraftPolicy.emailNotifications && !promptEmailConfigured && (
                <div className="callout warning" role="status">
                  <div className="callout-title">Email delivery needs configuration</div>
                  <p className="subtle">The preference will be saved and alerts will remain safely queued until Cloudflare Email Service credentials and a verified sender are configured.</p>
                </div>
              )}
            </div>
          </section>
          <section className="card" id="prompt-evaluation">
            <div className="card-head">
              <div>
                <h2>Prompt evaluation</h2>
                <p className="subtle">
                  Choose where Prompt Driven evaluates new immutable .prompt revisions.
                </p>
              </div>
              <span className="badge brand">Organization policy</span>
            </div>
            <div className="card-body">
              <div className="field">
                <span>Evaluation engine</span>
                <CustomSelect
                  ariaLabel="Prompt evaluation engine"
                  value={promptEvaluationMode}
                  options={[
                    { label: "Prompt Testing Cloud", value: "pdd_cloud" },
                    { label: "Local Prompt Driven CLI", value: "pdd_local" },
                    {
                      label: "Prompt Testing Cloud + local fallback",
                      value: "pdd_cloud_with_local_fallback",
                    },
                  ]}
                  disabled={!isAdmin}
                  onValueChange={(mode) => {
                    setPromptEvaluationMode(mode as PromptEvaluationMode);
                    setSaved(false);
                  }}
                />
                <span className="subtle">
                  {promptEvaluationMode === "pdd_cloud"
                    ? "Prompt Testing Cloud creates the contract and evaluates the immutable revision. Your workspace AI credential is never sent to Prompt Testing Cloud."
                    : promptEvaluationMode === "pdd_local"
                      ? `${settings.ai.providerLabel} ${settings.ai.model} powers this workspace's isolated pdd --local job. The credential is held only for that evaluation and is not stored by the runner.`
                      : "Prompt Testing Cloud runs first without your workspace credential. If Cloud is unavailable, the same immutable revision retries once through an isolated local CLI job using the workspace AI provider."}
                </span>
              </div>
              <div
                className={`callout section-gap-sm ${localEvaluationReady ? "" : "warning"}`}
                role="status"
              >
                <div className="callout-title">
                  {localEvaluationReady
                    ? `Local engine ready · ${settings.ai.providerLabel}`
                    : "Local engine needs an AI provider"}
                </div>
                <p className="subtle">
                  {localEvaluationReady
                    ? `${settings.ai.model} is available for local Prompt Driven evaluations and Cloud fallback.`
                    : "Add a workspace model and credential under AI provider. Prompt Testing Cloud remains available, but local mode and local fallback cannot run without it."}
                </p>
              </div>
              <div className="callout section-gap-sm">
                <div className="callout-title">Applies to new evaluations</div>
                <p className="subtle">
                  Running and completed evaluations remain bound to the engine that started them.
                  Repository execution and Tenki verification keep their existing approval boundaries.
                </p>
              </div>
            </div>
          </section>
          <section className="card" id="execution">
            <div className="card-head">
              <div>
                <h2>Repository execution environments</h2>
                <p className="subtle">Detect, review, and version the exact environment used by Prompt Testing and both Tenki VMs. Advanced staging credentials are managed here when a running application requires them.</p>
              </div>
              <span className="badge brand">Approval-bound</span>
            </div>
            <div className="card-body">
              <ExecutionProfileSettings orgId={orgId} isAdmin={isAdmin} />
            </div>
          </section>
          <OrchestrationProviderSettings
            initial={orchestration}
            orgId={orgId}
            isAdmin={isAdmin}
          />
          <AiProviderSettings initial={settings.ai} orgId={orgId} isAdmin={isAdmin} />
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
                    disabled={!isAdmin}
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
                  disabled={!isAdmin}
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
                  disabled={!isAdmin}
                  onValueChange={(value) => {
                    setRetention(value);
                    setSaved(false);
                  }}
                />
                <CustomRetentionInput
                  open={retention === CUSTOM_RETENTION_OPTION}
                  value={customRetention}
                  disabled={!isAdmin}
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
