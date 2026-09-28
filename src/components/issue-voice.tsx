"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ExternalLink, Mic, MicOff, PhoneOff } from "lucide-react";
import type { WebCallSession } from "retell-client-js-sdk";
import { ISSUE_VOICE_DURATION_MS, voiceNotesDraft, type IssueVoiceAvailability, type IssueVoiceLine, type IssueVoiceLink } from "@/lib/issue-voice";
import styles from "./issue-voice.module.css";

type VoiceAttempt = {
  call: WebCallSession | null;
  ticket: string | null;
  captions: AbortController | null;
  cancellation: AbortController;
  serverError: string | null;
};

/* Local extension: preserve the neutral Attio panel and existing text composer.
   A labeled mic disclosure owns consent, connection, and stopping; nothing starts on mount.
   Captions remain readable, notes are drafts, and approval controls stay separate. */
export function IssueVoice({ problemId, disabled, onNotes, onActivityChange }: {
  problemId: string; disabled?: boolean; onNotes: (text: string) => void; onActivityChange?: (active: boolean) => void;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [availability, setAvailability] = useState<IssueVoiceAvailability | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "ended">("idle");
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [captionNotice, setCaptionNotice] = useState<string | null>(null);
  const [lines, setLines] = useState<IssueVoiceLine[]>([]);
  const [links, setLinks] = useState<IssueVoiceLink[]>([]);
  const attempt = useRef<VoiceAttempt | null>(null);
  const mounted = useRef(true);
  const startButton = useRef<HTMLButtonElement>(null);
  const endpoint = `/api/problems/${encodeURIComponent(problemId)}/voice`;
  const running = status === "connecting" || status === "live";

  useEffect(() => { onActivityChange?.(running); }, [running, onActivityChange]);

  useEffect(() => {
    if (!open || disabled) return;
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Voice is unavailable. You can continue in text.");
      setAvailability(result);
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [open, disabled, endpoint]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const session = attempt.current;
      if (!session) return;
      session.cancellation.abort();
      session.captions?.abort();
      void session.call?.end();
      const currentTicket = session.ticket;
      session.ticket = null;
      if (currentTicket) void fetch(endpoint, { method: "DELETE", keepalive: true,
        headers: { "Content-Type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ ticket: currentTicket }),
      }).catch(() => {});
    };
  }, [endpoint]);

  async function releaseSession(session: VoiceAttempt) {
    const currentTicket = session.ticket;
    session.ticket = null;
    if (!currentTicket) return;
    try {
      const response = await fetch(endpoint, { method: "DELETE", keepalive: true,
        headers: { "Content-Type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ ticket: currentTicket }),
      });
      if (!response.ok && mounted.current && attempt.current === session) setError("The call is disconnecting. It will end at the five-minute limit.");
    } catch { if (mounted.current && attempt.current === session) setError("Connection interrupted. The call will end at the five-minute limit."); }
  }

  function end(session: VoiceAttempt | null) {
    if (!session) return;
    session.cancellation.abort();
    session.captions?.abort();
    void session.call?.end();
    void releaseSession(session);
    if (mounted.current && attempt.current === session) { setStatus("ended"); setMuted(false); }
  }

  useEffect(() => { if (status === "ended") startButton.current?.focus(); }, [status]);

  // End locally as well as enforcing the duration at Retell. No decorative looping animation.
  useEffect(() => {
    if (status !== "live") return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      setElapsed(seconds);
      if (seconds >= ISSUE_VOICE_DURATION_MS / 1000) {
        const session = attempt.current;
        if (session) { session.cancellation.abort(); void session.call?.end(); }
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  async function captions(session: VoiceAttempt) {
    if (session.captions || !session.ticket) return;
    const controller = new AbortController();
    session.captions = controller;
    try {
      const response = await fetch(`${endpoint}/transcript`, { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ ticket: session.ticket }),
      });
      if (!response.ok || !response.body) throw new Error("Captions unavailable");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!controller.signal.aborted) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        if (buffer.length > 300_000) throw new Error("Captions unavailable");
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const message = JSON.parse(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          if (!mounted.current || attempt.current !== session || controller.signal.aborted) return;
          if (message.type === "transcript") setLines(message.lines);
          if (message.type === "unavailable") setCaptionNotice("Live captions are unavailable. You can still talk or use text below.");
          if (message.type === "ended") { end(session); return; }
        }
      }
    } catch {
      if (!controller.signal.aborted && mounted.current && attempt.current === session) setCaptionNotice("Live captions are unavailable. You can still talk or use text below.");
    }
  }

  async function start() {
    if ((attempt.current && !attempt.current.cancellation.signal.aborted) || disabled || !availability?.available) return;
    const session: VoiceAttempt = { call: null, ticket: null, captions: null, cancellation: new AbortController(), serverError: null };
    attempt.current = session;
    setStatus("connecting"); setError(null); setCaptionNotice(null); setLines([]); setLinks([]); setElapsed(0); setMuted(false);
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("Voice needs microphone access on HTTPS or localhost. You can continue in text.");
      // Request permission before creating a billable provider session; release the preflight mic immediately.
      const permission = await navigator.mediaDevices.getUserMedia({ audio: true });
      permission.getTracks().forEach((track) => track.stop());
      if (session.cancellation.signal.aborted || !mounted.current || attempt.current !== session) return;
      const { RetellClient } = await import("retell-client-js-sdk");
      if (session.cancellation.signal.aborted || !mounted.current || attempt.current !== session) return;
      const client = new RetellClient({
        // The SDK's control requests are narrowly proxied. This is NOT a Retell credential.
        key: "closespan-server-managed",
        fetch: async (input) => {
          const path = new URL(String(input)).pathname;
          if (path === "/v3/create-web-call") {
            const response = await fetch(endpoint, { method: "POST",
              headers: { "Content-Type": "application/json", "idempotency-key": crypto.randomUUID() },
              body: JSON.stringify({ consent: true }),
            });
            const result = await response.json();
            if (response.ok) {
              session.ticket = result.ticket;
              if (mounted.current && !session.cancellation.signal.aborted && attempt.current === session) setLinks(result.links ?? []);
              // If cancelled during creation, the SDK calls stopCall through the adapter below.
            } else if (typeof result.error === "string") {
              session.serverError = result.error.slice(0, 250);
            }
            return new Response(JSON.stringify(result), { status: response.status });
          }
          if (path.startsWith("/v2/stop-call/")) { await releaseSession(session); return new Response("{}"); }
          throw new Error("This voice action is not available.");
        },
      });
      session.call = client.createWebCall({ agent_id: "server-selected", transcript: false, hooks: {
        onStatus: (next) => {
          if (!mounted.current || session.cancellation.signal.aborted || attempt.current !== session) return;
          if (next === "live") { setStatus("live"); void captions(session); }
        },
        onEnd: () => {
          session.cancellation.abort();
          session.captions?.abort();
          void releaseSession(session);
          if (mounted.current && attempt.current === session) { setStatus("ended"); setMuted(false); }
        },
        onError: () => {
          if (mounted.current && !session.cancellation.signal.aborted && attempt.current === session) setError(session.serverError || "Voice could not connect. Check microphone access and try again, or continue in text.");
          end(session);
        },
      } });
      // Await connection while onError retains our sanitized server message.
      await session.call.ready;
    } catch (cause) {
      if (!mounted.current || session.cancellation.signal.aborted || attempt.current !== session) return;
      const denied = cause instanceof DOMException && ["NotAllowedError", "NotFoundError"].includes(cause.name);
      setError(denied ? "Allow microphone access to talk, or continue in text below." : "Voice could not connect. Try again, or continue in text below.");
      end(session);
    }
  }

  const notes = voiceNotesDraft(lines);
  return <section className={styles.voice} aria-label="Voice conversation">
    <button className={styles.toggle} type="button" disabled={disabled} aria-expanded={open} aria-controls={panelId}
      onClick={() => { if (!running) setOpen(!open); }}>
      <Mic size={16} aria-hidden="true" /> Talk about this issue
      {running && <span className={styles.liveLabel}>Active</span>}
    </button>
    {open && <div id={panelId} className={styles.body}>
      {!running && status !== "ended" && <p>Talk through the problem with CloseSpan’s AI assistant. Your microphone audio and this issue’s context are processed by Retell. Up to 5 minutes.</p>}
      {running ? <div className={styles.callBar}>
        <div className={styles.callState} role="status"><span className={styles.dot} />{status === "connecting" ? "Connecting…" : muted ? "Microphone muted" : "Voice connected"}</div>
        {status === "live" && <time className={styles.timer} aria-label={`${elapsed} seconds elapsed`}>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</time>}
        <div className={styles.actions}>
          {status === "live" && <button type="button" className={styles.iconButton} aria-label={muted ? "Unmute microphone" : "Mute microphone"} aria-pressed={muted}
            onClick={() => { if (muted) attempt.current?.call?.unmute(); else attempt.current?.call?.mute(); setMuted(!muted); }}>
            {muted ? <MicOff size={16} aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />}
          </button>}
          <button type="button" className={styles.endButton} onClick={() => end(attempt.current)}><PhoneOff size={16} aria-hidden="true" />{status === "connecting" ? "Cancel" : "End"}</button>
        </div>
      </div> : <div className={styles.actions}>
        <button ref={startButton} type="button" className="btn primary" disabled={!availability?.available || disabled} onClick={() => void start()}>
          <Mic size={15} aria-hidden="true" />{status === "ended" ? "Talk again" : "Start conversation"}
        </button>
        {status === "ended" && <span className={styles.ended} role="status">Conversation ended</span>}
      </div>}
      {!availability && !error && <p role="status">Checking voice availability…</p>}
      {availability?.reason && <p>{availability.reason}</p>}
      {lines.length > 0 && <div className={styles.transcript} role="log" aria-label="Live voice transcript" aria-live="off" tabIndex={0}>
        {lines.map((line) => <p key={line.id}><strong>{line.role === "user" ? "You" : "CloseSpan"}</strong>{line.content}</p>)}
      </div>}
      {captionNotice && <p role="status">{captionNotice}</p>}
      {status === "ended" && notes && <button type="button" className="btn" onClick={() => onNotes(notes)}>Use my notes in chat</button>}
      {links.length > 0 && <div className={styles.links}>{links.map((link) => <a key={link.href} href={link.href} target="_blank" rel="noreferrer">{link.label}<ExternalLink size={13} aria-hidden="true" /></a>)}</div>}
      <p className={styles.privacy}>Voice does not approve work or merge changes. Notes stay in this tab until you send them.</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>}
  </section>;
}
