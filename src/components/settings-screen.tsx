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
import { CreateosSandboxCheck } from "./createos-sandbox-check";
import { TenkiSandboxCheck } from "./tenki-sandbox-check";
import { ExecutionProfileSettings } from "./execution-profile-settings";
import {
  autonomyCapabilities,
  autonomyDescription,
  autonomyLevels,
  type AutonomyLevel,
} from "@/lib/autonomy-policy";
import type { PromptEvaluationMode } from "@/lib/prompt-evaluation-policy";
import { PROMPT_DRAFT_MINIMUM_REPORTS, resolvePromptDraftReviewer } from "@/lib/prompt-draft-policy";
import { useWorkspaceChrome } from "./workspace-chrome";
import { workspacePolicyDraftKey } from "@/lib/workspace-policy-draft";
import type { WorkspacePolicyInput } from "@/lib/workspace-settings-repository";

export function SettingsScreen({
  settings,
  orgId,
  userRole,
  tenkiConfigured,
  createosConfigured,
  promptEmailConfigured,
  orchestration,
}: {
  settings: SettingsView;
  orgId: string;
  userRole: string;
  tenkiConfigured: boolean;
  createosConfigured: boolean;
  promptEmailConfigured: boolean;
  orchestration: OrchestrationProviderPublicConfiguration;
}) {
  const [weights, setWeights] = useState<Record<string, number>>(
    settings.priorityWeights,
  );
  const [autonomy, setAutonomy] = useState(settings.autonomyLevel);
  const [automaticCodingConfirmed, setAutomaticCodingConfirmed] = useState(
    autonomyCapabilities(settings.autonomyLevel).automaticallyAuthorizeExecution,
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
    () => ({ ...settings.promptDraftPolicy, minimumEvidence: PROMPT_DRAFT_MINIMUM_REPORTS, reviewerId: resolvePromptDraftReviewer(settings.promptDraftPolicy.reviewerId, settings.members) }),
  );
  const [promptEvaluationMode, setPromptEvaluationMode] = useState(
    settings.promptEvaluationMode,
  );
  const { setPrimaryAction, clearPrimaryAction } = useWorkspaceChrome();
  const policyDraft: WorkspacePolicyInput = {
    autonomyLevel: autonomy,
    piiRedaction: pii,
    retentionDays: retentionDays(),
    priorityWeights: weights,
    promptDraftPolicy,
    promptEvaluationMode,
  };
  const policyDraftKey = workspacePolicyDraftKey(policyDraft);
  const [savedPolicyKey, setSavedPolicyKey] = useState(policyDraftKey);
  const hasUnsavedChanges = policyDraftKey !== savedPolicyKey;
  const saveInFlightRef = useRef(false);
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const retentionValid =
    retention !== CUSTOM_RETENTION_OPTION ||
    isValidCustomRetention(customRetention);
  const isAdmin = userRole === "Admin";
  const policyInputsDisabled = !isAdmin || saving;
  const localEvaluationReady = settings.ai.configured;
  const saveDisabledReason =
    !isAdmin
      ? "Only workspace admins can change policy."
      : total !== 100
        ? "Prioritization weights must total 100%."
        : !retentionValid
          ? "Enter a valid feedback-retention period."
          : autonomyCapabilities(autonomy).automaticallyAuthorizeExecution && !automaticCodingConfirmed
            ? "Confirm automatic coding within approved repositories and workspace budget checks before saving."
            : promptEvaluationMode === "pdd_local" && !localEvaluationReady
              ? "Configure a workspace AI provider before selecting local Prompt Driven evaluation."
              : !hasUnsavedChanges
                ? "No unsaved changes."
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
    if (saveDisabledReason || saveInFlightRef.current) return;
    saveInFlightRef.current = true;
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
        body: JSON.stringify(policyDraft),
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
      setSavedPolicyKey(workspacePolicyDraftKey({ ...policyDraft, ...payload.policy }));
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Workspace policy could not be saved.");
    } finally {
      saveInFlightRef.current = false;
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
        title="Settings"
      />
      {saved && (
        <p className="toast success" role="status">
          Policy saved.
        </p>
      )}
      {saveError && <p className="toast error" role="alert">{saveError}</p>}
      {!isAdmin && (
        <div className="callout settings-read-only" role="status">
          <div className="callout-title">Read-only settings</div>
        </div>
      )}
      <div className="settings-layout">
        <div className="detail-stack settings-detail-stack">
          <section className="card" id="agent">
            <div className="card-head">
              <div>
                <h2>Automation</h2>
              </div>
            </div>
            <div className="card-body">
              <div className="field">
                <span>Autonomy level</span>
                <CustomSelect
                  ariaLabel="Autonomy level"
                  value={autonomy}
                  options={autonomyLevels.filter((level) => level !== "Full autonomy" || settings.autonomyLevel === "Full autonomy")}
                  disabled={policyInputsDisabled}
                  onValueChange={(value) => {
                    setAutonomy(value as AutonomyLevel);
                    if (autonomyCapabilities(value as AutonomyLevel).automaticallyAuthorizeExecution) {
                      setAutomaticCodingConfirmed(false);
                      setPromptDraftPolicy((current) => ({ ...current, mode: "automatic" }));
                    } else {
                      setAutomaticCodingConfirmed(true);
                    }
                    setSaved(false);
                  }}
                />
              </div>
              <p className="subtle">{autonomyDescription(autonomy)}</p>
              {autonomyCapabilities(autonomy).automaticallyAuthorizeExecution ? (
                <div className="callout section-gap-sm">
                  <div className="callout-title">Agent codes automatically. You approve merges.</div>
                  <label className="toggle-row section-gap-xs">
                    <div>
                      <strong>I authorize automatic coding in approved repositories with workspace budget checks</strong>
                      {autonomy === "Automatic coding, human merge" ? <p className="subtle">New work can start after this policy is saved. Existing pending work keeps its approval requirement.</p> : null}
                      <p className="subtle">Budget checks use recorded usage. Provider and in-flight costs may be missing; this is not a guaranteed billing cap.</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={automaticCodingConfirmed}
                      disabled={policyInputsDisabled}
                      onChange={(event) => {
                        setAutomaticCodingConfirmed(event.target.checked);
                        setSaved(false);
                      }}
                    />
                  </label>
                </div>
              ) : null}
            </div>
          </section>
          <section className="card" id="prompt-drafts">
            <div className="card-head">
              <div>
                <h2>Prompt drafting</h2>
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
                  disabled={policyInputsDisabled}
                  onValueChange={(mode) => {
                    setPromptDraftPolicy((value) => ({ ...value, mode: mode as "manual" | "automatic" }));
                    setSaved(false);
                  }}
                />
              </div>
              <label className="toggle-row section-gap-sm">
                <div><strong>Bug reports</strong></div>
                <input type="checkbox" checked={promptDraftPolicy.bugReports} disabled={policyInputsDisabled || promptDraftPolicy.mode !== "automatic"} onChange={(event) => { setPromptDraftPolicy((value) => ({ ...value, bugReports: event.target.checked })); setSaved(false); }} />
              </label>
              <label className="toggle-row">
                <div><strong>Feature requests</strong></div>
                <input type="checkbox" checked={promptDraftPolicy.featureRequests} disabled={policyInputsDisabled || promptDraftPolicy.mode !== "automatic"} onChange={(event) => { setPromptDraftPolicy((value) => ({ ...value, featureRequests: event.target.checked })); setSaved(false); }} />
              </label>
              <div className="toggle-row">
                <span>Minimum reports</span>
                <strong>{promptDraftPolicy.minimumEvidence}</strong>
              </div>
              <label className="weight-row">
                <span>Confidence</span>
                <input type="range" min="50" max="100" step="5" value={Math.round(promptDraftPolicy.minimumConfidence * 100)} disabled={policyInputsDisabled || promptDraftPolicy.mode !== "automatic"} onChange={(event) => { setPromptDraftPolicy((value) => ({ ...value, minimumConfidence: Number(event.target.value) / 100 })); setSaved(false); }} />
                <strong>{Math.round(promptDraftPolicy.minimumConfidence * 100)}%</strong>
              </label>
              <div className="field section-gap-sm">
                <span>Assigned reviewer</span>
                <CustomSelect
                  ariaLabel="Prompt draft reviewer"
                  disabled={policyInputsDisabled || promptDraftPolicy.mode !== "automatic"}
                  value={promptDraftPolicy.reviewerId ?? ""}
                  options={[
                    ...(!resolvePromptDraftReviewer(null, settings.members) ? [{ label: "Unassigned", value: "" }] : []),
                    ...settings.members.map((member) => ({ label: `${member.name} · ${member.role}`, value: member.id })),
                  ]}
                  onValueChange={(reviewerId) => { setPromptDraftPolicy((value) => ({ ...value, reviewerId: reviewerId || null })); setSaved(false); }}
                />
              </div>
              <label className="toggle-row section-gap-sm">
                <div><strong>In-app notification</strong></div>
                <input type="checkbox" checked={promptDraftPolicy.inAppNotifications} disabled={policyInputsDisabled || promptDraftPolicy.mode !== "automatic" || !promptDraftPolicy.reviewerId} onChange={(event) => { setPromptDraftPolicy((value) => ({ ...value, inAppNotifications: event.target.checked })); setSaved(false); }} />
              </label>
              <label className="toggle-row">
                <div><strong>Email alert</strong></div>
                <input type="checkbox" checked={promptDraftPolicy.emailNotifications} disabled={policyInputsDisabled || promptDraftPolicy.mode !== "automatic" || !promptDraftPolicy.reviewerId} onChange={(event) => { setPromptDraftPolicy((value) => ({ ...value, emailNotifications: event.target.checked })); setSaved(false); }} />
              </label>
              {promptDraftPolicy.emailNotifications && !promptEmailConfigured && (
                <div className="callout warning" role="status">
                  <div className="callout-title">Email delivery needs configuration</div>
                  <p className="subtle">Configure email delivery to send queued alerts.</p>
                </div>
              )}
            </div>
          </section>
          <section className="card" id="prompt-evaluation">
            <div className="card-head">
              <div>
                <h2>Prompt evaluation</h2>
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
                  disabled={policyInputsDisabled}
                  onValueChange={(mode) => {
                    setPromptEvaluationMode(mode as PromptEvaluationMode);
                    setSaved(false);
                  }}
                />
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
                {!localEvaluationReady && <p className="subtle">Add an AI provider to enable local evaluation.</p>}
              </div>
            </div>
          </section>
          <section className="card" id="execution">
            <div className="card-head">
              <div>
                <h2>Execution environments</h2>
              </div>
              <span className="badge brand">Approval-bound</span>
            </div>
            <div className="card-body">
              <ExecutionProfileSettings orgId={orgId} isAdmin={isAdmin} />
              <TenkiSandboxCheck
                orgId={orgId}
                configured={tenkiConfigured}
                isAdmin={isAdmin}
              />
              <CreateosSandboxCheck
                orgId={orgId}
                configured={createosConfigured}
                isAdmin={isAdmin}
              />
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
                    disabled={policyInputsDisabled}
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
                </div>
                <input
                  type="checkbox"
                  checked={pii}
                  disabled={policyInputsDisabled}
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
                  disabled={policyInputsDisabled}
                  onValueChange={(value) => {
                    setRetention(value);
                    setSaved(false);
                  }}
                />
                <CustomRetentionInput
                  open={retention === CUSTOM_RETENTION_OPTION}
                  value={customRetention}
                  disabled={policyInputsDisabled}
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
