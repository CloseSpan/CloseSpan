"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Check, Copy, LoaderCircle, RefreshCw, Unplug } from "lucide-react";
import type { IntegrationConnectionState } from "@/lib/integration-client";
import styles from "./retell-connection-manager.module.css";

interface RetellStatus {
  configured: boolean; connected: boolean; canManage: boolean;
  keyHint: string | null; webhookUrl: string | null; lastImportAt: string | null;
}

export function RetellConnectionManager({ orgId, onConnectionStateChange, onImportComplete }: {
  orgId: string;
  onConnectionStateChange?: (state: IntegrationConnectionState) => void;
  onImportComplete?: (completedAt: string, imported: number) => void;
}) {
  const id = useId();
  const [status, setStatus] = useState<RetellStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [callId, setCallId] = useState("");
  const [busy, setBusy] = useState<string | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reload, setReload] = useState(0);
  const onChangeRef = useRef(onConnectionStateChange);
  useEffect(() => { onChangeRef.current = onConnectionStateChange; }, [onConnectionStateChange]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/integrations/retell", { headers: { "x-org-id": orgId }, cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Retell status could not be loaded.");
        setStatus(data);
        onChangeRef.current?.(data.connected ? "Connected" : "Disconnected");
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Retell status could not be loaded.");
      } finally { if (!controller.signal.aborted) setBusy(null); }
    })();
    return () => controller.abort();
  }, [orgId, reload]);

  async function act(action: "connect" | "disconnect" | "import", specific = false) {
    setBusy(action); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/integrations/retell${action === "import" ? "/import" : ""}`, {
        method: action === "disconnect" ? "DELETE" : "POST",
        headers: { "x-org-id": orgId, "Content-Type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(action === "connect" ? { apiKey } : specific ? { callId: callId.trim() } : {}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Retell could not complete this action.");
      if (action === "import") {
        setNotice(`${data.imported} imported · ${data.existing} already in inbox · ${data.skipped} not ready. Analysis follows when AI is configured.`);
        setStatus((current) => current ? { ...current, lastImportAt: data.completedAt } : current);
        onImportComplete?.(data.completedAt, data.imported);
      } else {
        setStatus(data); setApiKey(""); setCopied(false);
        onChangeRef.current?.(data.connected ? "Connected" : "Disconnected");
        setNotice(action === "connect" ? "Retell connected. Import recent calls to get started." : "Disconnected. Previously imported feedback is kept.");
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Retell could not complete this action."); }
    finally { setBusy(null); }
  }

  async function copyUrl() {
    try { await navigator.clipboard.writeText(status?.webhookUrl ?? ""); setCopied(true); }
    catch { setError("Could not copy the URL. Select and copy it below."); }
  }

  function connect(event: FormEvent) { event.preventDefault(); void act("connect"); }
  const disabled = Boolean(busy) || !status?.canManage || !status?.configured;
  return (
    <div className={styles.root} aria-busy={Boolean(busy)}>
      {busy === "load" && <p className={styles.message}><LoaderCircle className="spin" size={16} />Checking connection…</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!status && !busy && <button className="btn" type="button" onClick={() => { setError(null); setBusy("load"); setReload((value) => value + 1); }}>Try again</button>}
      {status && <>
        {!status.canManage && <p className={styles.hint}>Connection changes are available to administrators in a live workspace.</p>}
        {!status.configured && <p className={styles.hint}>Secure credential storage must be enabled before connecting Retell.</p>}
        {status.connected ? <>
          <p className={styles.message}><Check size={16} /><strong>Connected</strong><span className={styles.hint}>{status.keyHint}</span></p>
          <div className={styles.actions}>
            <button className="btn primary" type="button" disabled={disabled} onClick={() => void act("import")}><RefreshCw size={15} />{busy === "import" ? "Importing…" : "Import recent calls"}</button>
            <Link href="/feedback" className="btn">View feedback</Link>
          </div>
          <p className={styles.hint}>Checks the latest 25 calls. Only completed calls with analysis are imported.</p>
          {status.lastImportAt && <p className={styles.hint}>Last import {new Date(status.lastImportAt).toLocaleString()}</p>}
          <details className={styles.details}>
            <summary>Automatic imports</summary>
            <div className={styles.fields}>
              <p className={styles.hint}>Add this URL to Retell’s webhook settings for <code>call_analyzed</code>. Connect with the API key marked “webhook” in Retell.</p>
              <label htmlFor={`${id}-webhook`}>Webhook URL</label>
              <input id={`${id}-webhook`} className={styles.input} readOnly value={status.webhookUrl ?? ""} />
              <button className="btn" type="button" onClick={() => void copyUrl()}><Copy size={14} />{copied ? "Copied" : "Copy URL"}</button>
              {status.webhookUrl && /https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(status.webhookUrl) && <p className={styles.hint}>Retell cannot reach localhost. Automatic imports need a public HTTPS URL.</p>}
            </div>
          </details>
          <details className={styles.details}>
            <summary>Import a specific call</summary>
            <form className={styles.fields} onSubmit={(event) => { event.preventDefault(); void act("import", true); }}>
              <label htmlFor={`${id}-call`}>Retell call ID</label>
              <input id={`${id}-call`} className={styles.input} value={callId} onChange={(event) => setCallId(event.target.value)} placeholder="call_…" required disabled={disabled} maxLength={128} pattern="[A-Za-z0-9_\-]+" />
              <button className="btn" disabled={disabled || !callId.trim()}>Import call</button>
            </form>
          </details>
          <button className={`btn ${styles.disconnect}`} type="button" disabled={disabled} onClick={() => void act("disconnect")}><Unplug size={14} />{busy === "disconnect" ? "Disconnecting…" : "Disconnect"}</button>
        </> : <form className={styles.fields} onSubmit={connect}>
          <label htmlFor={`${id}-key`}>Retell API key</label>
          <input id={`${id}-key`} className={styles.input} type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} maxLength={512} required disabled={disabled} placeholder="Enter your API key" aria-describedby={`${id}-privacy`} />
          <p id={`${id}-privacy`} className={styles.hint}>Stored encrypted. CloseSpan reads calls only—no outbound calls or agent changes.</p>
          <button className="btn primary" type="submit" disabled={disabled || !apiKey.trim()}>{busy === "connect" ? "Connecting…" : "Connect Retell"}</button>
        </form>}
      </>}
      {notice && <p className={styles.hint} role="status">{notice}</p>}
    </div>
  );
}
