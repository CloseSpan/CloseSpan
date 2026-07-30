import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentRunAutoRefresh } from "@/components/agent-run-auto-refresh";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { getAgentRunById } from "@/lib/engineering-workflow-repository";

export const dynamic = "force-dynamic";

export default async function AgentRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const user = await requireWorkspaceUser();
  const { runId } = await params;
  const result = await getAgentRunById(user.orgId, runId);
  if (!result) notFound();
  const { run, problemId } = result;
  return (
    <>
      <section className="card">
        <div className="card-head"><div><h2>Approval-bound agent run</h2><p className="subtle">{run.id}</p><AgentRunAutoRefresh active={run.status === "Queued" || run.status === "Running" || run.status === "Tests passed"} /></div><span className="badge">{run.status}</span></div>
        <div className="card-body detail-stack">
          <p>{run.implementationSummary ?? run.failureMessage ?? "The executor has not returned a report yet."}</p>
          <p className="subtle">Coding environment: Tenki Sandbox · Branch: {run.branchName}</p>
          <div className="top-actions"><Link className="btn" href={`/problems/${problemId}#engineering-ticket`}>Open ticket</Link>{run.pullRequestUrl && <a className="btn primary" href={run.pullRequestUrl}>Open draft PR</a>}</div>
        </div>
      </section>
      <section className="card section-gap">
        <div className="card-head">
          <div>
            <h2>Independent verification</h2>
            <p className="subtle">CloseSpan runs this automatically after the approved implementation. No additional user action is required.</p>
          </div>
          <span className={`badge ${run.independentVerification?.status === "passed" ? "success" : run.independentVerification?.status === "failed" ? "high" : "medium"}`}>
            {run.independentVerification?.status === "passed"
              ? "Verified"
              : run.independentVerification?.status === "failed"
                ? "Failed"
                : run.status === "Tests passed"
                  ? "Running"
                  : run.status === "Queued" || run.status === "Running"
                    ? "Pending"
                    : "Not run"}
          </span>
        </div>
        <div className="card-body">
          {run.independentVerification ? (
            <p>
              {run.independentVerification.provider} independently reran the approved commands in{" "}
              {(run.independentVerification.durationMs / 1_000).toFixed(1)} seconds.
            </p>
          ) : (
            <p className="subtle">
              {run.status === "Queued" || run.status === "Running" || run.status === "Tests passed"
                ? "Verification starts automatically when the coding executor returns a successful implementation."
                : "Independent verification was not completed for this run."}
            </p>
          )}
        </div>
      </section>
      <section className="card section-gap"><div className="card-head"><h2>Acceptance coverage</h2></div><div className="card-body detail-stack">{run.criterionResults.length ? run.criterionResults.map((criterion) => <article className="callout" key={criterion.criterionId}><div className="split"><strong>{criterion.criterionId}</strong><span className="badge">{criterion.status}</span></div><p>{criterion.evidence}</p><p className="subtle">{criterion.scenarioIds.join(", ")}</p></article>) : <p className="subtle">No criterion evidence has been returned.</p>}</div></section>
      <section className="card section-gap"><div className="card-head"><h2>Independent test results</h2></div><div className="card-body detail-stack">{run.testResults.length ? run.testResults.map((test) => <details className="callout" key={test.command}><summary>{test.status === "passed" ? "✓" : "✕"} {test.command}</summary><pre className="code-block">{test.output}</pre></details>) : <p className="subtle">No test results have been returned.</p>}</div></section>
      <section className="card section-gap"><div className="card-head"><h2>Changed files and unresolved work</h2></div><div className="card-body grid cols-2"><div><h3>Changed files</h3><ul className="list">{run.changedFiles.map((file) => <li key={file}>{file}{run.testFiles?.includes(file) ? " (test)" : ""}</li>)}</ul></div><div><h3>Remaining risks</h3><ul className="list">{(run.remainingRisks ?? []).map((risk) => <li key={risk}>{risk}</li>)}</ul><h3>Manual verification</h3><ul className="list">{(run.manualVerification ?? []).map((item) => <li key={item}>{item}</li>)}</ul></div></div></section>
      {run.logs?.length ? <section className="card section-gap"><div className="card-head"><h2>Executor logs</h2></div><div className="card-body"><details><summary>Show bounded logs</summary><pre className="code-block">{run.logs.join("\n\n")}</pre></details></div></section> : null}
    </>
  );
}
