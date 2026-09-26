"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import type { IssueResultReviewState } from "@/lib/issue-result-review";
import styles from "./issue-detail.module.css";

export function IssueResultReview({ problemId, initial, canReview, canManage, demo }: {
  problemId: string; initial: IssueResultReviewState; canReview: boolean; canManage: boolean; demo: boolean;
}) {
  const router = useRouter();
  const [review, setReview] = useState(initial);
  const [serverReview, setServerReview] = useState(initial);
  const [feedback, setFeedback] = useState("");
  const [requestChanges, setRequestChanges] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRework, setConfirmRework] = useState(false);
  const [reworkNotice, setReworkNotice] = useState<string | null>(null);
  if (serverReview !== initial) { setServerReview(initial); setReview(initial); }
  const decision = review.latestDecision?.current ? review.latestDecision : null;

  async function authorizeRework() {
    if (demo || !canManage || !review.rework?.available || !review.binding || !decision || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/problems/${encodeURIComponent(problemId)}/result-review/rework`, {
        method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ ...review.binding, reviewId: decision.id, version: review.version }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The follow-up run could not be authorized.");
      setReview((current) => ({ ...current, canReview: false, unavailableReason: "A follow-up run has been authorized.",
        rework: { available: false, unavailableReason: null, runId: result.runId } }));
      setReworkNotice(result.warning ?? "Follow-up run authorized. CloseSpan will update the existing pull request.");
      setConfirmRework(false); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The follow-up run could not be authorized."); }
    finally { setBusy(false); }
  }

  async function decide(value: "accept" | "changes") {
    if (demo || !canReview || !review.canReview || !review.binding || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/problems/${encodeURIComponent(problemId)}/result-review`, {
        method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ ...review.binding, version: review.version, decision: value, feedback: value === "changes" ? feedback : "" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Your result review could not be saved.");
      setReview(result.review); setFeedback(""); setRequestChanges(false); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your result review could not be saved."); }
    finally { setBusy(false); }
  }

  return <div className={styles.resultDecision}>
    <h3>Does this solve the problem?</h3>
    {decision?.decision === "accept" && <p className={styles.confirmed}><Check size={15} aria-hidden="true" /> {decision.actorName} confirmed this result.</p>}
    {decision?.decision === "changes" && <div className={styles.notice}>
      <strong>Changes requested</strong><p>{decision.feedback}</p>
      <p>{canManage ? "Review this feedback before authorizing a follow-up run." : "An administrator can authorize a follow-up run."}</p>
    </div>}
    {review.latestDecision && !review.latestDecision.current && <p className={styles.note}>The result changed since the last review. Check this version again.</p>}
    {demo ? <div className={styles.actions}><button className="btn primary" disabled>This works</button><button className="btn" disabled>Needs changes</button></div>
      : review.canReview && canReview ? <>
        {requestChanges && <label className="field">What still needs to change?
          <textarea rows={3} maxLength={4000} value={feedback} disabled={busy} onChange={(event) => setFeedback(event.target.value)} placeholder="Describe what you tried and what should happen." />
        </label>}
        <div className={styles.actions}>
          {requestChanges ? <>
            <button className="btn primary" disabled={busy || !feedback.trim()} onClick={() => void decide("changes")}>{busy ? "Saving…" : "Send feedback"}</button>
            <button className="btn" disabled={busy} onClick={() => setRequestChanges(false)}>Cancel</button>
          </> : <>
            {!decision && <button className="btn primary" disabled={busy} onClick={() => void decide("accept")}>{busy ? "Saving…" : "This works"}</button>}
            <button className="btn" disabled={busy} onClick={() => setRequestChanges(true)}>Needs changes</button>
          </>}
        </div>
        <p className={styles.note}>Records your result review. Coding and merging need separate approval.</p>
      </> : <p className={styles.note}>{!review.storageReady ? "Result review setup is pending." : !canReview ? "A contributor or administrator can review the result." : review.unavailableReason ?? "A completed result is needed before review."}</p>}
    {!demo && canManage && decision?.decision === "changes" && review.rework?.available && <div className={styles.rework}>
      {confirmRework ? <>
        <p className={styles.body}>Start one coding run from commit <code>{review.binding?.commitSha.slice(0, 7)}</code>? It may incur model and sandbox costs. CloseSpan will address this feedback on the existing PR and keep the expected behavior unchanged. It will not merge.</p>
        <div className={styles.actions}><button className="btn primary" disabled={busy} onClick={() => void authorizeRework()}>{busy ? "Authorizing…" : "Approve and start follow-up"}</button>
          <button className="btn" disabled={busy} onClick={() => setConfirmRework(false)}>Cancel</button></div>
      </> : <button className="btn primary" onClick={() => setConfirmRework(true)}>Approve follow-up run</button>}
    </div>}
    {!demo && decision?.decision === "changes" && review.rework && !review.rework.available && review.rework.unavailableReason && <p className={styles.note}>{review.rework.unavailableReason}</p>}
    {reworkNotice && <p className={styles.note} role="status">{reworkNotice}</p>}
    {error && <p className="toast error" role="alert">{error}</p>}
  </div>;
}
