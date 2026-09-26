import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import type { AgentRunSummaryView, AgentRunView } from "@/lib/engineering-workflow-repository";
import { agentRunStatusPresentation, canRetryAgentRunDirectly } from "@/lib/agent-run-presentation";
import { AgentRunAutoRefresh } from "./agent-run-auto-refresh";
import { AgentRunRetryButton } from "./agent-run-retry-button";

export interface AgentRunSummaryProps {
  run: AgentRunView;
  problemId: string;
  title: string;
  isAdmin: boolean;
  finalExecutionStatus?: AgentRunSummaryView["finalExecutionStatus"];
  presentationDemo?: boolean;
}

function ResultRow({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return <div className="run-result-row"><dt>{label}</dt><dd><span className={`badge ${tone}`}>{value}</span></dd></div>;
}

function testCount(run: AgentRunView) {
  if (!run.testResults.length) return { label: "Not run", tone: "" };
  const passed = run.testResults.filter((test) => test.status === "passed").length;
  const failed = run.testResults.filter((test) => test.status === "failed").length;
  const skipped = run.testResults.filter((test) => test.status === "skipped").length;
  return {
    label: [`${passed} passed`, failed ? `${failed} failed` : "", skipped ? `${skipped} skipped` : ""].filter(Boolean).join(" · "),
    tone: failed ? "high" : skipped ? "medium" : "success",
  };
}

export function AgentRunSummary({ run, problemId, title, isAdmin, finalExecutionStatus = null, presentationDemo = false }: AgentRunSummaryProps) {
  const active = ["Queued", "Running", "Tests passed"].includes(run.status);
  const refreshing = !presentationDemo && (active || finalExecutionStatus === "Queued" || finalExecutionStatus === "Running");
  const runStatus = agentRunStatusPresentation({ status: run.status, finalExecutionStatus });
  const canRetry = !presentationDemo && isAdmin && canRetryAgentRunDirectly(run);
  const staleApproval = run.failureCode === "stale_base" || run.failureMessage?.startsWith("stale_base:");
  const verification = run.independentVerification?.status === "passed"
    ? { label: "Verified", tone: "success" }
    : run.independentVerification?.status === "failed"
      ? { label: "Failed", tone: "high" }
      : { label: run.status === "Tests passed" ? "Running" : active ? "Pending" : "Not run", tone: active ? "medium" : "" };
  const tests = testCount(run);
  const criteriaPassed = run.criterionResults.filter((criterion) => criterion.status === "Passed").length;
  const unresolvedCriteria = run.criterionResults.filter((criterion) => criterion.status !== "Passed");
  const failedCriteria = unresolvedCriteria.some((criterion) => criterion.status === "Failed");
  const runtime = run.runtimeEvidence;
  const risks = run.remainingRisks ?? [];
  const manualChecks = run.manualVerification ?? [];
  const failure = staleApproval
    ? "The repository changed after approval. Review the issue before starting again."
    : run.failureMessage;
  const needsAttention = Boolean(failure || risks.length || manualChecks.length || unresolvedCriteria.length || finalExecutionStatus === "Failed");

  return (
    <div className="agent-run-summary">
      <Link className="text-link run-back-link" href={`/problems/${problemId}`}><ArrowLeft size={14} aria-hidden="true" /> View issue</Link>
      <div className="page-head run-summary-heading">
        <div>
          <h1>{title}</h1>
          {run.repository ? <p className="subtle run-summary-repository">{run.repository}</p> : null}
        </div>
        <span className={runStatus.className}>{runStatus.label}</span>
      </div>
      {presentationDemo && <p className="subtle"><span className="badge">Demo · sample data</span> Read-only results. No live work is running.</p>}
      <AgentRunAutoRefresh active={refreshing} quiet />
      <section className="card run-summary-card" aria-labelledby="run-results-heading">
        <div className="card-head"><h2 id="run-results-heading">Results</h2></div>
        <div className="card-body">
          <dl className="run-results">
            <ResultRow label="Independent verification" value={verification.label} tone={verification.tone} />
            <ResultRow label="Automated tests" value={tests.label} tone={tests.tone} />
            <ResultRow label="Acceptance checks" value={run.criterionResults.length ? `${criteriaPassed} of ${run.criterionResults.length} passed` : "Not run"}
              tone={failedCriteria ? "high" : unresolvedCriteria.length ? "medium" : criteriaPassed ? "success" : ""} />
            {runtime ? (
              <>
                <ResultRow label="Application health"
                  value={runtime.healthStatus === "passed" ? "Healthy" : runtime.healthStatus === "failed" ? "Failed" : runtime.configured ? "Pending" : "Not configured"}
                  tone={runtime.healthStatus === "passed" ? "success" : runtime.healthStatus === "failed" ? "high" : "medium"} />
                <ResultRow label={runtime.userStoryReplayMode === "live_application" ? "Live app test" : runtime.userStoryReplayMode === "contract" ? "Prompt contract test" : "Scenario test"}
                  value={runtime.userStoryReplay === "passed" ? "Passed" : runtime.userStoryReplay === "failed" ? "Failed" : "Not run"}
                  tone={runtime.userStoryReplay === "passed" ? "success" : runtime.userStoryReplay === "failed" ? "high" : ""} />
              </>
            ) : <ResultRow label="Live app test" value={active ? "Pending" : "Not configured"} tone={active ? "medium" : ""} />}
          </dl>
          <div className="run-summary-actions">
            {run.pullRequestUrl && !presentationDemo ? <a className="btn primary" href={run.pullRequestUrl} target="_blank" rel="noreferrer">Open pull request <ExternalLink size={14} aria-hidden="true" /></a> : null}
            {run.approvalId ? <Link className="btn" href={`/approvals?approval=${run.approvalId}`}>View decision</Link> : null}
          </div>
        </div>
      </section>
      {needsAttention ? (
        <section className="card run-attention" aria-labelledby="run-attention-heading">
          <div className="card-head"><h2 id="run-attention-heading">Needs attention</h2></div>
          <div className="card-body">
            {failure ? <p className="callout warning" role="alert">{failure}</p> : null}
            {finalExecutionStatus === "Failed" ? <p className="callout warning" role="alert">Merge failed. <Link className="text-link" href="/approvals">Review approvals</Link></p> : null}
            {unresolvedCriteria.length ? <ul className="run-attention-list">{unresolvedCriteria.map((criterion) => (
              <li key={criterion.criterionId}><strong>{criterion.status}</strong><p>{criterion.statement || criterion.evidence}</p></li>
            ))}</ul> : null}
            {risks.length ? <div><h3>Remaining risks</h3><ul className="run-attention-list">{risks.map((risk) => <li key={risk}>{risk}</li>)}</ul></div> : null}
            {manualChecks.length ? <div><h3>Manual checks</h3><ul className="run-attention-list">{manualChecks.map((check) => <li key={check}>{check}</li>)}</ul></div> : null}
          </div>
        </section>
      ) : null}
      {canRetry ? (
        <section className="card run-retry" aria-label="Retry coding run">
          <p>Starts one new coding run with the same approved prompt and commit.</p>
          <AgentRunRetryButton runId={run.id} />
        </section>
      ) : null}
      <div className="run-summary-footer">
        {!presentationDemo && <Link className="text-link" href={`/agent-runs/${run.id}/details`}>Technical details</Link>}
        {runtime?.previewUrl && !presentationDemo ? <a className="text-link" href={runtime.previewUrl} target="_blank" rel="noreferrer">Temporary preview (may expire) <ExternalLink size={14} aria-hidden="true" /></a> : null}
      </div>
    </div>
  );
}
