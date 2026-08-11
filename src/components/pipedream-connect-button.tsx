"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ConnectorInputGuidance,
  type ConnectorGuidanceMode,
} from "@/components/connector-input-guidance";
import type { IntegrationConnectionState } from "@/lib/integration-client";
import type { PipedreamConnectorId } from "@/lib/pipedream-connectors";

const POLL_INTERVAL_MS = 2_000;
const POLL_ATTEMPTS = 90;

export type PipedreamConnectState =
  | "idle"
  | "opening"
  | "waiting"
  | "connected"
  | "error";

interface StatusPayload {
  connectionState?: IntegrationConnectionState | null;
  accounts?: Array<{ accountId: string; name: string | null; state: string }>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchStatus(
  orgId: string,
  integrationId: PipedreamConnectorId,
): Promise<StatusPayload> {
  const response = await fetch("/api/integrations/pipedream/status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-org-id": orgId,
      "idempotency-key": crypto.randomUUID(),
      "x-request-id": crypto.randomUUID(),
    },
    body: JSON.stringify({ integrationId }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("status_unavailable");
  return response.json() as Promise<StatusPayload>;
}

export async function fetchConnectedIntegrationIds(
  orgId: string,
): Promise<string[]> {
  const response = await fetch("/api/integrations/setup", {
    headers: { "x-org-id": orgId, "x-request-id": crypto.randomUUID() },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("status_unavailable");
  const payload = (await response.json()) as { connectedIntegrationIds?: unknown };
  return Array.isArray(payload.connectedIntegrationIds)
    ? payload.connectedIntegrationIds.filter((id): id is string => typeof id === "string")
    : [];
}

export function PipedreamConnectButton({
  orgId,
  integrationId,
  initiallyConnected = false,
  connectionState,
  className = "btn primary",
  onConnected,
  allowAdditionalAccount = false,
  guidance = "full",
  showGuidance = true,
  ariaLabel,
  idleLabel = "Connect",
  onStateChange,
}: {
  orgId: string;
  integrationId: PipedreamConnectorId;
  initiallyConnected?: boolean;
  connectionState?: IntegrationConnectionState;
  className?: string;
  onConnected?: (integrationId: PipedreamConnectorId) => void;
  allowAdditionalAccount?: boolean;
  guidance?: ConnectorGuidanceMode;
  showGuidance?: boolean;
  ariaLabel?: string;
  idleLabel?: string;
  onStateChange?: (state: PipedreamConnectState) => void;
}) {
  const router = useRouter();
  const runRef = useRef(0);
  const popupRef = useRef<Window | null>(null);
  const [state, setState] = useState<PipedreamConnectState>(
    initiallyConnected ? "connected" : "idle",
  );

  function transition(nextState: PipedreamConnectState): void {
    setState(nextState);
    onStateChange?.(nextState);
  }

  useEffect(() => () => {
    runRef.current += 1;
    popupRef.current?.close();
  }, []);

  function finish(): void {
    transition("connected");
    popupRef.current?.close();
    onConnected?.(integrationId);
    router.refresh();
  }

  function cancelConnection(): void {
    runRef.current += 1;
    popupRef.current?.close();
    popupRef.current = null;
    transition("idle");
  }

  async function connect(): Promise<void> {
    if (["opening", "waiting"].includes(state)) return;
    const popup = window.open("about:blank", "closespan-pipedream-connect", "popup,width=560,height=760");
    if (!popup) {
      transition("error");
      return;
    }
    popup.document.title = "Connect account";
    popupRef.current = popup;
    const run = ++runRef.current;
    transition("opening");

    try {
      const response = await fetch("/api/integrations/pipedream/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-org-id": orgId,
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify({ integrationId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { connectUrl?: unknown };
      if (!response.ok || typeof payload.connectUrl !== "string") throw new Error("token_unavailable");
      popup.location.href = payload.connectUrl;
      transition("waiting");

      for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
        if (attempt > 0) await delay(POLL_INTERVAL_MS);
        if (runRef.current !== run) return;
        const status = await fetchStatus(orgId, integrationId).catch(() => null);
        if (status?.connectionState === "Connected") {
          finish();
          return;
        }
        if (popup.closed && attempt > 2) break;
      }
      transition("error");
    } catch {
      popup.close();
      transition("error");
    }
  }

  const connected = state === "connected" || initiallyConnected || connectionState === "Connected";
  if (connected && !allowAdditionalAccount) {
    return <span className="delphi-source-status"><Check size={14} aria-hidden="true" /> Connected</span>;
  }

  const busy = state === "opening" || state === "waiting";
  const label = state === "opening"
    ? "Opening secure sign-in..."
    : state === "waiting"
      ? "Waiting for authorization..."
      : state === "error"
        ? "Try again"
        : connected
          ? "+ Add another account"
          : connectionState === "Needs reconnect" ? "Reconnect" : idleLabel;

  return (
    <div className="connector-connect-control" aria-busy={busy}>
      {showGuidance && integrationId === "int_zendesk" && !connected && (
        <ConnectorInputGuidance mode={guidance} />
      )}
      <button type="button" className={className} aria-label={ariaLabel} disabled={busy} onClick={() => void connect()}>
        {busy && <LoaderCircle className="spin" size={14} aria-hidden="true" />}
        {label}
      </button>
      {state === "waiting" && (
        <div className="connector-waiting-help" role="status">
          <p className="subtle">Finish signing in in the secure window. You can keep using CloseSpan while it completes.</p>
          <button className="text-link" type="button" onClick={cancelConnection}>Cancel and retry</button>
        </div>
      )}
      {state === "error" && <p className="subtle" role="status">{integrationId === "int_zendesk" ? "The connection did not finish. Retry and enter only the Zendesk subdomain, such as miraai." : "The connection did not finish. Try again, or connect another source and return to this one later."}</p>}
    </div>
  );
}
