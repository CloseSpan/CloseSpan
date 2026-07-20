"use client";

import Nango, {
  type ConnectUI,
  type ConnectUIEvent,
} from "@nangohq/frontend";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import type { NangoConnectorId } from "@/lib/nango-connectors";
import type { IntegrationConnectionState } from "@/lib/integration-client";

const VERIFY_ATTEMPTS = 12;
const VERIFY_INTERVAL_MS = 1_500;
const FRIENDLY_ERROR =
  "Connection is unavailable right now. Please try again later.";

type ConnectState = "idle" | "starting" | "verifying" | "connected" | "error";

interface SetupStatus {
  connectedIntegrationIds?: unknown;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function connectedIdsFrom(payload: SetupStatus): string[] {
  return Array.isArray(payload.connectedIntegrationIds)
    ? payload.connectedIntegrationIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
}

async function fetchSetupStatus(orgId: string): Promise<string[]> {
  const response = await fetch("/api/integrations/setup", {
    method: "GET",
    headers: {
      "x-org-id": orgId,
      "x-request-id": crypto.randomUUID(),
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("status_unavailable");
  const payload = (await response.json().catch(() => ({}))) as SetupStatus;
  return connectedIdsFrom(payload);
}

export async function fetchConnectedIntegrationIds(
  orgId: string,
): Promise<string[]> {
  return fetchSetupStatus(orgId);
}

export function NangoConnectButton({
  orgId,
  integrationId,
  initiallyConnected = false,
  connectionState,
  className = "btn primary",
  onConnected,
}: {
  orgId: string;
  integrationId: NangoConnectorId;
  initiallyConnected?: boolean;
  connectionState?: IntegrationConnectionState;
  className?: string;
  onConnected?: (integrationId: NangoConnectorId) => void;
}) {
  const router = useRouter();
  const connectUiRef = useRef<ConnectUI | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const verificationRunRef = useRef(0);
  const onConnectedRef = useRef(onConnected);
  const [state, setState] = useState<ConnectState>(
    initiallyConnected ? "connected" : "idle",
  );
  const sessionStorageKey = `feelow:nango:${orgId}:${integrationId}`;
  const serverRequiresAction =
    connectionState !== undefined && connectionState !== "Connected";

  useEffect(() => {
    onConnectedRef.current = onConnected;
  }, [onConnected]);

  useEffect(
    () => () => {
      verificationRunRef.current += 1;
      connectUiRef.current?.close();
      connectUiRef.current = null;
    },
    [],
  );

  async function verifyServerConnection(): Promise<void> {
    const run = verificationRunRef.current + 1;
    verificationRunRef.current = run;
    setState("verifying");

    for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await delay(VERIFY_INTERVAL_MS);
      if (verificationRunRef.current !== run) return;

      try {
        const connectedIds = await fetchSetupStatus(orgId);
        if (connectedIds.includes(integrationId)) {
          setState("connected");
          window.sessionStorage.removeItem(sessionStorageKey);
          idempotencyKeyRef.current = null;
          connectUiRef.current?.close();
          connectUiRef.current = null;
          onConnectedRef.current?.(integrationId);
          router.refresh();
          return;
        }
      } catch {
        // A transient status read should not override a valid signed webhook.
      }
    }

    if (verificationRunRef.current === run) setState("error");
  }

  async function connect(): Promise<void> {
    if (
      state === "starting" ||
      state === "verifying" ||
      (state === "connected" && !serverRequiresAction)
    ) {
      return;
    }

    verificationRunRef.current += 1;
    connectUiRef.current?.close();
    connectUiRef.current = null;
    setState("starting");

    try {
      const storedKey = window.sessionStorage.getItem(sessionStorageKey);
      idempotencyKeyRef.current ??=
        storedKey && /^[A-Za-z0-9_-]{8,128}$/.test(storedKey)
          ? storedKey
          : crypto.randomUUID();
      window.sessionStorage.setItem(
        sessionStorageKey,
        idempotencyKeyRef.current,
      );
      const response = await fetch("/api/integrations/nango/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-org-id": orgId,
          "idempotency-key": idempotencyKeyRef.current,
          "x-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify({ integrationId }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        token?: unknown;
        apiUrl?: unknown;
      };
      if (!response.ok || typeof payload.token !== "string" || !payload.token) {
        throw new Error("session_unavailable");
      }

      let authorizationCompleted = false;
      const nango = new Nango();
      const connectUi = nango.openConnectUI({
        sessionToken: payload.token,
        apiURL:
          typeof payload.apiUrl === "string" ? payload.apiUrl : undefined,
        themeOverride: "light",
        onEvent(event: ConnectUIEvent) {
          if (event.type === "connect") {
            authorizationCompleted = true;
            void verifyServerConnection();
          } else if (event.type === "error") {
            authorizationCompleted = true;
            verificationRunRef.current += 1;
            setState("error");
          } else if (event.type === "close" && !authorizationCompleted) {
            setState("idle");
          }
        },
      });
      connectUiRef.current = connectUi;
      setState("idle");
      connectUi.open();
    } catch {
      setState("error");
    }
  }

  if (
    (state === "connected" || initiallyConnected || connectionState === "Connected") &&
    !serverRequiresAction
  ) {
    return (
      <span className="delphi-source-status">
        <Check size={14} aria-hidden="true" /> Connected
      </span>
    );
  }

  const busy = state === "starting" || state === "verifying";
  return (
    <div>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={() => void connect()}
      >
        {busy && <LoaderCircle className="spin" size={14} aria-hidden="true" />}
        {state === "starting"
          ? "Opening..."
          : state === "verifying"
            ? "Verifying..."
            : state === "error"
              ? "Try again"
              : connectionState === "Needs reconnect"
                ? "Reconnect"
                : "Connect"}
      </button>
      {state === "error" && (
        <p className="subtle" role="status">
          {FRIENDLY_ERROR}
        </p>
      )}
    </div>
  );
}
