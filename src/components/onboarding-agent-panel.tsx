"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUp,
  Check,
  Copy,
  LoaderCircle,
  PlugZap,
  Sparkles,
} from "lucide-react";
import { PipedreamConnectButton } from "@/components/pipedream-connect-button";
import { IntegrationSyncStatus } from "@/components/integration-sync-status";
import { IntegrationProviderIcon } from "@/components/integration-provider-icon";
import { PublicSourceDiscovery } from "@/components/public-source-discovery";
import {
  isFeedbackSourceIntegration,
  isIntegrationAvailable,
} from "@/lib/integration-catalog";
import type { IntegrationConnectionState } from "@/lib/integration-client";
import type { WorkspaceSetupStatus } from "@/lib/integration-repository";
import { isPipedreamConnectorId } from "@/lib/pipedream-connectors";
import {
  deriveOnboardingPhase,
  resolvedConnectorFailure,
} from "@/lib/onboarding-guidance";
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

async function workspaceSetupFetch(
  orgId: string,
): Promise<WorkspaceSetupStatus> {
  const response = await fetch("/api/integrations/setup", {
    method: "GET",
    headers: {
      "x-org-id": orgId,
      "x-request-id": crypto.randomUUID(),
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("status_unavailable");
  return (await response.json()) as WorkspaceSetupStatus;
}

async function continueOnboardingFetch(orgId: string) {
  const response = await fetch("/api/onboarding", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-org-id": orgId,
      "idempotency-key": crypto.randomUUID(),
      "x-request-id": crypto.randomUUID(),
    },
    body: JSON.stringify({ action: "continue" }),
  });
  if (!response.ok) throw new Error("continue_unavailable");
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
  initialSetup,
}: {
  orgId: string;
  firstName: string;
  organizationName: string;
  initialSetup: WorkspaceSetupStatus;
}) {
  const router = useRouter();
  const threadRef = useRef<HTMLDivElement>(null);
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
  const [setupStatus, setSetupStatus] =
    useState<WorkspaceSetupStatus>(initialSetup);
  const [connectedIds, setConnectedIds] = useState<string[]>(
    initialSetup.connectedIntegrationIds,
  );
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [connectionStates, setConnectionStates] = useState<
    Partial<Record<string, IntegrationConnectionState>>
  >({});
  const [syncRefreshKeys, setSyncRefreshKeys] = useState<
    Record<string, number>
  >({});

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
  }, [loadVersion, orgId]);

  useEffect(() => {
    let cancelled = false;
    workspaceSetupFetch(orgId)
      .then((next) => {
        if (cancelled) return;
        setSetupStatus(next);
        setConnectedIds(next.connectedIntegrationIds);
      })
      .catch(() => {
        // Onboarding remains usable while a transient status read recovers.
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    thread.scrollTo({
      top: thread.scrollHeight,
      behavior: busy === "chat" ? "smooth" : "auto",
    });
  }, [state?.messages.length, busy]);

  const hasProductBrief = Boolean(
    state?.productProfile.productName?.trim() ||
      state?.productProfile.productUrl?.trim() ||
      state?.productProfile.productDescription?.trim(),
  );
  const activePhase: OnboardingPhase = deriveOnboardingPhase({
    persistedPhase: state?.phase ?? null,
    hasProductBrief,
    feedbackConnected: setupStatus.feedbackConnected,
    feedbackCount: setupStatus.feedbackCount,
  });
  const activePhaseIndex = phaseIndex(activePhase);
  const githubConnected = connectedIds.includes("int_github");
  const githubFailureIsResolved = resolvedConnectorFailure({
    provider: "GitHub",
    connected: githubConnected,
    messages: state?.messages ?? [],
  });
  const visibleSuggestedReplies = githubFailureIsResolved
    ? []
    : suggestedReplies;
  const nextFeedbackSource = state?.recommendedConnectors.find(
    (connector) =>
      isFeedbackSourceIntegration(connector.integrationId) &&
      isIntegrationAvailable(connector.integrationId) &&
      !connectedIds.includes(connector.integrationId),
  );
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
        setSetupStatus((previous) => ({
          ...previous,
          feedbackConnected: true,
          connectedIntegrationIds: previous.connectedIntegrationIds.includes(
            "int_webhook",
          )
            ? previous.connectedIntegrationIds
            : [...previous.connectedIntegrationIds, "int_webhook"],
        }));
        setSuggestedReplies([]);
        setConnectionNotice(
          "Custom webhook is connected. You can keep working while the first feedback event arrives.",
        );
      }
      if (action.type === "connect_github") {
        const result = await integrationFetch("/api/integrations/github", orgId);
        window.open(result.installUrl as string, "_blank", "noopener,noreferrer");
      }
      router.refresh();
    } catch {
      setError(FRIENDLY_ERROR);
    } finally {
      setBusy(null);
    }
  }

  async function continueToWorkspace() {
    if (busy) return;
    setBusy("continue");
    setError(null);
    try {
      await continueOnboardingFetch(orgId);
      setState((previous) =>
        previous ? { ...previous, phase: "complete" } : previous,
      );
      router.push("/feedback");
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
              aria-current={phase.id === activePhase ? "step" : undefined}
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
            Hi {firstName}. Tell me about the product only. I&apos;ll identify
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

        <div className="delphi-thread" ref={threadRef}>
          {!state ? (
            error ? (
              <div className="onboarding-load-fallback" role="status">
                <strong>The chat is taking a little longer.</strong>
                <p>
                  You can retry it or open Integrations and connect a source
                  directly.
                </p>
                <div>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => {
                      setError(null);
                      setLoadVersion((current) => current + 1);
                    }}
                  >
                    Retry chat
                  </button>
                  <Link className="btn" href="/integrations">
                    Open integrations
                  </Link>
                </div>
              </div>
            ) : (
              <div className="onboarding-loading">
                <LoaderCircle className="spin" size={18} aria-hidden="true" />
                <span>Operations Manager coming online...</span>
              </div>
            )
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
          {state && githubFailureIsResolved && (
            <div className="delphi-bubble assistant resolved" role="status">
              <span className="delphi-bubble-label">Ops Manager · Updated</span>
              <p>
                GitHub is connected now. The earlier OAuth failure is
                resolved. It is ready for approved actions, so let&apos;s move on
                to a feedback source. Slack or the custom webhook will get
                intake started.
              </p>
            </div>
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
        </div>
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {busy === "chat"
            ? "The Operations Manager is preparing a response."
            : githubFailureIsResolved
              ? "GitHub is connected now. The earlier OAuth failure is resolved. Choose another feedback source or continue to the workspace."
            : state?.messages.at(-1)?.role === "assistant"
              ? state.messages.at(-1)?.content
              : ""}
        </p>

        {state &&
          (state.productProfile.productName ||
            state.productProfile.productUrl ||
            state.productProfile.productDescription) && (
            <PublicSourceDiscovery
              key={JSON.stringify([
                state.productProfile.productName,
                state.productProfile.productUrl,
                state.productProfile.productDescription,
              ])}
              orgId={orgId}
              productProfile={state.productProfile}
            />
          )}

        {state && hasProductBrief && (
          <section
            className={`delphi-recovery${
              setupStatus.feedbackConnected ? " ready" : ""
            }`}
            aria-label="Recommended next step"
          >
            <div className="delphi-recovery-icon" aria-hidden="true">
              {setupStatus.feedbackConnected ? (
                <Check size={18} />
              ) : (
                <ArrowRight size={18} />
              )}
            </div>
            <div
              className="delphi-recovery-copy"
              aria-live="polite"
              aria-atomic="true"
            >
              <span className="delphi-bubble-label">Next best step</span>
              <strong>
                {setupStatus.feedbackConnected
                  ? "Your feedback intake is connected"
                  : githubFailureIsResolved
                    ? "GitHub is connected. Keep moving"
                    : "Choose one feedback source to keep moving"}
              </strong>
              <p>
                {setupStatus.feedbackConnected
                  ? setupStatus.feedbackCount > 0
                    ? "Signal is already arriving. Open the inbox and start operating; other integrations can be added later."
                    : "You do not need to wait for the first import here. Closespan will keep checking in the background while you explore the workspace."
                  : githubFailureIsResolved
                    ? `The earlier OAuth issue is resolved. GitHub is ready for approved engineering actions, and it does not need a feedback import. ${
                        nextFeedbackSource
                          ? `Connect ${nextFeedbackSource.provider} next, or use the webhook fallback.`
                          : "Connect another intake source or use the webhook fallback."
                      }`
                    : nextFeedbackSource
                      ? `Start with ${nextFeedbackSource.provider}. If its authorization is blocked, the custom webhook is always available as a fallback.`
                      : "Use the custom webhook if a native connector is unavailable. You can also explore the workspace and finish setup later."}
              </p>
              {connectionNotice && (
                <p className="delphi-recovery-notice">{connectionNotice}</p>
              )}
            </div>
            <div className="delphi-recovery-actions">
              {!setupStatus.feedbackConnected && (
                <a className="btn primary" href="#intake-sources">
                  Choose a source
                </a>
              )}
              <button
                type="button"
                className={setupStatus.feedbackConnected ? "btn primary" : "btn"}
                disabled={busy === "continue"}
                onClick={continueToWorkspace}
              >
                {busy === "continue" ? "Opening..." : "Explore workspace"}
              </button>
            </div>
          </section>
        )}

        {state && state.recommendedConnectors.length > 0 && (
          <section className="delphi-sync" id="intake-sources">
            <div className="delphi-sync-head">
              <PlugZap size={16} aria-hidden="true" />
              <div>
                <strong>Connect your workflow</strong>
                <p>
                  Choose one intake source now. Engineering destinations and
                  additional sources can be connected later.
                </p>
              </div>
            </div>
            <div className="delphi-sync-grid">
              {state.recommendedConnectors.map((connector) => {
                const observedConnectionState =
                  connectionStates[connector.integrationId];
                const connected =
                  observedConnectionState === undefined
                    ? connectedIds.includes(connector.integrationId)
                    : observedConnectionState === "Connected";
                const pipedreamIntegrationId = isPipedreamConnectorId(
                  connector.integrationId,
                )
                  ? connector.integrationId
                  : null;
                const feedbackSource = isFeedbackSourceIntegration(
                  connector.integrationId,
                );
                const available = isIntegrationAvailable(
                  connector.integrationId,
                );
                const connectorReason =
                  connector.integrationId === "int_github" && connected
                    ? "GitHub is ready to receive approved engineering actions after review."
                    : connector.reason;
                const action = actions.find((item) => {
                  if (item.type === "connect_webhook")
                    return connector.integrationId === "int_webhook";
                  if (item.type === "connect_github")
                    return connector.integrationId === "int_github";
                  if (item.type === "oauth_connect")
                    return item.integrationId === connector.integrationId;
                  return false;
                }) ??
                  (connector.integrationId === "int_webhook"
                    ? ({
                        type: "connect_webhook",
                        label: "Create webhook endpoint",
                      } satisfies OnboardingAction)
                    : connector.integrationId === "int_github"
                      ? ({
                          type: "connect_github",
                          label: "Connect GitHub",
                        } satisfies OnboardingAction)
                      : null);
                return (
                  <article
                    key={connector.integrationId}
                    className={`delphi-source${connected ? " connected" : ""}`}
                    data-connector-id={connector.integrationId}
                  >
                    <div>
                      <div className="delphi-source-title">
                        <IntegrationProviderIcon
                          integrationId={connector.integrationId}
                          size={16}
                          compact
                        />
                        <div>
                          <span className="delphi-source-priority">
                            {feedbackSource ? connector.priority : "optional"}
                          </span>
                          <h3>{connector.provider}</h3>
                        </div>
                      </div>
                      <p>{connectorReason}</p>
                    </div>
                    {connected ? (
                      <div className="delphi-source-connected">
                        <span className="delphi-source-status">
                          <Check size={14} aria-hidden="true" /> Connected
                        </span>
                        {pipedreamIntegrationId && feedbackSource ? (
                          <IntegrationSyncStatus
                            orgId={orgId}
                            integrationId={pipedreamIntegrationId}
                            active
                            refreshKey={
                              syncRefreshKeys[pipedreamIntegrationId] ?? 0
                            }
                            onSucceeded={() => router.refresh()}
                            onConnectionStateChange={(nextState) => {
                              setConnectionStates((previous) => ({
                                ...previous,
                                [pipedreamIntegrationId]: nextState,
                              }));
                              setConnectedIds((previous) =>
                                nextState === "Connected"
                                  ? previous.includes(pipedreamIntegrationId)
                                    ? previous
                                    : [...previous, pipedreamIntegrationId]
                                  : previous.filter(
                                      (id) => id !== pipedreamIntegrationId,
                                  ),
                              );
                              void workspaceSetupFetch(orgId)
                                .then((next) => {
                                  setSetupStatus(next);
                                  setConnectedIds(
                                    next.connectedIntegrationIds,
                                  );
                                })
                                .catch(() => {
                                  // Keep the last trusted setup snapshot during
                                  // a transient status read.
                                });
                            }}
                          />
                        ) : !feedbackSource ? (
                          <p className="integration-import succeeded">
                            <Check size={13} aria-hidden="true" />
                            Ready for approved actions
                          </p>
                        ) : null}
                      </div>
                    ) : !available ? (
                      <div className="delphi-source-unavailable">
                        <span>Coming soon</span>
                        <p>
                          This connector is not available yet. Choose another
                          source or use the webhook fallback.
                        </p>
                      </div>
                    ) : pipedreamIntegrationId ? (
                      <PipedreamConnectButton
                        orgId={orgId}
                        integrationId={pipedreamIntegrationId}
                        guidance="compact"
                        connectionState={observedConnectionState}
                        onConnected={(integrationId) => {
                          const provider = connector.provider;
                          setConnectedIds((previous) =>
                            previous.includes(integrationId)
                              ? previous
                              : [...previous, integrationId],
                          );
                          setConnectionStates((previous) => ({
                            ...previous,
                            [integrationId]: "Connected",
                          }));
                          setSyncRefreshKeys((previous) => ({
                            ...previous,
                            [integrationId]:
                              (previous[integrationId] ?? 0) + 1,
                          }));
                          setSuggestedReplies([]);
                          setConnectionNotice(
                            feedbackSource
                              ? `${provider} is connected. You can continue while the first import runs in the background.`
                              : `${provider} is connected and ready for approved actions. No feedback import is required.`,
                          );
                          void workspaceSetupFetch(orgId)
                            .then((next) => {
                              setSetupStatus(next);
                              setConnectedIds(next.connectedIntegrationIds);
                            })
                            .catch(() => {
                              setSetupStatus((previous) => ({
                                ...previous,
                                feedbackConnected:
                                  previous.feedbackConnected || feedbackSource,
                                githubConnected:
                                  previous.githubConnected ||
                                  integrationId === "int_github",
                                connectedIntegrationIds:
                                  previous.connectedIntegrationIds.includes(
                                    integrationId,
                                  )
                                    ? previous.connectedIntegrationIds
                                    : [
                                        ...previous.connectedIntegrationIds,
                                        integrationId,
                                      ],
                              }));
                            });
                        }}
                      />
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

        {(showStarters || visibleSuggestedReplies.length > 0) && (
          <div className="delphi-chips" aria-label="Suggested replies">
            {(showStarters ? STARTER_CHIPS : visibleSuggestedReplies).map((chip) => (
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

        {state && hasProductBrief && (
          <nav className="delphi-workspace-links" aria-label="Onboarding options">
            <Link href="/integrations">Manage all integrations</Link>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              disabled={busy === "continue"}
              onClick={continueToWorkspace}
            >
              Continue for now. Setup stays available
            </button>
          </nav>
        )}

        <form className="delphi-composer" onSubmit={onSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={draft}
            aria-label="Describe your product"
            placeholder="Describe your product: name, what it does, URL..."
            onChange={(event) => setDraft(event.target.value)}
            disabled={busy === "chat"}
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
