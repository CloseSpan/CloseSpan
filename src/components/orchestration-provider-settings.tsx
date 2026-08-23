"use client";

import { KeyRound, LockKeyhole, Network, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type {
  OrchestrationProvider,
  OrchestrationProviderPublicConfiguration,
} from "@/lib/orchestration-provider-repository";

const providers: Array<{
  id: OrchestrationProvider;
  label: string;
  description: string;
}> = [
  {
    id: "pipedream",
    label: "Pipedream",
    description: "Current managed connector workflows",
  },
  {
    id: "n8n",
    label: "n8n",
    description: "Self-hosted or n8n Cloud workflows",
  },
];

export function OrchestrationProviderSettings({
  initial,
  orgId,
  isAdmin,
}: {
  initial: OrchestrationProviderPublicConfiguration;
  orgId: string;
  isAdmin: boolean;
}) {
  const [current, setCurrent] = useState(initial);
  const [provider, setProvider] = useState<OrchestrationProvider>(
    initial.activeProvider,
  );
  const [baseUrl, setBaseUrl] = useState(initial.n8n.baseUrl);
  const [triggerUrl, setTriggerUrl] = useState(initial.n8n.triggerUrl);
  const [apiKey, setApiKey] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const hasApiKey = Boolean(apiKey || current.n8n.apiKeySource !== "none");
  const hasSigningSecret = Boolean(
    signingSecret || current.n8n.signingSecretSource !== "none",
  );
  const needsVaultForNewSecret = Boolean(
    (apiKey || signingSecret) && !current.vaultConfigured,
  );
  const n8nFormComplete = Boolean(
    baseUrl.trim()
      && triggerUrl.trim()
      && hasApiKey
      && hasSigningSecret
      && !needsVaultForNewSecret,
  );
  const n8nChanged = Boolean(
    baseUrl.trim() !== current.n8n.baseUrl
      || triggerUrl.trim() !== current.n8n.triggerUrl
      || apiKey
      || signingSecret,
  );
  const selectionUnchanged = provider === current.activeProvider
    && !(provider === "n8n" && n8nChanged);

  async function activate(): Promise<void> {
    if (!isAdmin) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/settings/orchestration", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-org-id": orgId,
          "idempotency-key": `orchestration_${crypto.randomUUID().replaceAll("-", "")}`,
          "x-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify({
          activeProvider: provider,
          ...(provider === "n8n"
            ? {
                baseUrl,
                triggerUrl,
                ...(apiKey ? { apiKey } : {}),
                ...(signingSecret ? { signingSecret } : {}),
              }
            : {}),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as
        Partial<OrchestrationProviderPublicConfiguration> & { error?: string };
      if (!response.ok) {
        throw new Error(
          payload.error ?? "The orchestration provider could not be activated.",
        );
      }
      const next = payload as OrchestrationProviderPublicConfiguration;
      setCurrent(next);
      setProvider(next.activeProvider);
      setBaseUrl(next.n8n.baseUrl);
      setTriggerUrl(next.n8n.triggerUrl);
      setApiKey("");
      setSigningSecret("");
      setNotice({
        kind: "success",
        text: next.activeProvider === "n8n"
          ? "n8n is verified and active. New connected-source pull requests will use the configured n8n workflow."
          : "Pipedream is active. Your n8n configuration remains stored and can be restored without reconnecting.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error
          ? error.message
          : "The orchestration provider could not be activated.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" id="orchestration">
      <div className="card-head">
        <div>
          <h2>Workflow orchestration</h2>
          <p className="subtle">
            Choose which service handles new connected-source workflow runs.
          </p>
        </div>
        <span className="badge success">{current.providerLabel} active</span>
      </div>
      <div className="card-body">
        {!isAdmin && (
          <div className="callout section-gap-sm">
            <div className="callout-title">Admin-managed routing</div>
            <p className="subtle">
              You can review the active provider, but only a workspace admin can
              change workflow routing or n8n credentials.
            </p>
          </div>
        )}
        <fieldset className="provider-picker" disabled={!isAdmin || busy}>
          <legend>Orchestration provider</legend>
          {providers.map((item) => (
            <button
              type="button"
              className={`provider-option ${provider === item.id ? "selected" : ""}`}
              aria-pressed={provider === item.id}
              onClick={() => {
                setProvider(item.id);
                setNotice(null);
              }}
              key={item.id}
            >
              <span className="provider-monogram" aria-hidden="true">
                {item.id === "n8n" ? <Network size={18} /> : "P"}
              </span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
            </button>
          ))}
        </fieldset>

        {provider === "n8n" && (
          <>
            <div className="ai-config-fields section-gap-sm">
              <label className="field">
                n8n base URL
                <input
                  type="url"
                  value={baseUrl}
                  disabled={!isAdmin || busy}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  autoComplete="url"
                  placeholder="https://your-workspace.app.n8n.cloud"
                />
                <small>Used only to verify the n8n API connection.</small>
              </label>
              <label className="field">
                Production webhook URL
                <input
                  type="url"
                  value={triggerUrl}
                  disabled={!isAdmin || busy}
                  onChange={(event) => setTriggerUrl(event.target.value)}
                  autoComplete="off"
                  placeholder="https://your-workspace.app.n8n.cloud/webhook/closespan"
                />
                <small>CloseSpan posts signed collection requests here.</small>
              </label>
              <label className="field">
                n8n API key
                <div className="secret-input">
                  <KeyRound size={17} aria-hidden="true" />
                  <input
                    type="password"
                    value={apiKey}
                    disabled={!isAdmin || busy}
                    onChange={(event) => setApiKey(event.target.value)}
                    autoComplete="new-password"
                    placeholder={current.n8n.apiKeyHint
                      ? `Leave blank to keep ${current.n8n.apiKeyHint}`
                      : "Paste n8n API key"}
                  />
                </div>
                <small>
                  Sent only to your n8n API during the connection test.
                </small>
              </label>
              <label className="field">
                Webhook signing secret
                <div className="secret-input">
                  <ShieldCheck size={17} aria-hidden="true" />
                  <input
                    type="password"
                    value={signingSecret}
                    disabled={!isAdmin || busy}
                    onChange={(event) => setSigningSecret(event.target.value)}
                    autoComplete="new-password"
                    placeholder={current.n8n.signingSecretHint
                      ? `Leave blank to keep ${current.n8n.signingSecretHint}`
                      : "Create a long random signing secret"}
                  />
                </div>
                <small>Verify this signature inside the n8n workflow.</small>
              </label>
            </div>

            {!current.vaultConfigured && (apiKey || signingSecret) && (
              <div className="callout warning section-gap-sm" role="status">
                <div className="callout-title">
                  <LockKeyhole size={14} /> Initialize the credential vault
                </div>
                <p className="subtle">
                  Add <code>AI_CREDENTIAL_ENCRYPTION_KEY</code> to the server
                  before storing n8n secrets. Environment-managed n8n secrets
                  remain available without copying them into the database.
                </p>
              </div>
            )}
            <div className="callout section-gap-sm">
              <div className="callout-title">n8n workflow contract</div>
              <p className="subtle">
                The workflow receives a signed collection request, reads the
                selected source, and sends normalized records to a CloseSpan
                Custom webhook. Keep the webhook response enabled so CloseSpan
                can confirm the run was accepted.
              </p>
            </div>
          </>
        )}

        <div className="callout section-gap-sm">
          <div className="callout-title">Switch safely at any time</div>
          <p className="subtle">
            Changing providers does not remove Pipedream accounts, n8n
            credentials, imported feedback, or source history. It only changes
            which provider handles the next orchestration request.
          </p>
        </div>

        {notice && (
          <p
            className={`toast ${notice.kind}`}
            role={notice.kind === "error" ? "alert" : "status"}
          >
            {notice.text}
          </p>
        )}
        <div className="ai-config-actions section-gap-sm">
          <button
            type="button"
            className="btn primary"
            disabled={
              busy
              || !isAdmin
              || selectionUnchanged
              || (provider === "n8n" && !n8nFormComplete)
            }
            onClick={() => void activate()}
          >
            {busy
              ? provider === "n8n" ? "Verifying n8n…" : "Switching…"
              : provider === "n8n" && current.activeProvider === "n8n"
                ? "Reverify & save n8n"
                : provider === "n8n" ? "Verify & use n8n" : "Use Pipedream"}
          </button>
          {selectionUnchanged && (
            <span className="subtle" role="status">
              {current.providerLabel} is already active for this workspace.
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
