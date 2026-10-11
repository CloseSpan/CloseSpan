import { AgentRunFinding } from "@/components/agent-run-finding";
import { detectRunFindings } from "@/lib/agent-run-findings";
import { readFindingIssueLinks } from "@/lib/agent-run-findings-repository";
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

export default async function AgentRunsPage({ searchParams }: { searchParams?: Promise<{ attention?: string }> }) {
  const user = await requireWorkspaceUser();
  const runs = await listAgentRuns(user.orgId);
  const findings = detectRunFindings(runs);
  const issueLinks = await readFindingIssueLinks(user.orgId);
  const attention = (await searchParams)?.attention === "1";
  const attentionIds = new Set(findings.filter((finding) => !finding.resolved).flatMap((finding) => finding.runIds));
  const visibleRuns = attention ? runs.filter((run) => attentionIds.has(run.id)) : runs;

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
      {runs.length > 0 && <nav className="agent-activity-filters" aria-label="Run filters">
        <Link className="btn" href="/agent-runs" aria-current={!attention ? "page" : undefined}>All runs ({runs.length})</Link>
        <Link className="btn" href="/agent-runs?attention=1" aria-current={attention ? "page" : undefined}>Needs attention ({attentionIds.size})</Link>
        <span className="subtle">Latest 100 runs · Findings update on refresh</span>
      </nav>}
      {attention && runs.length > 0 && visibleRuns.length === 0 ? <section className="card empty-state"><h2>No runs need attention</h2><p>No unresolved failures were detected in the recent run history.</p></section> : runs.length === 0 ? (
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
              {visibleRuns.map((run) => {
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
                      {findings.filter((finding) => finding.runIds.includes(run.id)).map((finding) => (
                        <AgentRunFinding key={finding.id} finding={finding} linkedIssue={issueLinks.links[finding.id]} canCreate={user.role === "Admin"} storageReady={issueLinks.ready} />
                      ))}
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
