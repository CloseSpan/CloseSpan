import { Bot, ExternalLink, Info, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { AgentRunDeleteButton } from "@/components/agent-run-delete-button";
import { PageTitle } from "@/components/screens";
import { requireWorkspaceUser } from "@/lib/auth-user";
import {
  listAgentRuns,
} from "@/lib/engineering-workflow-repository";
import {
  agentRunStatusPresentation,
  agentRunVerificationExplanation,
  agentRunVerificationState,
} from "@/lib/agent-run-presentation";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function AgentRunsPage() {
  const user = await requireWorkspaceUser();
  const runs = await listAgentRuns(user.orgId);

  return (
    <>
      <PageTitle
        eyebrow="Engineering delivery"
        title="Agent runs & verification"
        description="Track approved implementations, isolated Tenki tests, independent verification, and draft pull requests."
        action={
          <Link className="btn" href="/approvals">
            Review approvals
          </Link>
        }
      />
      {runs.length === 0 ? (
        <section className="card empty-state">
          <Bot aria-hidden="true" size={28} />
          <h2>No agent runs yet</h2>
          <p className="subtle">
            Approved implementation prompts appear here when an agent run is
            queued.
          </p>
          <Link className="btn primary" href="/approvals">
            Open approvals
          </Link>
        </section>
      ) : (
        <section className="card table-wrap agent-runs-table">
          <table>
            <caption className="sr-only">
              Agent implementation and verification runs
            </caption>
            <thead>
              <tr>
                <th>Product problem</th>
                <th>Run status</th>
                <th>Verification</th>
                <th>Repository</th>
                <th>Queued</th>
                <th>Result</th>
                <th className="agent-run-actions-heading">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const runStatus = agentRunStatusPresentation(run);
                const verification = agentRunVerificationState(run);
                const verificationExplanation =
                  agentRunVerificationExplanation(run);
                return (
                  <tr key={run.id}>
                    <td>
                      <Link
                        className="text-link"
                        href={`/agent-runs/${run.id}`}
                      >
                        <strong>{run.problemTitle}</strong>
                      </Link>
                      <small>{run.branchName}</small>
                    </td>
                    <td>
                      <span className={runStatus.className}>
                        {runStatus.label}
                      </span>
                    </td>
                    <td>
                      <div className="status-with-help">
                        <span className={verification.className}>
                          {verification.label}
                        </span>
                        {verificationExplanation ? (
                          <details className="status-help status-help-list">
                            <summary aria-label={verificationExplanation.title}>
                              <Info size={15} aria-hidden="true" />
                            </summary>
                            <div className="status-help-panel">
                              <strong>{verificationExplanation.title}</strong>
                              <p>{verificationExplanation.message}</p>
                            </div>
                          </details>
                        ) : null}
                      </div>
                    </td>
                    <td>{run.repository ?? "Repository unavailable"}</td>
                    <td>{dateFormatter.format(new Date(run.queuedAt))}</td>
                    <td className="agent-run-result-links">
                      <Link className="text-link" href={`/agent-runs/${run.id}`}>
                        View run
                      </Link>
                      {run.approvalId ? (
                        <Link
                          className="text-link"
                          href={`/approvals/${run.approvalId}`}
                        >
                          View approval
                        </Link>
                      ) : null}
                      {run.pullRequestUrl ? (
                        <a
                          className="text-link"
                          href={run.pullRequestUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Draft PR <ExternalLink aria-hidden="true" size={12} />
                        </a>
                      ) : run.independentVerificationStatus === "passed" ? (
                        <small>
                          <ShieldCheck aria-hidden="true" size={12} /> Verified
                        </small>
                      ) : null}
                    </td>
                    <td className="agent-run-delete-cell">
                      <AgentRunDeleteButton
                        runId={run.id}
                        runLabel={run.problemTitle}
                        status={run.status}
                        canDelete={user.role === "Admin"}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
