"use client";

import { useRef, useState } from "react";
import { Unplug } from "lucide-react";

export function DisconnectIntegrationButton({ orgId, provider, endpoint, onDisconnected }: {
  orgId: string;
  provider: string;
  endpoint: string;
  onDisconnected: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);

  async function disconnect() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "DELETE",
        headers: {
          "x-org-id": orgId,
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Disconnect failed. Try again.");
      onDisconnected();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Disconnect failed. Try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="settings-connection-disconnect">
      {confirming ? <>
        <strong>Disconnect {provider}?</strong>
        <p>CloseSpan will stop using this connection. Previously imported feedback will stay in your workspace.</p>
        <div className="settings-connection-disconnect-actions">
          <button className="btn" type="button" disabled={busy} onClick={() => { setConfirming(false); setError(null); }}>Cancel</button>
          <button className="btn danger" type="button" disabled={busy} onClick={() => void disconnect()}>{busy ? "Disconnecting…" : "Confirm disconnect"}</button>
        </div>
      </> : <button className="btn danger" type="button" onClick={() => setConfirming(true)}><Unplug size={15} aria-hidden="true" />Disconnect {provider}</button>}
      {error && <p className="integration-import failed" role="alert">{error}</p>}
    </div>
  );
}
