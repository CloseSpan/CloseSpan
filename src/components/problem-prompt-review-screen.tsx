"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Check, CircleAlert } from "lucide-react";
import type { ProblemPromptReview } from "@/lib/problem-prompt-review";
import {
  issueProgress, requirementNeedsReview,
  type IssueExecutionSummary,
} from "@/lib/issue-lifecycle";
import styles from "./issue-detail.module.css";
import type { IssueWorkspaceContext } from "@/lib/issue-workspace-context";
import type { IssueConversationView } from "@/lib/issue-conversation";
import type { IssueResultReviewState } from "@/lib/issue-result-review";
import { IssueConversation, type ScenarioCheck } from "./issue-conversation";
import { IssueResultReview } from "./issue-result-review";

export interface ProblemPromptReviewScreenProps {
  problemId: string;
  title: string;
  expectedBehavior: string;
  reportCount?: number;
  execution?: IssueExecutionSummary | null;
  review: ProblemPromptReview | null;
  currentPromptHash: string | null;
  currentPromptStatus?: string | null;
  canReview: boolean;
  preparationEnabled: boolean;
  demo: boolean;
  presentationDemo?: boolean;
  approvalId: string | null;
  runStatus: string | null;
  storageReady?: boolean;
  canManage?: boolean;
  closed?: boolean;
  issueContext?: IssueWorkspaceContext;
  conversation?: IssueConversationView;
  resultReview?: IssueResultReviewState;
  scenarioCheck?: ScenarioCheck | null;
  discussionDisabledReason?: string;
}

