"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, LoaderCircle, RefreshCw, Server, Unplug } from "lucide-react";
import type { IntegrationConnectionState } from "@/lib/integration-client";
import type { DiscordGuildChannel } from "@/lib/discord-api";
import type { DiscordInstallation, DiscordIntakeMode } from "@/lib/discord-app-repository";

interface DiscordStatus {
  configured: boolean;
  interactionsConfigured: boolean;
  gatewayConfigured: boolean;
  discordInstallation: DiscordInstallation | null;
}

function requestHeaders(orgId: string, mutation = false): HeadersInit {
  return {
    "x-org-id": orgId,
    "x-request-id": crypto.randomUUID(),
    ...(mutation ? { "idempotency-key": crypto.randomUUID() } : {}),
    ...(mutation ? { "Content-Type": "application/json" } : {}),
  };
}

async function json<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(payload?.error || `Discord request failed with HTTP ${response.status}.`);
  return payload as T;
}

export function DiscordConnectionManager({
  orgId,
  onConnectionStateChange,
}: {
  orgId: string;
  onConnectionStateChange?: (state: IntegrationConnectionState) => void;
}) {
  const [status, setStatus] = useState<DiscordStatus | null>(null);
  const [channels, setChannels] = useState<DiscordGuildChannel[]>([]);
  const [mode, setMode] = useState<DiscordIntakeMode>("commands");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<"load" | "install" | "save" | "disconnect" | null>("load");
  const [error, setError] = useState<string | null>(null);
  const installation = status?.discordInstallation;

  const load = useCallback(async () => {
    setBusy("load"); setError(null);
    try {
      const next = await json<DiscordStatus>(await fetch("/api/integrations/discord/status", { headers: requestHeaders(orgId), cache: "no-store" }));
      setStatus(next);
      setMode(next.discordInstallation?.intakeMode ?? "commands");
      setSelected(next.discordInstallation?.monitoredChannelIds ?? []);
      onConnectionStateChange?.(next.discordInstallation?.state === "Connected" ? "Connected" : "Disconnected");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Discord status could not be loaded."); }
    finally { setBusy(null); }
  }, [onConnectionStateChange, orgId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);
  useEffect(() => {
    if (!installation || mode !== "channels" || channels.length) return;
    void (async () => {
      try {
        const payload = await json<{ channels: DiscordGuildChannel[] }>(await fetch("/api/integrations/discord/channels", { headers: requestHeaders(orgId), cache: "no-store" }));
        setChannels(payload.channels);
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Discord channels could not be loaded."); }
    })();
  }, [channels.length, installation, mode, orgId]);

  const dirty = useMemo(() => installation && (
    mode !== installation.intakeMode || [...selected].sort().join(",") !== [...installation.monitoredChannelIds].sort().join(",")
  ), [installation, mode, selected]);

  async function install() {
    setBusy("install"); setError(null);
    try {
      const payload = await json<{ installUrl: string }>(await fetch("/api/integrations/discord/install", { method: "POST", headers: requestHeaders(orgId, true), body: "{}" }));
      window.location.assign(payload.installUrl);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Discord installation could not start."); setBusy(null); }
  }

  async function save() {
    setBusy("save"); setError(null);
    try {
      const payload = await json<{ discordInstallation: DiscordInstallation }>(await fetch("/api/integrations/discord/settings", {
        method: "PATCH", headers: requestHeaders(orgId, true), body: JSON.stringify({ intakeMode: mode, monitoredChannelIds: mode === "channels" ? selected : [] }),
      }));
      setStatus((current) => current ? { ...current, discordInstallation: payload.discordInstallation } : current);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Discord settings could not be saved."); }
    finally { setBusy(null); }
  }

  async function disconnect() {
    setBusy("disconnect"); setError(null);
    try {
      await json(await fetch("/api/integrations/discord/status", { method: "DELETE", headers: requestHeaders(orgId, true), body: "{}" }));
      setStatus((current) => current ? { ...current, discordInstallation: null } : current);
      setChannels([]); setSelected([]); setMode("commands");
      onConnectionStateChange?.("Disconnected");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Discord could not be disconnected."); }
    finally { setBusy(null); }
  }

  if (busy === "load" && !status) return <div className="discord-manager-state"><LoaderCircle className="spin" size={18} /><span>Checking Discord setup…</span></div>;
  if (!status?.configured) return <div className="discord-manager-alert" role="alert"><AlertTriangle size={17} /><p><strong>Discord app configuration required</strong><span>Add the Discord application credentials before connecting a server.</span></p></div>;
  if (!installation || installation.state !== "Connected") return (
    <div className="discord-connection-manager">
      <div className="discord-manager-summary"><Server size={19} /><p><strong>Connect one Discord server</strong><span>CloseSpan registers its own commands and asks for confirmation before recording feedback.</span></p></div>
      <button className="btn primary" type="button" disabled={Boolean(busy)} onClick={() => void install()}>{busy === "install" ? <><LoaderCircle className="spin" size={16} />Opening Discord…</> : "Add CloseSpan to Discord"}</button>
      {error && <p className="integration-import failed" role="alert"><AlertTriangle size={13} />{error}</p>}
    </div>
  );

  return (
    <div className="discord-connection-manager">
      <div className="discord-manager-summary connected"><Check size={18} /><p><strong>{installation.guildName || "Discord server"}</strong><span>CloseSpan bot installed · commands ready</span></p></div>
      {!status.interactionsConfigured && <div className="discord-manager-alert" role="alert"><AlertTriangle size={16} /><p><strong>Commands need one final setting</strong><span>Add the Discord public key and set the Interactions Endpoint URL.</span></p></div>}
      <fieldset className="discord-intake-modes">
        <legend>How CloseSpan should listen</legend>
        <label className={mode === "commands" ? "selected" : ""}><input type="radio" name="discord-intake" checked={mode === "commands"} onChange={() => setMode("commands")} /><span><strong>Commands only</strong><small>Members use /closespan report or Report to CloseSpan.</small></span></label>
        <label className={mode === "channels" ? "selected" : ""}><input type="radio" name="discord-intake" checked={mode === "channels"} onChange={() => setMode("channels")} /><span><strong>Selected channels</strong><small>Also filter ordinary conversation in approved community channels.</small></span></label>
      </fieldset>
      {mode === "channels" && (
        <div className="discord-channel-picker">
          {!status.gatewayConfigured && <div className="discord-manager-alert"><AlertTriangle size={16} /><p><strong>Listener worker required</strong><span>Enable Discord&apos;s Message Content Intent, then run the Gateway worker to monitor ordinary messages.</span></p></div>}
          <strong>Monitored channels</strong>
          {channels.length ? channels.map((channel) => (
            <label key={channel.id}><input type="checkbox" checked={selected.includes(channel.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, channel.id] : current.filter((id) => id !== channel.id))} /><span>#{channel.name}</span></label>
          )) : <div className="discord-manager-state"><LoaderCircle className="spin" size={16} /><span>Loading channels…</span></div>}
        </div>
      )}
      <div className="discord-manager-actions">
        <button className="btn primary" type="button" disabled={!dirty || Boolean(busy) || (mode === "channels" && !selected.length)} onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save listening mode"}</button>
        <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => void load()}><RefreshCw size={14} />Refresh</button>
        <button className="btn danger" type="button" disabled={Boolean(busy)} onClick={() => void disconnect()}><Unplug size={14} />{busy === "disconnect" ? "Disconnecting…" : "Disconnect"}</button>
      </div>
      {error && <p className="integration-import failed" role="alert"><AlertTriangle size={13} />{error}</p>}
    </div>
  );
}
