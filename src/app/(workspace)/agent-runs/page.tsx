import { Bot, ExternalLink, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { PageTitle } from "@/components/screens";
import { requireWorkspaceUser } from "@/lib/auth-user";
import {
  listAgentRuns,
  type AgentRunSummaryView,
} from "@/lib/engineering-workflow-repository";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

function statusClass(status: AgentRunSummaryView["status"]): string {
  if (["Draft PR opened", "Tests passed", "No changes"].includes(status)) {
    return "badge success";
  }
  if (["Failed", "Cancelled"].includes(status)) return "badge high";
  return "badge medium";
}

function verificationState(run: AgentRunSummaryView): {
  className: string;
  label: string;
} {
  if (run.independentVerificationStatus === "passed") {
    return { className: "badge success", label: "Verified" };
  }
  if (run.independentVerificationStatus === "failed") {
    return { className: "badge high", label: "Failed" };
  }
  if (run.status === "Tests passed") {
    return { className: "badge medium", label: "Verifying" };
  }
  return { className: "badge", label: "Pending" };
}

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
        <section className="card table-wrap">
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
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const verification = verificationState(run);
                return (
                  <tr key={run.id}>
                    <td>
                      <Link
                        className="text-link"
                        href={`/problems/${run.problemId}#engineering-ticket`}
                      >
                        <strong>{run.problemTitle}</strong>
                      </Link>
                      <small>{run.branchName}</small>
                    </td>
                    <td>
                      <span className={statusClass(run.status)}>
                        {run.status}
                      </span>
                    </td>
                    <td>
                      <span className={verification.className}>
                        {verification.label}
                      </span>
                    </td>
                    <td>{run.repository ?? "Repository unavailable"}</td>
                    <td>{dateFormatter.format(new Date(run.queuedAt))}</td>
                    <td>
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
