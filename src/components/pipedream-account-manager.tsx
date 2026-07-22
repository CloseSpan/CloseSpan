"use client";

import { Check, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PipedreamConnectButton } from "@/components/pipedream-connect-button";
import type { PipedreamConnectorId } from "@/lib/pipedream-connectors";
import type { IntegrationConnectionState } from "@/lib/integration-client";

interface Account {
  accountId: string;
  accountName: string | null;
  state: string;
  lastImportAt: string | null;
  lastImportStatus: "Running" | "Succeeded" | "Failed" | null;
  lastImportCount: number;
}

export function PipedreamAccountManager({
  orgId,
  integrationId,
  onConnectionStateChange,
  onImportComplete,
}: {
  orgId: string;
  integrationId: PipedreamConnectorId;
  onConnectionStateChange?: (state: IntegrationConnectionState) => void;
  onImportComplete?: (completedAt: string, processed: number) => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [pulling, setPulling] = useState<string | null>(null);
  const [pullNotice, setPullNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
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
      const payload = (await response.json().catch(() => ({}))) as { accounts?: Account[] };
      if (!response.ok) throw new Error("status_failed");
      setAccounts(Array.isArray(payload.accounts) ? payload.accounts : []);
      setError(null);
    } catch {
      setError("Account status is temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, [integrationId, orgId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function remove(accountId: string): Promise<void> {
    if (removing) return;
    setRemoving(accountId);
    setError(null);
    try {
      const response = await fetch("/api/integrations/pipedream/disconnect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-org-id": orgId,
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify({ integrationId, accountId }),
      });
      if (!response.ok) throw new Error("disconnect_failed");
      const remaining = accounts.filter(
        (account) => account.accountId !== accountId,
      );
      setAccounts(remaining);
      if (remaining.length === 0) onConnectionStateChange?.("Disconnected");
    } catch {
      setError("This account could not be removed right now. Try again later.");
    } finally {
      setRemoving(null);
    }
  }

  async function pull(accountId: string): Promise<void> {
    if (pulling) return;
    setPulling(accountId);
    setError(null);
    setPullNotice(null);
    try {
      const response = await fetch("/api/integrations/pipedream/pull", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-org-id": orgId,
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify({ integrationId, accountId }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        results?: Array<{ fetched: number; created: number; updated: number }>;
      };
      if (!response.ok) throw new Error(payload.error || "Feedback could not be pulled.");
      const result = payload.results?.[0];
      setPullNotice(result
        ? `Pull complete: ${result.created} new, ${result.updated} updated (${result.fetched} fetched).`
        : "Feedback pull completed.");
      onImportComplete?.(
        new Date().toISOString(),
        result ? result.created + result.updated : 0,
      );
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Feedback could not be pulled right now.");
    } finally {
      setPulling(null);
    }
  }

  return (
    <div className="pipedream-account-manager">
      {loading ? (
        <p className="subtle"><LoaderCircle className="spin" size={14} aria-hidden="true" /> Loading connected accounts...</p>
      ) : accounts.length > 0 ? (
        <div className="pipedream-account-list">
          {accounts.map((account) => (
            <div className="pipedream-account-row" key={account.accountId}>
              <div>
                <strong>{account.accountName || "Connected account"}</strong>
                <p className="subtle">{account.lastImportAt ? `Last pulled ${new Date(account.lastImportAt).toLocaleString()} · ${account.lastImportCount} processed` : account.state === "Connected" ? "Ready for the first pull" : "Reconnect required"}</p>
              </div>
              <div className="pipedream-account-actions">
                {integrationId === "int_zendesk" && account.state === "Connected" && (
                  <button className="btn primary" type="button" disabled={pulling === account.accountId} onClick={() => void pull(account.accountId)}>
                    {pulling === account.accountId ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
                    {pulling === account.accountId ? "Pulling..." : "Pull feedback now"}
                  </button>
                )}
                <button className="btn danger" type="button" disabled={removing === account.accountId} onClick={() => void remove(account.accountId)}>
                  {removing === account.accountId ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : <p className="subtle">No account is connected yet.</p>}
      <PipedreamConnectButton
        orgId={orgId}
        integrationId={integrationId}
        initiallyConnected={accounts.length > 0}
        allowAdditionalAccount
        onConnected={() => {
          onConnectionStateChange?.("Connected");
          void refresh();
        }}
      />
      {pullNotice && <p className="integration-import succeeded" role="status"><Check size={13} />{pullNotice}</p>}
      {error && <p className="integration-import failed" role="status">{error}</p>}
    </div>
  );
}
