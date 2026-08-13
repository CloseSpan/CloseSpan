import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentRunAutoRefresh } from "@/components/agent-run-auto-refresh";
import { RuntimeInteractionEvidence } from "@/components/runtime-interaction-evidence";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { getAgentRunById } from "@/lib/engineering-workflow-repository";

export const dynamic = "force-dynamic";

export default async function AgentRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const user = await requireWorkspaceUser();
  const { runId } = await params;
  const result = await getAgentRunById(user.orgId, runId);
  if (!result) notFound();
  const { run, problemId } = result;
  const runtime = run.runtimeEvidence;
  return (
    <>
      <section className="card">
        <div className="card-head"><div><h2>Approval-bound agent run</h2><p className="subtle">{run.id}</p><AgentRunAutoRefresh active={run.status === "Queued" || run.status === "Running" || run.status === "Tests passed"} /></div><span className="badge">{run.status}</span></div>
        <div className="card-body detail-stack">
          <p>{run.implementationSummary ?? run.failureMessage ?? "The executor has not returned a report yet."}</p>
          <p className="subtle">Coding environment: Tenki Sandbox · Branch: {run.branchName}</p>
          <div className="top-actions"><Link className="btn" href={`/pdd/${problemId}#engineering-ticket`}>Open PDD preparation</Link>{run.approvalId ? <Link className="btn" href={`/approvals/${run.approvalId}`}>View authorizing approval</Link> : null}{run.pullRequestUrl && <a className="btn primary" href={run.pullRequestUrl}>Open draft PR</a>}</div>
        </div>
      </section>
      <section className="card section-gap">
        <div className="card-head">
          <div>
            <h2>Runtime and PDD verification</h2>
            <p className="subtle">Install, build, health checks, tool interactions, and immutable user-story replay from the isolated Tenki environment.</p>
          </div>
          <span className={`badge ${runtime?.healthStatus === "passed" && runtime.userStoryReplay !== "failed" ? "success" : runtime?.healthStatus === "failed" || runtime?.userStoryReplay === "failed" ? "high" : "medium"}`}>
            {runtime?.healthStatus === "passed" && runtime.userStoryReplay !== "failed"
              ? "Runtime passed"
              : runtime?.healthStatus === "failed" || runtime?.userStoryReplay === "failed"
                ? "Runtime failed"
                : runtime?.configured
                  ? "Runtime pending"
                  : "Not configured"}
          </span>
        </div>
        <div className="card-body detail-stack">
          {runtime ? (
            <>
              <div className="grid cols-3 runtime-evidence-summary">
                <div className="callout">
                  <p className="subtle">Application health</p>
                  <strong>{runtime.healthStatus === "passed" ? "Healthy" : runtime.healthStatus === "failed" ? "Failed" : "Not configured"}</strong>
                </div>
                <div className="callout">
                  <p className="subtle">Application port</p>
                  <strong>{runtime.applicationPort ?? "Not configured"}</strong>
                </div>
                <div className="callout">
                  <p className="subtle">
                    {runtime.userStoryReplayMode === "live_application"
                      ? "Live user-story replay"
                      : runtime.userStoryReplayMode === "contract"
                        ? "PDD contract replay"
                        : "User-story replay"}
                  </p>
                  <strong>{runtime.userStoryReplay === "passed" ? "Passed" : runtime.userStoryReplay === "failed" ? "Failed" : "Not required"}</strong>
                </div>
              </div>
              {runtime.previewUrl ? (
                <p>
                  <a className="btn" href={runtime.previewUrl} target="_blank" rel="noreferrer">Open temporary preview</a>{" "}
                  <span className="subtle">Tenki preview links are short-lived and may have expired after verification.</span>
                </p>
              ) : null}
              {runtime.interactions.length ? (
                <div className="detail-stack">
                  <h3>Tool interactions</h3>
                  {runtime.interactions.map((interaction, index) => (
                    <RuntimeInteractionEvidence
                      interaction={interaction}
                      key={`${interaction.tool}:${interaction.target}:${index}`}
                    />
                  ))}
                </div>
              ) : <p className="subtle">No runtime tool interactions were required.</p>}
              {runtime.logExcerpt.length ? (
                <details>
                  <summary>Show redacted runtime logs</summary>
                  <pre className="code-block">{runtime.logExcerpt.join("\n\n")}</pre>
                </details>
              ) : null}
            </>
          ) : (
            <p className="subtle">
              {run.status === "Queued" || run.status === "Running" || run.status === "Tests passed"
                ? "Runtime evidence will appear after the isolated implementation and verification sessions finish."
                : "This run did not include a configured running application."}
            </p>
          )}
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
