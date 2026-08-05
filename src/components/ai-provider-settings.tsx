"use client";

import { KeyRound, LockKeyhole, Trash2 } from "lucide-react";
import { useState } from "react";
import type { SettingsView } from "@/lib/workspace-repository";

type ProviderId = "xai" | "openai" | "anthropic" | "openrouter";
type AiSettings = SettingsView["ai"];

const providers: Array<{
  id: ProviderId;
  label: string;
  description: string;
  defaultModel: string;
}> = [
  {
    id: "openai",
    label: "OpenAI",
    description: "Responses API",
    defaultModel: "gpt-5.6-sol",
  },
  {
    id: "xai",
    label: "xAI Grok",
    description: "Direct Grok access",
    defaultModel: "grok-4.5",
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    description: "Messages API",
    defaultModel: "claude-sonnet-4-6",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "Multi-model gateway",
    defaultModel: "openai/gpt-5.6",
  },
];

export function AiProviderSettings({
  initial,
  orgId,
  isAdmin,
}: {
  initial: AiSettings;
  orgId: string;
  isAdmin: boolean;
}) {
  const [current, setCurrent] = useState(initial);
  const [provider, setProvider] = useState<ProviderId>(initial.provider);
  const [model, setModel] = useState(initial.model);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const sameProvider = provider === current.provider;
  const canKeepStoredKey = sameProvider && current.credentialStored;

  function selectProvider(next: ProviderId) {
    setProvider(next);
    setModel(
      next === current.provider
        ? current.model
        : providers.find((item) => item.id === next)!.defaultModel,
    );
    setApiKey("");
    setNotice(null);
  }

  async function save() {
    if (!isAdmin) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/ai/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-org-id": orgId,
          "idempotency-key": `ai_config_${crypto.randomUUID().replaceAll("-", "")}`,
          "x-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify({
          provider,
          model,
          ...(apiKey ? { apiKey } : {}),
        }),
      });
      const body = (await response.json()) as Partial<AiSettings> & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          body.error ?? "The AI configuration could not be saved",
        );
      setCurrent((value) => ({ ...value, ...body }) as AiSettings);
      setApiKey("");
      setNotice({
        kind: "success",
        text: `${body.providerLabel ?? "AI provider"} saved. The credential is encrypted and will be validated on the next analysis run.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "The AI configuration could not be saved",
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeCredential() {
    if (!isAdmin) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/ai/config", {
        method: "DELETE",
        headers: {
          "x-org-id": orgId,
          "idempotency-key": `ai_remove_${crypto.randomUUID().replaceAll("-", "")}`,
          "x-request-id": crypto.randomUUID(),
        },
      });
      const body = (await response.json()) as Partial<AiSettings> & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          body.error ?? "The stored credential could not be removed",
        );
      setCurrent((value) => ({ ...value, ...body }) as AiSettings);
      setApiKey("");
      setNotice({
        kind: "success",
        text: "The workspace credential was removed. Environment-managed secrets, if present, are unchanged.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "The stored credential could not be removed",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" id="model">
      <div className="card-head">
        <div>
          <h2>AI provider</h2>
          <p className="subtle">
            Choose a provider and keep its credential server-side
          </p>
        </div>
        <span className={`badge ${current.configured ? "success" : "medium"}`}>
          {current.configured ? "Configured" : "Key required"}
        </span>
      </div>
      <div className="card-body">
        {!isAdmin && (
          <div className="callout section-gap-sm">
            <div className="callout-title">Admin-managed credentials</div>
            <p className="subtle">
              Provider configuration is visible for transparency. Ask a
              workspace admin to change the model or stored key.
            </p>
          </div>
        )}
        <fieldset className="provider-picker" disabled={!isAdmin}>
          <legend>Provider</legend>
          {providers.map((item) => (
            <button
              type="button"
              className={`provider-option ${provider === item.id ? "selected" : ""}`}
              aria-pressed={provider === item.id}
              onClick={() => selectProvider(item.id)}
              key={item.id}
            >
              <span className="provider-monogram">
                {item.label.slice(0, 1)}
              </span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
            </button>
          ))}
        </fieldset>
        <div className="ai-config-fields section-gap-sm">
          <label className="field">
            Model ID
            <input
              value={model}
              disabled={!isAdmin}
              onChange={(event) => setModel(event.target.value)}
              autoComplete="off"
              spellCheck="false"
              placeholder={
                providers.find((item) => item.id === provider)?.defaultModel
              }
            />
            <small>
              Editable so you can use a model available to your provider
              account.
            </small>
          </label>
          <label className="field">
            API key
            <div className="secret-input">
              <KeyRound size={17} aria-hidden="true" />
              <input
                type="password"
                value={apiKey}
                disabled={!isAdmin}
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="new-password"
                placeholder={
                  canKeepStoredKey
                    ? `Leave blank to keep ${current.keyHint ?? "stored key"}`
                    : "Paste provider API key"
                }
              />
            </div>
            <small>
              {canKeepStoredKey
                ? `${current.keyHint} is stored. Enter a new key only to replace it.`
                : "The raw key is sent once to the server and is never returned."}
            </small>
          </label>
        </div>
        {!current.vaultConfigured && (
          <div className="callout warning section-gap-sm">
            <div className="callout-title">
              <LockKeyhole size={14} /> Initialize the credential vault
            </div>
            <p className="subtle">
              Add a 32-byte base64 or 64-character hex{" "}
              <code>AI_CREDENTIAL_ENCRYPTION_KEY</code> to the server
              environment and restart before saving provider keys. Production
              deployments should source it from KMS or Secrets Manager.
            </p>
          </div>
        )}
        {current.keySource === "environment" && (
          <div className="callout section-gap-sm">
            <div className="callout-title">Environment-managed credential</div>
            <p className="subtle">
              The current key comes from the server environment. Enter a key
              above to move this workspace to encrypted database storage.
            </p>
          </div>
        )}
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
              busy ||
              !isAdmin ||
              !model.trim() ||
              !current.vaultConfigured ||
              (!apiKey && !canKeepStoredKey)
            }
            onClick={save}
          >
            {busy ? "Saving…" : "Save provider"}
          </button>
          {current.credentialStored && (
            <button
              type="button"
              className="btn danger"
              disabled={busy || !isAdmin}
              onClick={removeCredential}
            >
              <Trash2 size={14} /> Remove stored key
            </button>
          )}
        </div>
        <div className="ai-security-note section-gap-sm">
          <LockKeyhole size={15} />
          <p>
            <strong>Security boundary</strong>
            <span>
              Keys use AES-256-GCM encryption with organization and provider
              binding. Feedback is redacted before inference, structured output
              is validated, tools are disabled, and cluster changes still
              require human review.
            </span>
          </p>
        </div>
        <div className="ai-config-meta section-gap-sm">
          <span>
            Active: <strong>{current.providerLabel}</strong>
          </span>
          <span>
            Model: <strong>{current.model}</strong>
          </span>
          <span>
            Prompt:{" "}
            <strong>Feedback intelligence {current.promptVersion}</strong>
          </span>
          {current.lastRunStatus && (
            <span>
              Last run: <strong>{current.lastRunStatus}</strong>
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
