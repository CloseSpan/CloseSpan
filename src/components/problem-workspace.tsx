"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, ChevronRight, CircleHelp, Download, ExternalLink, FileCode2, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { calculateImpact, type FeedbackItem, type ProductProblem, type Recommendation, type Stage } from "@/lib/domain";
import type { DemoState } from "@/lib/store";

const stages: Stage[] = ["Detected", "Needs review", "Approved", "Planned", "In progress", "Released", "Verified", "Closed"];

export function ProblemWorkspace({ initialState, problem: primaryProblem, feedbackItems: feedback, investigation: recommendation }: { initialState: DemoState; problem: ProductProblem; feedbackItems: FeedbackItem[]; investigation: Recommendation }) {
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string }>();
  const [showRationale, setShowRationale] = useState(false);
  const impact = calculateImpact(primaryProblem.impactFactors);
  const evidence = feedback.filter((item) => primaryProblem.feedbackIds.includes(item.id));
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
  const evidenceConfidence = Math.round(primaryProblem.confidence * 100);

  async function mutate(path: "/api/workflow/approve" | "/api/workflow/reject" | "/api/workflow/advance") {
    setBusy(true); setNotice(undefined);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "x-org-id": primaryProblem.orgId, "idempotency-key": crypto.randomUUID(), "x-request-id": crypto.randomUUID() },
      });
      const payload = await response.json() as { state?: DemoState; error?: string };
      if (!response.ok || !payload.state) throw new Error(payload.error ?? "Action failed");
      setState(payload.state);
      setNotice({ kind: "success", message: path.endsWith("approve") ? "Approved and simulated work item created." : path.endsWith("reject") ? "Proposal rejected and audit event recorded." : `Moved to ${payload.state.problemStage}.` });
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Action failed" });
    } finally { setBusy(false); }
  }

  function exportAudit() {
    const rows = [["occurred_at", "actor", "action", "trace_id"], ...state.audit.map((item) => [item.occurredAt, item.actorName, item.action, item.traceId])];
    const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a"); link.href = url; link.download = "closespan-audit.csv"; link.click(); URL.revokeObjectURL(url);
  }

  const activeIndex = stages.indexOf(state.problemStage);
  return <>
    <div className="page-head">
      <div><div className="eyebrow">Product problem · {primaryProblem.id}</div><h1>{primaryProblem.title}</h1><p className="subtle">Detected from {evidence.length} customer signal{evidence.length === 1 ? "" : "s"}</p></div>
      <div className="top-actions"><span className={`badge ${primaryProblem.severity.toLowerCase()}`}>{primaryProblem.severity} severity</span><span className="badge brand">{state.problemStage}</span></div>
    </div>

    <section className="card pipeline-card" aria-label="Problem lifecycle"><div className="card-body"><div className="pipeline">{stages.map((stage, index) => <div className={`stage ${index < activeIndex ? "done" : index === activeIndex ? "current" : ""}`} aria-current={index === activeIndex ? "step" : undefined} key={stage}><span className="stage-dot">{index < activeIndex ? <Check size={10}/> : index + 1}</span>{stage}</div>)}</div></div></section>

    <div className="two-col"><div className="detail-stack">
      <section className="card"><div className="card-head"><h2>Problem intelligence</h2><span className="badge brand"><Sparkles size={12}/> AI summary · {evidenceConfidence}%</span></div><div className="card-body"><p className="summary">{primaryProblem.statement}</p><p className="subtle section-gap-sm">{primaryProblem.summary}</p><div className="grid cols-3 section-gap"><div><div className="metric-label">Affected revenue</div><strong>${Math.round(revenue / 1000)}k ARR</strong></div><div><div className="metric-label">Affected accounts</div><strong>{affectedAccounts.size} account{affectedAccounts.size === 1 ? "" : "s"}</strong></div><div><div className="metric-label">Evidence confidence</div><strong>{evidenceConfidence}%</strong></div></div></div></section>

      <section className="card"><div className="card-head"><div><h2>Supporting evidence</h2><p className="subtle">Why these reports belong together</p></div><button type="button" className="btn" aria-expanded={showRationale} onClick={() => setShowRationale((value) => !value)}>{showRationale ? "Hide rationale" : "Review membership"}</button></div><div className="card-body">{showRationale && <div className="callout membership-rationale"><div className="callout-title">Cluster membership rationale</div><p className="subtle">These {evidence.length} signal{evidence.length === 1 ? "" : "s"} support the same reviewed problem statement: {primaryProblem.statement} The current evidence confidence is {evidenceConfidence}%.</p></div>}{evidence.map((item) => <article className="evidence" key={item.id}><div className="split"><div className="evidence-meta"><span className="badge">{item.source}</span><strong>{item.customer}</strong><span>{item.observedAt}</span></div><span className="badge brand">{Math.round(item.confidence * 100)}% match</span></div><p className="quote">“{item.quote}”</p><div className="evidence-meta evidence-environment"><LockKeyhole size={11}/> PII scan complete · {item.environment}</div></article>)}</div></section>

      <section className="card"><div className="card-head"><div><h2>AI investigation</h2><p className="subtle">Repository-aware hypothesis with explicit uncertainty</p></div><span className="badge medium"><CircleHelp size={12}/> {Math.round(recommendation.confidence * 100)}% confidence</span></div><div className="card-body"><div className="callout warning"><div className="callout-title"><AlertTriangle size={13}/> Hypothesis: not a confirmed root cause</div><p className="subtle">{recommendation.hypothesis}</p></div><div className="grid cols-3 section-gap"><div><h3>Suspected ownership</h3><p className="subtle section-gap-xs">{primaryProblem.team}</p><span className="code-path">{primaryProblem.suspectedRepository}</span></div><div><h3>Relevant files</h3>{primaryProblem.suspectedFiles.slice(0, 2).map((file) => <span className="code-path" key={file}>{file}</span>)}</div><div><h3>Missing information</h3><ul className="list">{recommendation.missingInformation.map((item) => <li key={item}>{item}</li>)}</ul></div></div><div className="section-gap"><h3>Recommended tests</h3><ul className="list">{recommendation.tests.map((item) => <li key={item}>{item}</li>)}</ul></div></div></section>

      <section className="card"><div className="card-head"><h2>Activity & audit trail</h2><button type="button" className="btn" onClick={exportAudit}><Download size={13}/> Export CSV</button></div><div className="card-body"><ul className="timeline">{state.audit.map((item) => <li key={item.id}><strong>{item.actorName} · <time dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString()}</time></strong>{item.action}</li>)}</ul></div></section>
    </div>

    <aside className="detail-stack">
      <section className="card"><div className="card-head"><h2>Impact score</h2><div className="score-ring" aria-label={`Impact score ${impact.score} out of 100`}><span>{impact.score}</span></div></div><div className="card-body">{primaryProblem.impactFactors.map((factor) => <div className="factor" key={factor.key}><span>{factor.label} · {factor.weight}%</span><div className="bar" role="meter" aria-label={`${factor.label} score`} aria-valuenow={factor.value} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${factor.value}%` }}/></div><strong>{factor.value}</strong></div>)}<div className="callout section-gap-sm"><div className="callout-title">Why this score</div><p className="subtle">{impact.explanation}</p></div><Link className="btn full-width section-gap-xs" href="/settings#priority">Configure weights</Link></div></section>

      <section className="card"><div className="card-head"><h2>Approval request</h2><span className={`badge ${state.approval.status === "Approved" ? "success" : state.approval.status === "Rejected" ? "high" : "medium"}`}>{state.approval.status}</span></div><div className="card-body"><h3>{state.approval.action}</h3><p className="subtle section-gap-xs">{state.approval.reason}</p><div className="callout section-gap-sm"><div className="callout-title"><ShieldCheck size={13}/> Action boundary</div><p className="subtle">Low risk · Reversible<br/>Shares redacted evidence with GitHub<br/><strong>Simulation only. No external request.</strong></p></div>{state.approval.status === "Pending" ? <><button type="button" className="btn primary full-width section-gap-sm" disabled={busy} onClick={() => mutate("/api/workflow/approve")}>Approve & create simulated issue <ArrowRight size={14}/></button><button type="button" className="btn danger full-width section-gap-xs" disabled={busy} onClick={() => mutate("/api/workflow/reject")}>Reject proposal</button></> : state.workItem ? <div className="callout section-gap-sm"><div className="callout-title">Work item created</div><p className="subtle"><FileCode2 size={13}/> {state.workItem.id} · Simulated GitHub issue</p></div> : null}{notice && <p className={`toast ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.message}</p>}</div></section>

      {state.workItem && <section className="card"><div className="card-head"><h2>Resolution controls</h2></div><div className="card-body"><p className="subtle">Advance the simulated lifecycle one reviewed step at a time. Verification drafts customer follow-ups automatically.</p><button type="button" className="btn primary full-width section-gap-sm" disabled={busy || state.problemStage === "Closed"} onClick={() => mutate("/api/workflow/advance")}>Advance from {state.problemStage}<ChevronRight size={14}/></button><div className="split section-gap-sm"><span className="subtle">Follow-up</span><span className={`badge ${state.notifications === "Drafted" ? "success" : ""}`}>{state.notifications}</span></div></div></section>}

      <section className="card"><div className="card-head"><h2>Engineering context</h2></div><div className="card-body"><div className="metric-label">Likely owner</div><strong>{primaryProblem.team}</strong><div className="metric-label section-gap-sm">Evidence confidence</div><strong>{evidenceConfidence}%</strong><div className="metric-label section-gap-sm">Existing work</div><p className="subtle">No matching open issue found in the current workspace index.</p><Link className="btn full-width section-gap-sm" href="/investigations">Open investigation <ExternalLink size={13}/></Link></div></section>
    </aside></div>
  </>;
}
