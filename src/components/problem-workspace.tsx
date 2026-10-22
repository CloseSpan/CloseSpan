"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Download, History, LockKeyhole, Sparkles } from "lucide-react";
import { calculateImpact, type FeedbackItem, type ProductProblem } from "@/lib/domain";
import type { DemoState } from "@/lib/store";

/**
 * The evidence behind any issue: its statement and revenue reach, the
 * customer reports that support it, and how its impact score was derived.
 */
export function ProblemEvidence({ problem, feedbackItems: feedback }: { problem: ProductProblem; feedbackItems: FeedbackItem[] }) {
  const [showRationale, setShowRationale] = useState(false);
  const impact = calculateImpact(problem.impactFactors);
  const evidence = feedback.filter((item) => problem.feedbackIds.includes(item.id));
  const affectedAccounts = new Map<string, number>();
  for (const item of evidence) {
    const accountKey = item.customer.trim().toLocaleLowerCase() || item.id;
    affectedAccounts.set(
      accountKey,
      Math.max(affectedAccounts.get(accountKey) ?? 0, item.arr),
    );
  }
  const revenue = [...affectedAccounts.values()].reduce(
    (sum, accountRevenue) => sum + accountRevenue,
    0,
  );
  const evidenceConfidence = Math.round(problem.confidence * 100);

  return <div className="two-col section-gap" id="evidence"><div className="detail-stack problem-main-column">
      <section className="card"><div className="card-head"><h2>Problem intelligence</h2><span className="badge brand"><Sparkles size={12}/> AI summary · {evidenceConfidence}%</span></div><div className="card-body"><p className="summary">{problem.statement}</p><p className="subtle section-gap-sm">{problem.summary}</p><div className="grid cols-3 section-gap"><div><div className="metric-label">Affected revenue</div><strong>{revenue <= 0 ? "No revenue data" : Math.round(revenue) < 1000 ? `$${Math.round(revenue).toLocaleString("en-US")} ARR` : `$${Math.round(revenue / 1000)}k ARR`}</strong></div><div><div className="metric-label">Affected accounts</div><strong>{affectedAccounts.size} account{affectedAccounts.size === 1 ? "" : "s"}</strong></div><div><div className="metric-label">Evidence confidence</div><strong>{evidenceConfidence}%</strong></div></div></div></section>

      <section className="card"><div className="card-head"><div><h2>Supporting evidence</h2></div>{evidence.length > 0 && <button type="button" className="btn" aria-expanded={showRationale} onClick={() => setShowRationale((value) => !value)}>{showRationale ? "Hide rationale" : "Review membership"}</button>}</div><div className="card-body">{evidence.length === 0 && <p className="subtle">No customer reports are linked to this issue yet.</p>}{showRationale && <div className="callout membership-rationale"><div className="callout-title">Cluster membership rationale</div><p className="subtle">These {evidence.length} signal{evidence.length === 1 ? "" : "s"} support the same reviewed problem statement: {problem.statement} The current evidence confidence is {evidenceConfidence}%.</p></div>}{evidence.map((item) => <article className="evidence" key={item.id}><div className="split"><div className="evidence-meta"><span className="badge">{item.source}</span><strong>{item.customer}</strong><span>{item.observedAt}</span></div><span className="badge brand">{Math.round(item.confidence * 100)}% match</span></div><blockquote className="quote">“{item.quote}”</blockquote><div className="evidence-meta evidence-environment"><LockKeyhole size={11}/> PII scan complete · {item.environment}</div></article>)}</div></section>
    </div>

    <aside className="detail-stack">
      <section className="card"><div className="card-head"><h2>Impact score</h2><div className="score-ring" aria-label={`Impact score ${impact.score} out of 100`}><span>{impact.score}</span></div></div><div className="card-body">{problem.impactFactors.map((factor) => <div className="factor" key={factor.key}><span>{factor.label} · {factor.weight}%</span><div className="bar" role="meter" aria-label={`${factor.label} score`} aria-valuenow={factor.value} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${factor.value}%` }}/></div><strong>{factor.value}</strong></div>)}<div className="callout section-gap-sm"><div className="callout-title">Why this score</div><p className="subtle">{impact.explanation}</p></div><Link className="btn full-width section-gap-xs" href="/settings#priority">Configure weights</Link></div></section>
    </aside></div>;
}

export function ProblemHistory({ audit }: { audit: DemoState["audit"] }) {
  function summarizeAction(action: string) {
    return action
      .replace(/\bSHA-256 ([a-f0-9]{12})[a-f0-9]{52}\b/gi, "SHA $1…")
      .replace(/\b([a-f0-9]{12})[a-f0-9]{52}\b/gi, "$1…");
  }

  function exportAudit() {
    const rows = [["occurred_at", "actor", "action", "trace_id"], ...audit.map((item) => [item.occurredAt, item.actorName, item.action, item.traceId])];
    const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "closespan-problem-history.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <details className="card problem-audit-card section-gap">
      <summary className="problem-audit-summary">
        <span className="problem-audit-summary-title">
          <History size={17} aria-hidden="true" />
          <span>
            <strong>History</strong>
          </span>
        </span>
        <span className="problem-audit-summary-meta">
          <span className="badge">{audit.length} events</span>
          <ChevronDown className="problem-audit-chevron" size={17} aria-hidden="true" />
        </span>
      </summary>
      <div className="card-body problem-audit-body">
        <div className="problem-audit-intro">
          <button type="button" className="btn" onClick={exportAudit}>
            <Download size={13} aria-hidden="true" />
            Export CSV
          </button>
        </div>
        <div className="problem-audit-scroll" role="region" aria-label="Problem history events" tabIndex={0}>
          <ul className="timeline problem-audit-timeline">
            {audit.map((item) => (
              <li key={item.id}>
                <p>{summarizeAction(item.action)}</p>
                <div className="problem-audit-event-meta">
                  <strong>{item.actorName}</strong>
                  <time dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString()}</time>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}
