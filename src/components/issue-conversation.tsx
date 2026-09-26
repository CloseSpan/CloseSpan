"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, MessageSquare, FlaskConical } from "lucide-react";
import type { IssueConversationProposal, IssueConversationView } from "@/lib/issue-conversation";
import styles from "./issue-conversation.module.css";

export interface ScenarioCheck {
  verdict: "Passed" | "Needs revision";
  summary: string;
  changes: string[];
  promptHash: string;
}

export interface IssueConversationProps {
  problemId: string;
  initial: IssueConversationView;
  currentPromptHash: string | null;
  canDiscuss: boolean;
  canRevise: boolean;
  canTest: boolean;
  demo: boolean;
  initialCheck?: ScenarioCheck | null;
  sampleOutcome?: string;
  sampleHasResult?: boolean;
  disabledReason?: string;
  reviewVersion?: number;
}

/** One issue, one conversation. A scenario check never stands in for a runtime test. */
export function IssueConversation({ problemId, initial, currentPromptHash, canDiscuss, canRevise, canTest, demo, initialCheck, sampleOutcome, sampleHasResult, disabledReason, reviewVersion }: IssueConversationProps) {
  const router = useRouter();
  const [conversation, setConversation] = useState(initial);
  const [serverConversation, setServerConversation] = useState(initial);
  const [mode, setMode] = useState<"discuss" | "scenario">("discuss");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [check, setCheck] = useState<ScenarioCheck | null>(initialCheck ?? null);
  const [serverCheck, setServerCheck] = useState(initialCheck);
  const [scenarioPending, setScenarioPending] = useState(false);
  const request = useRef<{ message: string; key: string } | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const endpoint = `/api/problems/${encodeURIComponent(problemId)}`;
  const readOnly = demo || Boolean(disabledReason) || !canDiscuss || !conversation.storageReady;
  const sending = busy || conversation.pending || scenarioPending;

  if (serverConversation !== initial) { setServerConversation(initial); setConversation(initial); }
  if (serverCheck !== initialCheck) { setServerCheck(initialCheck); setCheck(initialCheck ?? null); }
  useEffect(() => {
    if (demo || !conversation.storageReady || !currentPromptHash) return;
    const controller = new AbortController();
    let timer: number | undefined;
    async function refreshScenario() {
      let retry = scenarioPending;
      try {
        const response = await fetch(`${endpoint}/scenario-check`, { signal: controller.signal });
        if (!response.ok) {
          if ([401, 403, 404].includes(response.status)) { retry = false; setScenarioPending(false); setError("Refresh this issue to check your access."); }
          return;
        }
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (result.currentPromptHash !== currentPromptHash) { retry = false; setScenarioPending(false); return; }
        retry = result.check?.status === "processing";
        setScenarioPending(result.check?.status === "processing");
        if (result.check?.status === "completed" && result.check.promptEvaluation) {
          setCheck(result.check.promptEvaluation);
          if (scenarioPending) setNotice("Scenario checked against the requirement. No application code was run.");
        }
        if (result.check?.status === "failed") setError(result.check.notice ?? "The scenario check could not be completed.");
      } catch {
        if (!controller.signal.aborted && scenarioPending) setNotice("Connection interrupted. Checking the saved scenario status…");
      } finally {
        if (retry && !controller.signal.aborted) timer = window.setTimeout(() => void refreshScenario(), 3000);
      }
    }
    void refreshScenario();
    return () => { controller.abort(); if (timer) window.clearTimeout(timer); };
  }, [demo, conversation.storageReady, currentPromptHash, endpoint, scenarioPending]);
  useEffect(() => {
    if (!conversation.pending || demo) return;
    const controller = new AbortController();
    const interval = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch(`${endpoint}/conversation`, { signal: controller.signal });
        if (!response.ok) return;
        const next: IssueConversationView = await response.json();
        if (!controller.signal.aborted) setConversation(next);
      } catch { /* Keep the saved thread visible; the next poll can recover. */ }
    }, 3000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [conversation.pending, demo, endpoint]);

  async function send() {
    const content = message.trim();
    if (!content || sending || readOnly || (mode === "scenario" && !canTest)) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const requestContent = `${mode}:${currentPromptHash}:${content}`;
      if (!request.current || request.current.message !== requestContent) {
        request.current = { message: requestContent, key: crypto.randomUUID() };
      }
      const response = await fetch(`${endpoint}/${mode === "discuss" ? "conversation" : "scenario-check"}`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": request.current.key },
        body: JSON.stringify(mode === "discuss" ? { message: content } : { userStory: content, currentPromptHash }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "CloseSpan could not respond. Try again.");
      if (mode === "discuss") {
        setConversation(result);
        if (result.status === "failed") {
          request.current = null; // A recorded terminal failure can be retried as a new request.
          throw new Error(result.notice ?? "CloseSpan could not respond. Your message is saved.");
        }
        setMessage("");
      } else {
        if (result.status === "failed") { request.current = null; throw new Error(result.notice ?? "The scenario check could not be completed."); }
        if (result.status === "processing") {
          setScenarioPending(true);
          setNotice("Checking the scenario… You can return to this issue when it is ready.");
        } else {
          setCheck(result.promptEvaluation);
          setNotice("Scenario checked against the requirement. No application code was run.");
          router.refresh();
        }
      }
      request.current = null;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "CloseSpan could not respond. Try again."); }
    finally { setBusy(false); }
  }

  async function apply(proposal: IssueConversationProposal) {
    if (readOnly || !canRevise || reviewVersion === undefined || sending || proposal.currentPromptHash !== currentPromptHash) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`${endpoint}/prompt-review`, {
        method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ decision: "changes", feedback: proposal.summary, version: reviewVersion, promptHash: proposal.currentPromptHash }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The requirement could not be updated.");
      setNotice("Change requested. CloseSpan will update and check the requirement in the background. No coding run was approved.");
      setCheck(null);
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The requirement could not be updated."); }
    finally { setBusy(false); }
  }

  function suggest(value: string) { setMode("discuss"); setMessage(value); field.current?.focus(); }
  const currentCheck = check?.promptHash === currentPromptHash ? check : null;
  return <aside className={styles.panel} aria-labelledby="issue-conversation-heading">
    <header className={styles.header}><h2 id="issue-conversation-heading">CloseSpan</h2><span>Issue conversation</span></header>
    <div className={styles.thread} role="log" aria-label="Conversation with CloseSpan" aria-live="polite" aria-relevant="additions text">
      {demo && sampleOutcome && conversation.messages.length === 0 ? <>
        <article className={styles.message} data-role="user"><span className={styles.author}>Sample question</span><p>What should I check?</p></article>
        <article className={styles.message} data-role="assistant"><span className={styles.author}>CloseSpan · sample response</span>
          <p>{sampleOutcome}</p><p>{sampleHasResult ? "Try this behavior in the updated app. Then choose This works or describe what still needs to change. Merging stays a separate decision." : "Tell me what you expect to happen, and we can refine the requirement before approving the work."}</p>
        </article>
      </> : conversation.messages.length === 0 && <div className={styles.intro}>
        <MessageSquare size={20} aria-hidden="true" />
        <h3>Let’s get the outcome right.</h3>
        <p>Discuss the reports, clarify what should happen, or check a scenario.</p>
        {!readOnly && <div className={styles.suggestions}>
          <button type="button" onClick={() => suggest("What do we know about this issue, and what is still unverified?")}>What do we know?</button>
          <button type="button" onClick={() => suggest("Help me clarify the expected behavior and any edge cases.")}>Clarify the outcome</button>
        </div>}
      </div>}
      {conversation.messages.map((entry) => <article className={styles.message} data-role={entry.role} key={entry.id}>
        <span className={styles.author}>{entry.role === "user" ? "Team" : "CloseSpan"}</span>
        <p>{entry.content}</p>
        {entry.status === "failed" && <span className={styles.muted}>Response unavailable</span>}
        {entry.proposal && <div className={styles.proposal}>
          <strong>Suggested requirement update</strong><p>{entry.proposal.summary}</p>
          {entry.proposal.currentPromptHash === currentPromptHash && canRevise && reviewVersion !== undefined && !readOnly
            ? <button className="btn" type="button" disabled={sending} onClick={() => void apply(entry.proposal!)}>Request this change</button>
            : <span className={styles.muted}>{entry.proposal.currentPromptHash !== currentPromptHash ? "An earlier requirement version" : "Changes can be requested when the requirement is ready for review."}</span>}
        </div>}
      </article>)}
      {conversation.pending && <p className={styles.muted}>CloseSpan is responding…</p>}
    </div>
    {currentCheck && <section className={styles.check} aria-label="Scenario check result">
      <strong>{currentCheck.verdict === "Passed" ? "Scenario covered" : "Requirement needs changes"}</strong>
      <p>{currentCheck.summary}</p>
      {currentCheck.changes.length > 0 && <ul>{currentCheck.changes.map((change, index) => <li key={index}>{change}</li>)}</ul>}
      <span className={styles.muted}>Requirement check · not a live application test</span>
    </section>}
    {readOnly ? <p className={styles.readOnly}>{demo ? "Read-only demo. Conversations and tests are available in a live workspace." : disabledReason || (!conversation.storageReady ? "Conversation setup is pending." : "A contributor or administrator can join this conversation.")}</p>
      : <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <div className={styles.modes} role="group" aria-label="Conversation action">
          <button type="button" aria-pressed={mode === "discuss"} onClick={() => { setMode("discuss"); setError(null); }}><MessageSquare size={14} aria-hidden="true" />Discuss</button>
          <button type="button" aria-pressed={mode === "scenario"} disabled={!canTest} onClick={() => { setMode("scenario"); setError(null); }}><FlaskConical size={14} aria-hidden="true" />Check scenario</button>
        </div>
        <label className={styles.composerField} data-field-shell>
          <span className="sr-only">{mode === "discuss" ? "Message CloseSpan" : "Scenario to check"}</span>
          <textarea ref={field} className="neumorphic-composite-field" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} rows={3} disabled={sending}
            placeholder={mode === "discuss" ? "Ask or clarify anything about this issue…" : "When I… I expect…"} />
          <button className={styles.send} type="submit" disabled={sending || !message.trim()} aria-label={mode === "discuss" ? "Send message" : "Check scenario"}>{sending ? "…" : <ArrowUp size={16} aria-hidden="true" />}</button>
        </label>
        <p className={styles.muted}>{mode === "scenario" ? "Checks the requirement—not the running app." : "Discussion does not authorize coding or merging."}</p>
      </form>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!demo && (notice || conversation.notice) && <p className={styles.readOnly} role="status">{notice || conversation.notice}</p>}
  </aside>;
}
