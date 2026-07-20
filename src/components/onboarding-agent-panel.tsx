"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  Copy,
  LoaderCircle,
  PlugZap,
  Sparkles,
} from "lucide-react";
import type { OnboardingAction } from "@/lib/onboarding-agent";
import type {
  OnboardingPhase,
  OnboardingState,
} from "@/lib/onboarding-repository";

const PHASES: Array<{ id: OnboardingPhase; label: string }> = [
  { id: "discover", label: "Brief" },
  { id: "connect", label: "Connect intake" },
  { id: "verify", label: "Verify signal" },
  { id: "complete", label: "Operate" },
];

const STARTER_CHIPS = [
  "B2B analytics SaaS for enterprise teams",
  "Consumer iOS + Android fitness app",
  "Developer API platform at https://example.com",
  "Marketplace connecting buyers and sellers",
];

const FRIENDLY_ERROR =
  "Something went wrong. Please try again in a moment.";

function isSafeUserMessage(message: string): boolean {
  return (
    message === FRIENDLY_ERROR ||
    message === "Message is required" ||
    message === "Authentication required" ||
    message === "Too many requests"
  );
}

async function onboardingFetch(
  orgId: string,
  method: "GET" | "POST",
  message?: string,
) {
  const response = await fetch("/api/onboarding", {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-org-id": orgId,
      "idempotency-key": crypto.randomUUID(),
      "x-request-id": crypto.randomUUID(),
    },
    body: message ? JSON.stringify({ message }) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const raw =
      typeof payload.error === "string" ? payload.error : FRIENDLY_ERROR;
    throw new Error(isSafeUserMessage(raw) ? raw : FRIENDLY_ERROR);
  }
  return payload;
}

async function integrationFetch(path: string, orgId: string) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-org-id": orgId,
      "idempotency-key": crypto.randomUUID(),
      "x-request-id": crypto.randomUUID(),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "Integration action failed",
    );
  }
  return payload;
}

function phaseIndex(phase: OnboardingPhase): number {
  return Math.max(
    0,
    PHASES.findIndex((item) => item.id === phase),
  );
}

