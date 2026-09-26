import Link from "next/link";
import { notFound } from "next/navigation";
import { WORKSPACE_LABELS } from "@/lib/workspace-labels";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { getEngineeringApprovalRecord } from "@/lib/engineering-workflow-repository";
import { getFinalExecutionApprovalById } from "@/lib/final-execution-repository";

export const dynamic = "force-dynamic";

export default async function ApprovalRecordPage({ params }: { params: Promise<{ approvalId: string }> }) {
  const user = await requireWorkspaceUser();
  const { approvalId } = await params;
  const [record, finalApproval] = await Promise.all([
    getEngineeringApprovalRecord(user.orgId, approvalId),
    getFinalExecutionApprovalById(user.orgId, approvalId),
  ]);
  if (!record && !finalApproval) notFound();
  const problemId = finalApproval?.problemId ?? record!.problemId;
  const status = finalApproval?.attempt?.status ?? finalApproval?.status ?? record!.approval.status;
  const action = finalApproval ? finalApproval.executionAction === "deploy" ? "Deployment" : "Merge" : "Coding run";
  return <div className="approval-record-card">
    <Link className="text-link" href="/approvals">{WORKSPACE_LABELS.approvals}</Link>
    <header className="page-head">
      <h1>{record?.problemTitle ?? `${action} PR #${finalApproval?.pullRequestNumber}`}</h1>
      <span className="badge">{status}</span>
    </header>
    <section className="card">
      <div className="card-body">
        <p>{finalApproval?.repository ?? record?.approval.repository} · {finalApproval?.baseBranch ?? record?.approval.baseBranch}</p>
        {finalApproval && <p>{finalApproval.testSummary.passed} tests passed · {finalApproval.acceptanceSummary.passed} acceptance checks passed</p>}
        {(finalApproval?.autoDeployOnMerge || finalApproval?.executionAction === "deploy") && <p className="callout warning" role="note">
          {finalApproval.executionAction === "deploy" ? "This action deploys to production." : "Merging this PR automatically deploys to production."}
        </p>}
        {finalApproval?.remainingRisks.length ? <section aria-label="Remaining risks"><h2>Remaining risks</h2><ul>{finalApproval.remainingRisks.map((risk) => <li key={risk}>{risk}</li>)}</ul></section> : null}
        <div className="top-actions">
          <Link className="btn" href={`/problems/${encodeURIComponent(problemId)}`}>View issue</Link>
          <Link className="btn primary" href={`/approvals?approval=${encodeURIComponent(approvalId)}`}>{status === "Pending" ? "Review decision" : "View decision"}</Link>
        </div>
      </div>
    </section>
  </div>;
}
