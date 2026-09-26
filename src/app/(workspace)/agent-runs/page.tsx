import { Bot, ExternalLink } from "lucide-react";
import Link from "next/link";
import { AgentRunDeleteButton } from "@/components/agent-run-delete-button";
import { PageTitle } from "@/components/screens";
import { WORKSPACE_LABELS } from "@/lib/workspace-labels";
import { requireWorkspaceUser } from "@/lib/auth-user";
import {
  listAgentRuns,
} from "@/lib/engineering-workflow-repository";
import {
  agentRunStatusPresentation,
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
        title={WORKSPACE_LABELS["agent-runs"]}
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
          <Link className="btn primary" href="/problems">
            View issues
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
                <th>Issue</th>
                <th>Status</th>
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
                return (
                  <tr key={run.id}>
                    <td>
                      <Link
                        className="text-link"
                        href={`/agent-runs/${run.id}`}
                      >
                        <strong>{run.problemTitle}</strong>
                      </Link>
                    </td>
                    <td>
                      <span className={runStatus.className}>
                        {runStatus.label}
                      </span>
                    </td>
                    <td>
                      <span className={verification.className}>
                        {verification.label}
                      </span>
                    </td>
                    <td>{run.repository ?? "Repository unavailable"}</td>
                    <td>{dateFormatter.format(new Date(run.queuedAt))}</td>
                    <td className="agent-run-result-links">
                      <Link className="text-link" href={`/agent-runs/${run.id}`}>
                        View result
                      </Link>
                      {run.pullRequestUrl ? (
                        <a
                          className="text-link"
                          href={run.pullRequestUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View PR <ExternalLink aria-hidden="true" size={12} />
                        </a>
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
