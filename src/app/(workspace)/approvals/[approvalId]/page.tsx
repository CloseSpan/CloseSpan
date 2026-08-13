import { AlertTriangle, Check, Clock3, GitBranch, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageTitle } from "@/components/screens";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { getEngineeringApprovalRecord } from "@/lib/engineering-workflow-repository";
import { getFinalExecutionApprovalById } from "@/lib/final-execution-repository";

export const dynamic = "force-dynamic";

export default async function ApprovalRecordPage({
  params,
}: {
  params: Promise<{ approvalId: string }>;
}) {
  const user = await requireWorkspaceUser();
  const { approvalId } = await params;
  const [record, finalApproval] = await Promise.all([
    getEngineeringApprovalRecord(user.orgId, approvalId),
    getFinalExecutionApprovalById(user.orgId, approvalId),
  ]);
  if (!record && !finalApproval) notFound();
  if (finalApproval) {
    const status = finalApproval.attempt?.status ?? finalApproval.status;
    return (
      <>
        <PageTitle
          title="Final execution approval"
          description="The immutable authorization record for the reviewed pull request commit."
          action={<span className={`badge ${["Approved", "Succeeded"].includes(status) ? "success" : ["Rejected", "Failed", "Superseded", "Expired"].includes(status) ? "high" : "medium"}`}>{status}</span>}
        />
        <section className="card approval-record-card">
          <div className="card-head">
            <div>
              <h2>{finalApproval.repository} · PR #{finalApproval.pullRequestNumber}</h2>
              <p className="subtle">Approval {finalApproval.id}</p>
            </div>
            <Link className="text-link" href="/approvals">Back to Action approvals</Link>
          </div>
          <div className="card-body">
            <p>This decision is bound to the exact pull request head and verification snapshot shown below.</p>
            {finalApproval.autoDeployOnMerge ? (
              <div className="callout warning">
                <div className="callout-title"><AlertTriangle size={16} /> Production consequence</div>
                <p>Merging this PR will automatically deploy to production.</p>
              </div>
            ) : null}
            <div className="approval-facts">
              <div className="fact"><span><GitBranch /></span><div><small>Reviewed commit</small><strong>{finalApproval.headSha}</strong></div></div>
              <div className="fact"><span><ShieldCheck /></span><div><small>Target</small><strong>{finalApproval.repository} · {finalApproval.baseBranch}</strong></div></div>
              <div className="fact"><span><Check /></span><div><small>Verification snapshot</small><strong>{finalApproval.testSummary.passed} tests · {finalApproval.acceptanceSummary.passed} acceptance checks passed</strong></div></div>
              <div className="fact"><span><Clock3 /></span><div><small>Authorization expiry</small><strong>{new Date(finalApproval.expiresAt).toLocaleString()}</strong></div></div>
            </div>
            <div className="top-actions">
              <Link className="btn" href={`/pdd/${finalApproval.problemId}#engineering-ticket`}>Open Prompt Testing preparation</Link>
              <a className="btn primary" href={finalApproval.pullRequestUrl} target="_blank" rel="noreferrer">Open pull request</a>
            </div>
          </div>
        </section>
      </>
    );
  }
  if (!record) notFound();
  const { approval } = record;

  return (
    <>
      <PageTitle
        title="Coding run approval"
        description="The immutable authorization record for one agent execution."
        action={
          <span
            className={`badge ${approval.status === "Approved" ? "success" : approval.status === "Rejected" ? "high" : "medium"}`}
          >
            {approval.status}
          </span>
        }
      />
      <section className="card approval-record-card">
        <div className="card-head">
          <div>
            <h2>{record.problemTitle}</h2>
            <p className="subtle">Approval {approval.id}</p>
          </div>
          <Link className="text-link" href="/approvals">
            Back to Action approvals
          </Link>
        </div>
        <div className="card-body">
          <p>
            This decision authorized one coding run against the exact prompt,
            repository, branch, and base commit shown below.
          </p>
          <div className="approval-facts">
            <div className="fact">
              <span><Sparkles aria-hidden="true" /></span>
              <div>
                <small>Prompt</small>
                <strong>
                  {record.promptRevision === null
                    ? approval.promptHash
                    : `Revision ${record.promptRevision} · ${approval.promptHash}`}
                </strong>
              </div>
            </div>
            <div className="fact">
              <span><GitBranch aria-hidden="true" /></span>
              <div>
                <small>Destination</small>
                <strong>{approval.repository} · {approval.baseBranch}@{approval.baseSha}</strong>
              </div>
            </div>
            <div className="fact">
              <span><ShieldCheck aria-hidden="true" /></span>
              <div>
                <small>Allowed capabilities</small>
                <strong>{approval.allowedCapabilities.join(", ")}</strong>
              </div>
            </div>
            <div className="fact">
              <span><Clock3 aria-hidden="true" /></span>
              <div>
                <small>Authorization expiry</small>
                <strong>{new Date(approval.expiresAt).toLocaleString()}</strong>
              </div>
            </div>
          </div>
          <div className="top-actions">
            <Link className="btn" href={`/pdd/${record.problemId}#engineering-ticket`}>
              Open product problem
            </Link>
            {record.runId ? (
              <Link className="btn primary" href={`/agent-runs/${record.runId}`}>
                Open authorized run
              </Link>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}