export function ProblemPromptReviewScreen(props: ProblemPromptReviewScreenProps) {
  const router = useRouter();
  const [feedback, setFeedback] = useState("");
  const [requestingChanges, setRequestingChanges] = useState(false);
  const feedbackInput = useRef<HTMLTextAreaElement>(null);
  const changesButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const review = props.review;
  const current = Boolean(review?.promptHash && review.promptHash === props.currentPromptHash);
  const requirementReady = requirementNeedsReview(props);
  const showDecision = requirementReady && !props.approvalId && !props.execution?.current;
  const showSampleDecision = props.presentationDemo && !props.approvalId && !props.execution?.current
    && requirementNeedsReview({ ...props, presentationDemo: false, demo: false, preparationEnabled: true });
  const progress = issueProgress(props);
  const execution = props.execution;
  const resultChangesRequested = props.resultReview?.latestDecision?.current && props.resultReview.latestDecision.decision === "changes";
  const finalApproval = !resultChangesRequested && !props.closed && !props.demo && !props.presentationDemo && execution?.current && execution.approval?.compatible
    && (execution.approval.status === "Pending" || execution.approval.attempt === "Failed")
    ? execution.approval : null;
  const approvalHref = finalApproval
    ? `/approvals?approval=${encodeURIComponent(finalApproval.id)}`
    : props.approvalId && !props.closed && !props.demo && !props.presentationDemo
      ? `/approvals?approval=${encodeURIComponent(props.approvalId)}` : null;
  const currentStory = current && review?.userStory;
  const expectedBehavior = currentStory || props.expectedBehavior
    || "The expected outcome is still being prepared from the reports.";
  const placeholderBehavior = !currentStory && /^For the reported scenario, users (?:can complete |receive the complete expected result)/.test(expectedBehavior);
  const expectedExcerpt = textExcerpt(placeholderBehavior ? "Expected behavior is not yet defined." : expectedBehavior);
  const resultExcerpt = textExcerpt(execution?.summary ?? "");
  const contextHref = `/problems/${encodeURIComponent(props.problemId)}/reports`;
  const unresolvedCriteria = execution?.criteria.filter((criterion) => criterion.status !== "Passed") ?? [];
  const nextSection = execution?.current
    ? { href: "#issue-result", label: props.closed ? "View result" : "Review result" }
    : showDecision || showSampleDecision
      ? { href: "#expected-behavior", label: "Review expected behavior" }
      : approvalHref && props.canManage
        ? { href: "#issue-approval", label: "Review coding run" }
        : null;

  useEffect(() => {
    if (requestingChanges) feedbackInput.current?.focus();
  }, [requestingChanges]);

  useEffect(() => {
    if (!progress.refreshing) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 8000);
    return () => window.clearInterval(interval);
  }, [progress.refreshing, router]);

  async function decide(decision: "confirm" | "changes") {
    if (props.presentationDemo || !review?.promptHash || !showDecision || !props.canReview || busy) return;
    if (decision === "changes" && !feedback.trim()) { setError("Describe what needs to change."); return; }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/problems/${encodeURIComponent(props.problemId)}/prompt-review`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ decision, feedback: decision === "changes" ? feedback : "", version: review.version, promptHash: review.promptHash }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Your review could not be saved. Try again.");
      setFeedback("");
      setRequestingChanges(false);
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your review could not be saved. Try again."); }
    finally { setBusy(false); }
  }

  return <div className={`${styles.page} ${props.conversation ? styles.workspace : ""}`}>
    <Link className={`text-link ${styles.back}`} href="/problems"><ArrowLeft size={14} aria-hidden="true" /> Issues</Link>
    <header className={`page-head ${styles.heading}`}>
      <h1>{props.title}</h1>
      <span className={`badge ${resultChangesRequested || progress.tone === "attention" ? "medium" : progress.tone === "success" ? "success" : ""}`}>{resultChangesRequested ? "Changes requested" : progress.label}</span>
    </header>
    {props.presentationDemo && <span className="badge">Demo · sample data</span>}
    {(nextSection || props.conversation) && <nav className={styles.quickActions} aria-label="Issue actions">
      {nextSection && <a className="btn" href={nextSection.href}>{nextSection.label}</a>}
      {props.conversation && <a className="text-link" href="#issue-discussion">Discuss with CloseSpan</a>}
    </nav>}

    <div className={props.conversation ? styles.workspaceGrid : undefined}>
    <div className={styles.issueContent}>
    <section className={styles.progress} aria-label="Issue progress">
      <p className={styles.progressMessage} role="status">
        {progress.tone === "attention" && <CircleAlert size={16} aria-hidden="true" />}
        {resultChangesRequested ? "Changes requested. A follow-up coding run needs administrator approval." : progress.detail}
      </p>
    </section>

    {props.issueContext && <section className={styles.section} aria-labelledby="issue-context-heading">
      <div className={styles.sectionHeading}><h2 id="issue-context-heading">The problem</h2>
        <Link className={`text-link ${styles.sourceLink}`} href={contextHref}>{props.issueContext.reportCount} {props.issueContext.reportCount === 1 ? "report" : "reports"}{props.issueContext.sources.length > 0 ? ` · ${props.issueContext.sources.join(", ")}` : ""}</Link>
      </div>
      <p className={styles.body}>{textExcerpt(props.issueContext.summary || props.title).text}</p>
      <p className={styles.verification}>
        <span className={`badge ${props.issueContext.verification?.state === "passed" ? "success" : props.issueContext.verification?.state === "failed" ? "medium" : ""}`}>{props.issueContext.verification?.label ?? "Not yet verified"}</span>
        {props.issueContext.verification?.summary && <span>{textExcerpt(props.issueContext.verification.summary).text}</span>}
      </p>
    </section>}

    <section id="expected-behavior" tabIndex={-1} className={styles.section} aria-labelledby="issue-expected-heading">
      <h2 id="issue-expected-heading">Expected behavior</h2>
      <p className={styles.body}>{expectedExcerpt.text}</p>
      {(expectedExcerpt.shortened || placeholderBehavior) && <Link className="text-link" href={`${contextHref}#expected-behavior`}>{placeholderBehavior ? "View draft requirement" : "Full expected behavior"}</Link>}
      {!execution && Boolean(props.issueContext?.criteria.length) && <ul className={styles.expectedCriteria} aria-label="Expected outcomes">
        {props.issueContext!.criteria.map((criterion) => <li key={criterion.id}>{criterion.statement}</li>)}
      </ul>}
      {current && review?.confirmedAt && <p className={styles.confirmed}><Check size={15} aria-hidden="true" /> Requirement confirmed</p>}
      {showSampleDecision && <div className={styles.actions}>
        <button className="btn primary" type="button" disabled>Confirm</button>
        <button className="btn" type="button" disabled>Needs changes</button>
      </div>}
      {showDecision && <div className={styles.decision}>
        <p className={styles.note}>The requirement check passed. This is not a live application test.</p>
        {props.canReview ? <div>
          {!requestingChanges && <div className={styles.actions}>
            <button className="btn primary" type="button" disabled={busy} onClick={() => void decide("confirm")}>{busy ? "Saving…" : "Confirm"}</button>
            <button ref={changesButton} className="btn" type="button" disabled={busy} onClick={() => setRequestingChanges(true)}>Needs changes</button>
          </div>}
          {requestingChanges && <form onSubmit={(event) => { event.preventDefault(); void decide("changes"); }}>
            <label className="field">What needs to change?
              <textarea ref={feedbackInput} value={feedback} onChange={(event) => setFeedback(event.target.value)} maxLength={1000} rows={3}
                required disabled={busy} placeholder="Describe the outcome you need." />
            </label>
            <div className={styles.actions}>
              <button className="btn primary" type="submit" disabled={busy || !feedback.trim()}>{busy ? "Saving…" : "Send feedback"}</button>
              <button className="btn" type="button" disabled={busy} onClick={() => {
                setRequestingChanges(false);
                setError(null);
                requestAnimationFrame(() => changesButton.current?.focus());
              }}>Cancel</button>
            </div>
          </form>}
          <p className={styles.note}>Confirm saves the requirement. It does not approve coding, merge, or deployment.</p>
        </div> : <p className={styles.note}>A workspace contributor or administrator can confirm this requirement.</p>}
      </div>}
      {error && <p className="toast error" role="alert">{error}</p>}
    </section>

    {execution && <section id="issue-result" tabIndex={-1} className={styles.section} aria-labelledby="issue-result-heading">
      <div className={styles.sectionHeading}><h2 id="issue-result-heading">{execution.current ? "The result" : "Previous result"}</h2>
        {execution.current && execution.previewUrl && !props.presentationDemo && <a className="btn" href={execution.previewUrl} target="_blank" rel="noreferrer">Open preview <ArrowUpRight size={14} aria-hidden="true" /></a>}
      </div>
      {!execution.current && <p className={styles.notice}>This result belongs to an earlier version. It does not validate the current issue.</p>}
      {execution.summary && <p className={styles.body}>{resultExcerpt.text}</p>}
      {resultExcerpt.shortened && <Link className="text-link" href={`${contextHref}#implementation-result`}>Full result summary</Link>}
      <dl className={styles.checks}>
        {execution.checks.map((check) => <div key={check.label}><dt>{check.label}</dt><dd className={execution.current ? styles[check.state] : undefined}>{check.value}</dd></div>)}
        <div><dt>Code review</dt><dd>{execution.codeReview === "Approved" ? "Approved for the recorded change" : execution.codeReview ?? "Not completed"}</dd></div>
      </dl>
      {!execution.liveAppPassed && <p className={styles.note}>A live application test has not passed for the current issue.</p>}
      {execution.releaseCheck && <div className={execution.releaseCheck.status === "Failed" ? styles.notice : styles.note}>
        <strong>{execution.releaseCheck.current ? "Release check" : "Earlier release check"}: {execution.releaseCheck.status}</strong>
        {execution.releaseCheck.status === "Failed" && <p>{execution.releaseCheck.evidence}</p>}
        {!execution.releaseCheck.current && <p>This check belongs to a different requirement version.</p>}
      </div>}
      {execution.previewUrl && execution.current && !props.presentationDemo && <p className={styles.note}>The preview is temporary and may expire.</p>}
      {unresolvedCriteria.length > 0 && <ul className={styles.criteria} aria-label="Unresolved behavior checks">
        {unresolvedCriteria.map((criterion) => <li key={criterion.id}><span>{criterion.statement}</span><span className={styles.note}>{criterion.status}</span></li>)}
      </ul>}
      {execution.remainingRisks.length > 0 && <div className={styles.followUp}><h3>Remaining risks</h3><ul>{execution.remainingRisks.map((risk) => <li key={risk}>{risk}</li>)}</ul></div>}
      {execution.manualChecks.length > 0 && <div className={styles.followUp}><h3>Still needs a person to check</h3><ul>{execution.manualChecks.map((check) => <li key={check}>{check}</li>)}</ul></div>}
      {execution.pullRequestUrl && !props.presentationDemo && <a className="text-link" href={execution.pullRequestUrl} target="_blank" rel="noreferrer">View proposed changes <ArrowUpRight size={14} aria-hidden="true" /></a>}
      {execution.current && props.resultReview && !props.closed && <IssueResultReview problemId={props.problemId} initial={props.resultReview}
        canReview={props.canReview} canManage={Boolean(props.canManage)} demo={Boolean(props.demo || props.presentationDemo)} />}
    </section>}

    {approvalHref && <section id="issue-approval" tabIndex={-1} className={styles.section} aria-labelledby="issue-next-heading">
      <h2 id="issue-next-heading">{finalApproval ? finalApproval.action === "deploy" ? "Review deployment" : "Human merge" : "Implementation approval"}</h2>
      <p className={styles.body}>{finalApproval ? "Review the result and any remaining risks before approving the final action." : "One coding run is waiting for approval."}</p>
      {finalApproval && (finalApproval.autoDeploy || finalApproval.action === "deploy") && <p className={styles.notice}>{finalApproval.action === "deploy" ? "Approving this action deploys to production." : "Merging this change also deploys to production."}</p>}
      {props.canManage ? <Link className="btn primary" href={approvalHref}>{finalApproval ? finalApproval.action === "deploy" ? "Review deployment" : "Review merge" : "Review coding run"}</Link>
        : <p className={styles.note}>A workspace administrator can approve this action.</p>}
    </section>}

    {(!props.issueContext || (props.canManage && !props.presentationDemo)) && <footer className={styles.footer}>
      {!props.issueContext && <Link className="text-link" href={contextHref}>Original reports{props.reportCount ? ` (${props.reportCount})` : ""}</Link>}
      {props.canManage && !props.presentationDemo && <Link className="text-link" href={`/admin/problems/${encodeURIComponent(props.problemId)}`}>Diagnostics</Link>}
    </footer>}
    </div>
    {props.conversation && <div id="issue-discussion" tabIndex={-1} className={styles.conversationColumn}><IssueConversation key={props.problemId} problemId={props.problemId} initial={props.conversation}
      currentPromptHash={props.currentPromptHash} canDiscuss={props.canReview && !props.closed}
      disabledReason={props.discussionDisabledReason}
      canRevise={showDecision} reviewVersion={review?.version}
      canTest={props.preparationEnabled && !props.closed && Boolean(props.currentPromptHash) && props.currentPromptStatus !== "Approved" && !props.approvalId && !props.execution?.current}
      demo={Boolean(props.demo || props.presentationDemo)} initialCheck={props.scenarioCheck} sampleOutcome={expectedExcerpt.text} sampleHasResult={Boolean(execution?.current)} /></div>}
    </div>
  </div>;
}

/** A labeled excerpt links to the complete source; risk and manual-check copy is never shortened. */
function textExcerpt(value: string): { text: string; shortened: boolean } {
  if (value.length <= 320) return { text: value, shortened: false };
  const sentence = value.match(/^.*?[.!?](?:\s|$)/s)?.[0]?.trim();
  if (sentence && sentence.length <= 320) return { text: sentence, shortened: sentence.length < value.length };
  const prefix = value.slice(0, 320);
  const boundary = prefix.lastIndexOf(" ");
  return { text: `${prefix.slice(0, boundary > 200 ? boundary : 320).trimEnd()}…`, shortened: true };
}