export function OnboardingAgentPanel({
  orgId,
  firstName,
  organizationName,
}: {
  orgId: string;
  firstName: string;
  organizationName: string;
}) {
  const router = useRouter();
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<OnboardingState | null>(null);
  const [actions, setActions] = useState<OnboardingAction[]>([]);
  const [suggestedReplies, setSuggestedReplies] = useState<string[]>(STARTER_CHIPS);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [connectedIds, setConnectedIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    onboardingFetch(orgId, "GET")
      .then((payload) => {
        if (cancelled) return;
        const next = payload as OnboardingState & {
          suggestedActions?: OnboardingAction[];
          suggestedReplies?: string[];
        };
        setState(next);
        setActions(next.suggestedActions ?? []);
        if (next.suggestedReplies?.length) {
          setSuggestedReplies(next.suggestedReplies);
        } else if ((next.messages?.length ?? 0) > 1) {
          setSuggestedReplies([]);
        }
      })
      .catch(() => {
        if (!cancelled) setError(FRIENDLY_ERROR);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state?.messages.length, busy, actions.length]);

  const activePhase = state?.phase ?? "discover";
  const activePhaseIndex = phaseIndex(activePhase);
  const showStarters = useMemo(
    () =>
      Boolean(
        state &&
          state.messages.filter((message) => message.role === "user").length === 0 &&
          suggestedReplies.length > 0,
      ),
    [state, suggestedReplies.length],
  );

  async function sendMessage(raw: string) {
    const message = raw.trim();
    if (!message || busy) return;
    setBusy("chat");
    setError(null);
    setDraft("");
    setSuggestedReplies([]);
    try {
      const payload = (await onboardingFetch(orgId, "POST", message)) as OnboardingState & {
        suggestedActions?: OnboardingAction[];
        suggestedReplies?: string[];
      };
      setState(payload);
      setActions(payload.suggestedActions ?? []);
      setSuggestedReplies(payload.suggestedReplies ?? []);
    } catch {
      setError(FRIENDLY_ERROR);
      setDraft(message);
    } finally {
      setBusy(null);
      inputRef.current?.focus();
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await sendMessage(draft);
  }

  async function runAction(action: OnboardingAction) {
    setBusy(action.type);
    setError(null);
    try {
      if (action.type === "connect_webhook") {
        const result = await integrationFetch("/api/integrations/webhook", orgId);
        setWebhookUrl(result.webhookUrl as string);
        setWebhookSecret(result.signingSecret as string);
        setConnectedIds((prev) =>
          prev.includes("int_webhook") ? prev : [...prev, "int_webhook"],
        );
      }
      if (action.type === "connect_github") {
        const result = await integrationFetch("/api/integrations/github", orgId);
        window.open(result.installUrl as string, "_blank", "noopener,noreferrer");
        setConnectedIds((prev) =>
          prev.includes("int_github") ? prev : [...prev, "int_github"],
        );
      }
      router.refresh();
    } catch {
      setError(FRIENDLY_ERROR);
    } finally {
      setBusy(null);
    }
  }

  async function copyValue(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1500);
  }

  return (
    <section className="delphi-onboarding">
      <div className="delphi-glow" aria-hidden="true" />

      <div className="delphi-stage">
        <nav className="delphi-phases" aria-label="Onboarding progress">
          {PHASES.map((phase, index) => (
            <span
              key={phase.id}
              className={`delphi-phase${index <= activePhaseIndex ? " active" : ""}${
                phase.id === activePhase ? " current" : ""
              }`}
            >
              {index < activePhaseIndex ? (
                <Check size={12} aria-hidden="true" />
              ) : (
                <span className="delphi-phase-dot" />
              )}
              {phase.label}
            </span>
          ))}
        </nav>

        <header className="delphi-hero">
          <div className="delphi-avatar" aria-hidden="true">
            <Sparkles size={22} />
          </div>
          <p className="delphi-kicker">{organizationName} · Operations</p>
          <h1>Your Operations Manager is ready</h1>
          <p className="delphi-sub">
            Hi {firstName}. Tell me about the product only — I&apos;ll identify
            feedback apps like Zendesk, Slack, App Store, and Play Store, then
            connect them for intake.
          </p>
        </header>

        {error && (
          <div className="delphi-soft-error" role="status">
            <p>{error}</p>
            <button type="button" className="text-link" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}

        <div className="delphi-thread" aria-live="polite">
          {!state ? (
            <div className="onboarding-loading">
              <LoaderCircle className="spin" size={18} aria-hidden="true" />
              <span>Operations Manager coming online...</span>
            </div>
          ) : (
            state.messages.map((message, index) => (
              <div
                key={`${message.at}-${index}`}
                className={`delphi-bubble ${message.role}`}
              >
                {message.role === "assistant" && (
                  <span className="delphi-bubble-label">Ops Manager</span>
                )}
                <p>{message.content}</p>
              </div>
            ))
          )}
          {busy === "chat" && (
            <div className="delphi-bubble assistant thinking">
              <span className="delphi-bubble-label">Ops Manager</span>
              <p>
                <LoaderCircle className="spin" size={14} aria-hidden="true" />
                Mapping your operating loop...
              </p>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {state && state.recommendedConnectors.length > 0 && (
          <section className="delphi-sync">
            <div className="delphi-sync-head">
              <PlugZap size={16} aria-hidden="true" />
              <div>
                <strong>Connect intake sources</strong>
                <p>
                  I&apos;ll pull customer signal into the Feedback inbox, then
                  run triage on the problem board under your approval.
                </p>
              </div>
            </div>
            <div className="delphi-sync-grid">
              {state.recommendedConnectors.map((connector) => {
                const connected = connectedIds.includes(connector.integrationId);
                const action = actions.find((item) => {
                  if (item.type === "connect_webhook")
                    return connector.integrationId === "int_webhook";
                  if (item.type === "connect_github")
                    return connector.integrationId === "int_github";
                  if (item.type === "oauth_connect")
                    return item.integrationId === connector.integrationId;
                  return false;
                });
                return (
                  <article
                    key={connector.integrationId}
                    className={`delphi-source${connected ? " connected" : ""}`}
                  >
                    <div>
                      <span className="delphi-source-priority">
                        {connector.priority}
                      </span>
                      <h3>{connector.provider}</h3>
                      <p>{connector.reason}</p>
                    </div>
                    {connected ? (
                      <span className="delphi-source-status">
                        <Check size={14} aria-hidden="true" /> Connected
                      </span>
                    ) : action?.type === "oauth_connect" ? (
                      <Link
                        className="btn"
                        href={`/integrations?focus=${action.integrationId}`}
                      >
                        Connect
                      </Link>
                    ) : action ? (
                      <button
                        className="btn primary"
                        type="button"
                        disabled={busy === action.type}
                        onClick={() => runAction(action)}
                      >
                        {busy === action.type ? "Connecting..." : "Connect"}
                      </button>
                    ) : null}
                  </article>
                );
              })}
            </div>
            {actions.some((action) => action.type === "open_settings_ai") && (
              <Link className="btn" href="/settings#ai">
                Enable AI agents
              </Link>
            )}
          </section>
        )}

        {(webhookUrl || webhookSecret) && (
          <div className="delphi-credentials">
            {webhookUrl && (
              <>
                <label>Webhook URL</label>
                <div className="setup-copy-row">
                  <code>{webhookUrl}</code>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => copyValue("url", webhookUrl)}
                  >
                    <Copy size={14} />
                    {copied === "url" ? "Copied" : "Copy"}
                  </button>
                </div>
              </>
            )}
            {webhookSecret && (
              <>
                <label>Signing secret (shown once)</label>
                <div className="setup-copy-row">
                  <code>{webhookSecret}</code>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => copyValue("secret", webhookSecret)}
                  >
                    <Copy size={14} />
                    {copied === "secret" ? "Copied" : "Copy"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {(showStarters || suggestedReplies.length > 0) && (
          <div className="delphi-chips" aria-label="Suggested replies">
            {(showStarters ? STARTER_CHIPS : suggestedReplies).map((chip) => (
              <button
                key={chip}
                type="button"
                className="delphi-chip"
                disabled={busy === "chat"}
                onClick={() => sendMessage(chip)}
              >
                {chip}
              </button>
            ))}
          </div>
        )}

        <form className="delphi-composer" onSubmit={onSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={draft}
            placeholder="Describe your product — name, what it does, URL..."
            onChange={(event) => setDraft(event.target.value)}
            disabled={busy === "chat"}
            autoFocus
          />
          <button
            className="delphi-send"
            type="submit"
            disabled={!draft.trim() || busy === "chat"}
            aria-label="Send message"
          >
            <ArrowUp size={18} aria-hidden="true" />
          </button>
        </form>
      </div>
    </section>
  );
}
