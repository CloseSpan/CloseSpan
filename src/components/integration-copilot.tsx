"use client";

import {
  ArrowUp,
  Check,
  ChevronRight,
  GitBranch,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type {
  IntegrationCopilotHistoryItem,
  IntegrationCopilotResult,
} from "@/lib/integration-copilot";
import { isPipedreamConnectorId } from "@/lib/pipedream-connectors";
import type { PipedreamConnectState } from "./pipedream-connect-button";
import { IntegrationProviderIcon } from "./integration-provider-icon";
import { PipedreamConnectButton } from "./pipedream-connect-button";

export interface IntegrationCopilotConnectorView {
  id: string;
  name: string;
  connected: boolean;
  available: boolean;
  summary: string;
  importedData: readonly string[];
  requestedPermissions: readonly string[];
}

interface ThreadMessage extends IntegrationCopilotHistoryItem {
  id: string;
  at: string | null;
}

const initialMessage: ThreadMessage = {
  id: "integration-copilot-welcome",
  role: "assistant",
  content:
    "Tell me where feedback lives or which app you want to connect. I’ll find the right connector and keep every permission and sign-in under your control.",
  at: null,
};

const initialReplies = [
  "Connect Zendesk",
  "Recommend sources",
  "Show connected apps",
  "How does feedback get imported?",
];

function messageTime(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function progressLabel(
  state: PipedreamConnectState | undefined,
  connected: boolean,
): string {
  if (connected || state === "connected") return "Connection verified";
  if (state === "opening") return "Opening secure sign-in";
  if (state === "waiting") return "Waiting for authorization";
  if (state === "error") return "Connection needs attention";
  return "Connector matched and ready for you";
}

export function IntegrationCopilot({
  orgId,
  connectors,
  onInspect,
  onConnected,
  onConnectionProgressChange,
}: {
  orgId: string;
  connectors: IntegrationCopilotConnectorView[];
  onInspect: (integrationId: string) => void;
  onConnected: (integrationId: string) => void;
  onConnectionProgressChange?: (
    integrationId: string,
    state: PipedreamConnectState,
  ) => void;
}) {
  const [messages, setMessages] = useState<ThreadMessage[]>([initialMessage]);
  const [result, setResult] = useState<IntegrationCopilotResult | null>(null);
  const [suggestedReplies, setSuggestedReplies] = useState(initialReplies);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const reduceMotion = useReducedMotion();
  const [connectionProgress, setConnectionProgress] = useState<
    Partial<Record<string, PipedreamConnectState>>
  >({});
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const connectorMap = useMemo(
    () => new Map(connectors.map((connector) => [connector.id, connector])),
    [connectors],
  );

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({
      block: "nearest",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [busy, messages, result]);

  async function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed || busy) return;
    const nextUser: ThreadMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      at: new Date().toISOString(),
    };
    setMessages((previous) => [...previous, nextUser]);
    setResult(null);
    setDraft("");
    setBusy(true);
    try {
      const response = await fetch("/api/integrations/copilot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-org-id": orgId,
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify({
          message: trimmed,
          history: messages
            .slice(-8)
            .map(({ role, content }) => ({ role, content })),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as
        | IntegrationCopilotResult
        | { error?: unknown };
      if (!response.ok || !("assistantMessage" in payload))
        throw new Error("guidance_unavailable");
      setMessages((previous) => [
        ...previous,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: payload.assistantMessage,
          at: new Date().toISOString(),
        },
      ]);
      setResult(payload);
      setSuggestedReplies(
        payload.suggestedReplies.length > 0
          ? payload.suggestedReplies
          : initialReplies,
      );
    } catch {
      setMessages((previous) => [
        ...previous,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "The integration guide is temporarily unavailable. The connector catalog below still works, so you can continue without waiting.",
          at: new Date().toISOString(),
        },
      ]);
      setSuggestedReplies(initialReplies);
    } finally {
      setBusy(false);
    }
  }

  function skipConnector(integrationId: string) {
    const connector = connectorMap.get(integrationId);
    setResult((current) => {
      if (!current) return current;
      const remaining = current.connectors.filter(
        (item) => item.integrationId !== integrationId,
      );
      if (remaining.length > 0) return { ...current, connectors: remaining };
      return null;
    });
    setMessages((previous) => [
      ...previous,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `${connector?.name ?? "That connector"} is skipped for now. Nothing was changed, and you can return to it at any time.`,
        at: new Date().toISOString(),
      },
    ]);
    setSuggestedReplies(["Recommend another source", "Show connected apps"]);
  }

  function confirmConnected(integrationId: string) {
    const connector = connectorMap.get(integrationId);
    onConnected(integrationId);
    setConnectionProgress((current) => ({
      ...current,
      [integrationId]: "connected",
    }));
    onConnectionProgressChange?.(integrationId, "connected");
    setMessages((previous) => [
      ...previous,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `${connector?.name ?? "The source"} is connected and verified. ${integrationId === "int_zendesk" ? "Manage the account to pull feedback into the inbox now." : "You can manage the account or connect another source."}`,
        at: new Date().toISOString(),
      },
    ]);
    setSuggestedReplies([
      "Show connected apps",
      "Connect another source",
      "How does feedback get imported?",
    ]);
  }

  const visibleMessages = messages.slice(-4);
  const liveMessage = busy
    ? "Checking the workspace and connector catalog."
    : result?.assistantMessage ?? messages.at(-1)?.content ?? initialMessage.content;

  return (
    <motion.section
      className="integration-copilot"
      aria-labelledby="integration-copilot-title"
      initial={reduceMotion ? false : { opacity: 0, y: 18, scale: 0.992 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : {
              type: "spring",
              stiffness: 220,
              damping: 26,
              mass: 0.9,
            }
      }
    >
      <h2 id="integration-copilot-title" className="sr-only">
        Connect integrations with your Operations Manager
      </h2>
      <span className="sr-only" aria-live="polite">
        {liveMessage}
      </span>

      <div
        className="integration-copilot-thread"
        role="log"
        aria-busy={busy}
        aria-label="Integration conversation"
      >
        {visibleMessages.map((message) => {
          const formattedTime = messageTime(message.at);
          const isWelcomeMessage = message.id === initialMessage.id;
          return (
            <motion.div
              key={message.id}
              className={`integration-copilot-turn ${message.role}${isWelcomeMessage ? " welcome" : ""}`}
              initial={
                reduceMotion
                  ? false
                  : {
                      opacity: 0,
                      y: isWelcomeMessage ? 22 : 16,
                      scale: isWelcomeMessage ? 0.985 : 0.975,
                    }
              }
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : {
                      type: "spring",
                      stiffness: 260,
                      damping: 24,
                      mass: 0.75,
                      delay: isWelcomeMessage ? 0.12 : 0,
                    }
              }
            >
              {message.role === "assistant" && (
                <span className="integration-copilot-sender">
                  Operations Manager
                </span>
              )}
              <div className="integration-copilot-bubble-row">
                {message.role === "assistant" && (
                  <span className="integration-copilot-avatar" aria-hidden="true">
                    <Sparkles size={15} />
                  </span>
                )}
                <div
                  className={`integration-copilot-message ${message.role}${isWelcomeMessage ? " welcome" : ""}`}
                >
                  <p>{message.content}</p>
                </div>
              </div>
              {formattedTime && (
                <time dateTime={message.at ?? undefined}>{formattedTime}</time>
              )}
            </motion.div>
          );
        })}
        {busy && (
          <div className="integration-copilot-turn assistant busy-turn">
            <span className="integration-copilot-sender">
              Operations Manager
            </span>
            <div className="integration-copilot-bubble-row">
              <span className="integration-copilot-avatar" aria-hidden="true">
                <Sparkles size={15} />
              </span>
              <div
                className="integration-copilot-message assistant integration-copilot-busy"
                role="status"
              >
                <LoaderCircle className="spin" size={16} aria-hidden="true" />
                <span>Working</span>
              </div>
            </div>
          </div>
        )}
        <div ref={threadEndRef} className="integration-copilot-thread-end" />
      </div>

      {result && result.connectors.length > 0 && (
        <div
          className="integration-copilot-actions"
          aria-label="Suggested connectors"
        >
          {result.connectors.map((recommendation) => {
            const connector = connectorMap.get(recommendation.integrationId);
            if (!connector) return null;
            const state = connectionProgress[connector.id];
            const connected =
              connector.connected ||
              recommendation.mode === "manage" ||
              state === "connected";
            const connectionBusy = state === "opening" || state === "waiting";
            const headingId = `integration-copilot-task-${connector.id}`;
            return (
              <div className="integration-copilot-task" key={connector.id}>
                <article
                  className={`integration-copilot-connector${connected ? " connected" : ""}`}
                  aria-labelledby={headingId}
                >
                  <IntegrationProviderIcon integrationId={connector.id} size={30} />
                  <div className="integration-copilot-connector-copy">
                    <h3 id={headingId}>
                      {connected ? `${connector.name} connected` : `Connect ${connector.name}`}
                    </h3>
                    <p>{connector.summary}</p>
                  </div>
                  <div className="integration-copilot-connector-actions">
                    <button
                      className="integration-copilot-skip"
                      type="button"
                      disabled={connectionBusy}
                      aria-label={`Skip ${connector.name}`}
                      onClick={() => skipConnector(connector.id)}
                    >
                      Skip
                    </button>
                    {connected ? (
                      <button
                        className="integration-copilot-primary-action"
                        type="button"
                        onClick={() => onInspect(connector.id)}
                      >
                        <Check size={15} aria-hidden="true" /> Manage
                      </button>
                    ) : !connector.available ? (
                      <button
                        className="integration-copilot-primary-action"
                        type="button"
                        disabled
                      >
                        Coming soon
                      </button>
                    ) : isPipedreamConnectorId(connector.id) ? (
                      <PipedreamConnectButton
                        orgId={orgId}
                        integrationId={connector.id}
                        className="integration-copilot-primary-action"
                        guidance="hidden"
                        ariaLabel={`Connect ${connector.name}`}
                        onStateChange={(nextState) =>
                          {
                            setConnectionProgress((current) => ({
                              ...current,
                              [connector.id]: nextState,
                            }));
                            onConnectionProgressChange?.(
                              connector.id,
                              nextState,
                            );
                          }
                        }
                        onConnected={() => confirmConnected(connector.id)}
                      />
                    ) : (
                      <button
                        className="integration-copilot-primary-action"
                        type="button"
                        onClick={() => onInspect(connector.id)}
                      >
                        Set up
                      </button>
                    )}
                  </div>
                </article>

                <details className="integration-copilot-working">
                  <summary>
                    <ChevronRight size={16} aria-hidden="true" />
                    Working
                  </summary>
                  <div className="integration-copilot-working-body">
                    <div className="integration-copilot-working-state">
                      <GitBranch size={15} aria-hidden="true" />
                      <strong>{progressLabel(state, connected)}</strong>
                    </div>
                    <p>{recommendation.reason}</p>
                    <dl>
                      <div>
                        <dt>Data</dt>
                        <dd>{connector.importedData.slice(0, 3).join(", ")}</dd>
                      </div>
                      <div>
                        <dt>Permissions</dt>
                        <dd>
                          <ShieldCheck size={13} aria-hidden="true" />
                          {connector.requestedPermissions.slice(0, 3).join(", ")}
                        </dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => onInspect(connector.id)}
                    >
                      Review all data and permissions
                    </button>
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      )}

      <div className="integration-copilot-controls">
        {!busy && (!result || result.connectors.length === 0) && (
          <motion.div
            className="integration-copilot-replies"
            aria-label="Suggested questions"
            initial={reduceMotion ? false : "hidden"}
            animate="visible"
            variants={{
              hidden: {},
              visible: {
                transition: {
                  staggerChildren: reduceMotion ? 0 : 0.09,
                  delayChildren: reduceMotion ? 0 : 0.62,
                },
              },
            }}
          >
            {suggestedReplies.slice(0, 4).map((reply) => (
              <motion.button
                key={reply}
                type="button"
                disabled={busy}
                onClick={() => void send(reply)}
                variants={{
                  hidden: { opacity: 0, y: 14, scale: 0.82 },
                  visible: { opacity: 1, y: 0, scale: 1 },
                }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : {
                        type: "spring",
                        stiffness: 360,
                        damping: 20,
                        mass: 0.68,
                      }
                }
                whileHover={reduceMotion ? undefined : { y: -2, scale: 1.025 }}
                whileTap={reduceMotion ? undefined : { scale: 0.96 }}
              >
                {reply}
              </motion.button>
            ))}
          </motion.div>
        )}
        <motion.form
          className="integration-copilot-composer"
          initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : {
                  type: "spring",
                  stiffness: 250,
                  damping: 25,
                  mass: 0.8,
                  delay: 1.02,
                }
          }
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
        >
          <label className="sr-only" htmlFor="integration-copilot-input">
            Ask about a connector
          </label>
          <input
            id="integration-copilot-input"
            className="neumorphic-composite-field"
            value={draft}
            maxLength={600}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask to connect any source…"
          />
          <button
            type="submit"
            disabled={busy || draft.trim().length === 0}
            data-ready={!busy && draft.trim().length > 0 ? "true" : "false"}
            aria-label="Send integration question"
          >
            <ArrowUp size={18} />
          </button>
        </motion.form>
      </div>
    </motion.section>
  );
}
