"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, ExternalLink } from "lucide-react";
import type { EngineeringWorkflowView } from "@/lib/engineering-workflow-repository";
import type { FinalExecutionApprovalView } from "@/lib/final-execution-repository";
import type { ProductProblem } from "@/lib/domain";
import { announcePendingApprovalCountChange } from "@/lib/pending-approval-count-client";
import { WORKSPACE_LABELS } from "@/lib/workspace-labels";
import { EmptyWorkspaceState, PageTitle } from "./shared";

export function ApprovalsScreen({
  problemTitles,
  initialEngineeringWorkflows,
  orgId,
  canApprove: allowApproval = true,
  initialApprovalId,
  requirementReviews = [],
  reviewStorageReady = true,
  presentationDemo = false,
}: {
  problem: ProductProblem | null;
  problemTitles: Record<string, string>;
  initialEngineeringWorkflows: EngineeringWorkflowView[];
  orgId: string;
  canApprove?: boolean;
  initialApprovalId?: string;
  requirementReviews?: Array<{ problemId: string; title: string; needsHelp: boolean }>;
  reviewStorageReady?: boolean;
  presentationDemo?: boolean;
}) {
  const router = useRouter();
  const canApprove = allowApproval && !presentationDemo;
  const demoNotice = presentationDemo
    ? <p className="subtle"><span className="badge">Demo · sample data</span> Read-only decisions. No live work is running.</p> : null;
  const [localWorkflows, setLocalWorkflows] = useState({ source: initialEngineeringWorkflows, rows: initialEngineeringWorkflows });
  const engineeringWorkflows = localWorkflows.source === initialEngineeringWorkflows ? localWorkflows.rows : initialEngineeringWorkflows;
  const approvalItems: ApprovalItem[] = engineeringWorkflows.flatMap((workflow) => [
    workflow.approval
      ? { key: `engineering:${workflow.approval.id}`, kind: "engineering" as const, workflow }
      : null,
    workflow.finalApproval
      ? { key: `final:${workflow.finalApproval.id}`, kind: "final" as const, workflow }
      : null,
  ].filter(Boolean) as ApprovalItem[]);
  const initialPendingItems = approvalItems.filter((item) =>
    item.kind === "engineering"
      ? item.workflow.approval?.status === "Pending"
      : item.workflow.finalApproval?.status === "Pending",
  );
  const requestedItem = approvalItems.find((item) => (item.kind === "engineering" ? item.workflow.approval?.id : item.workflow.finalApproval?.id) === initialApprovalId);
  const initialTab: ApprovalTab = requestedItem && !initialPendingItems.includes(requestedItem) ? "history" : "pending";
  const initialSelected = requestedItem?.key ?? initialPendingItems[0]?.key ?? "";
  const [localTab, setLocalTab] = useState({ requestId: initialApprovalId, value: initialTab });
  const [localSelected, setLocalSelected] = useState({ requestId: initialApprovalId, value: initialSelected });
  const selected = localSelected.requestId === initialApprovalId ? localSelected.value : initialSelected;
  const selectedRecord = approvalItems.find((item) => item.key === selected);
  const selectedStatus = selectedRecord?.kind === "engineering"
    ? selectedRecord.workflow.approval?.status : selectedRecord?.workflow.finalApproval?.status;
  const tab: ApprovalTab = selectedRecord ? selectedStatus === "Pending" ? "pending" : "history"
    : localTab.requestId === initialApprovalId ? localTab.value : initialTab;
  const setTab = (value: ApprovalTab) => setLocalTab({ requestId: initialApprovalId, value });
  const setSelected = (value: string) => setLocalSelected({ requestId: initialApprovalId, value });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  }>();

  const pendingItems = approvalItems.filter((item) =>
    item.kind === "engineering"
      ? item.workflow.approval?.status === "Pending"
      : item.workflow.finalApproval?.status === "Pending",
  );
  const historyItems = approvalItems.filter((item) =>
    item.kind === "engineering"
      ? item.workflow.approval?.status !== "Pending"
      : item.workflow.finalApproval?.status !== "Pending",
  );
  const visibleItems = tab === "pending" ? pendingItems : historyItems;
  const selectedItem = visibleItems.find((item) => item.key === selected) ?? (!selected ? visibleItems[0] : undefined);
  const engineeringWorkflow = selectedItem?.workflow ?? null;
  const engineeringApproval = engineeringWorkflow?.approval;
  const finalApproval = engineeringWorkflow?.finalApproval;
  const selectedKind = selectedItem?.kind;
  const approvalBlockReason = selectedItem ? pendingApprovalBlockReason(selectedItem) : null;

  useEffect(() => {
    if (presentationDemo) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible" && !busy) router.refresh();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [busy, router, presentationDemo]);

  function replaceWorkflow(next: EngineeringWorkflowView) {
    setLocalWorkflows({ source: initialEngineeringWorkflows,
      rows: engineeringWorkflows.map((workflow) => workflow.problemId === next.problemId ? next : workflow) });
  }

  function selectTab(nextTab: ApprovalTab) {
    const nextItems = nextTab === "pending" ? pendingItems : historyItems;
    setTab(nextTab);
    if (!nextItems.some((item) => item.key === selected)) {
      setSelected(nextItems[0]?.key ?? "");
    }
    setNotice(undefined);
  }

  const domainReviews = <>
    {!reviewStorageReady && <p className="toast error" role="alert">Some reviews are unavailable. Ask an administrator to finish review setup.</p>}
    {requirementReviews.length > 0 && <section className="card review-inbox" aria-label="Issue reviews">
      {requirementReviews.map((item) => <Link className="review-inbox-row" href={`/problems/${item.problemId}`} key={item.problemId}>
        <strong>{item.title}</strong>
        <span className={`badge ${item.needsHelp ? "medium" : "brand"}`}>{item.needsHelp ? "Needs attention" : "Confirm expected behavior"}</span>
        <ChevronRight size={16} aria-hidden="true" />
      </Link>)}
    </section>}
  </>;

  const unavailableApprovalId = initialApprovalId && !requestedItem ? initialApprovalId
    : selected && !selectedRecord ? selected.slice(selected.indexOf(":") + 1) : null;
  if (unavailableApprovalId) {
    return <>
      <PageTitle title={WORKSPACE_LABELS.approvals} />
      {demoNotice}
      <section className="card approval-detail-empty">
        <h2>Decision unavailable</h2>
        <p>This decision is no longer in the current review list. Open its record to see the original decision.</p>
        <div className="top-actions">
          <Link className="btn" href={`/approvals/${encodeURIComponent(unavailableApprovalId)}`}>View decision record</Link>
          <Link className="btn" href="/approvals">View current reviews</Link>
          <Link className="text-link" href="/problems">View issues</Link>
        </div>
      </section>
    </>;
  }

  if (approvalItems.length === 0) {
    return (
      <>
        <PageTitle title={WORKSPACE_LABELS.approvals} />
        {demoNotice}
        {domainReviews}
        {!requirementReviews.length && <EmptyWorkspaceState
          title={reviewStorageReady ? "Nothing needs your review" : "Reviews unavailable"}
          description={reviewStorageReady
            ? "Requirement reviews and agent actions waiting on your decision appear here."
            : "Review history can't be loaded right now."}
          actionHref="/problems"
          actionLabel="View issues"
        />}
      </>
    );
  }
  async function decideEngineering(action: "approve" | "reject") {
    if (!engineeringApproval || !canApprove || busy) return;
    if (!selectedItem) return;
    const blocked = pendingApprovalBlockReason(selectedItem);
    if (action === "approve" && blocked) { setNotice({ kind: "error", text: blocked }); return; }
    setBusy(selectedItem.key);
    setNotice(undefined);
    try {
      const response = await fetch(
        `/api/engineering-approvals/${engineeringApproval.id}/${action}`,
        {
          method: "POST",
          headers: {
            "x-org-id": orgId,
            "idempotency-key": crypto.randomUUID(),
            "x-request-id": crypto.randomUUID(),
          },
        },
      );
      const payload = (await response.json()) as {
        workflow?: EngineeringWorkflowView;
        error?: string;
      };
      if (!response.ok || !payload.workflow) {
        throw new Error(payload.error ?? "Approval action failed");
      }
      replaceWorkflow(payload.workflow);
      announcePendingApprovalCountChange(-1);
      setTab("history");
      setSelected(selectedItem.key);
      setNotice({
        kind: "success",
        text:
          action === "approve"
            ? "Coding run approved and queued."
            : "Coding run rejected.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Approval action failed",
      });
    } finally {
      setBusy(null);
    }
  }

  async function decideFinalExecution(action: "approve" | "reject") {
    if (!finalApproval || !canApprove || busy) return;
    if (!selectedItem) return;
    const blocked = pendingApprovalBlockReason(selectedItem);
    if (action === "approve" && blocked) { setNotice({ kind: "error", text: blocked }); return; }
    setBusy(selectedItem.key);
    setNotice(undefined);
    try {
      const response = await fetch(
        `/api/final-execution-approvals/${finalApproval.id}/${action}`,
        {
          method: "POST",
          headers: {
            "x-org-id": orgId,
            "idempotency-key": crypto.randomUUID(),
            "x-request-id": crypto.randomUUID(),
          },
        },
      );
      const payload = (await response.json()) as {
        approval?: FinalExecutionApprovalView;
        error?: string;
      };
      if (!response.ok || !payload.approval) {
        throw new Error(payload.error ?? "Final execution approval failed");
      }
      replaceWorkflow({ ...selectedItem.workflow, finalApproval: payload.approval });
      announcePendingApprovalCountChange(-1);
      setTab("history");
      setSelected(selectedItem.key);
      const executionFailed =
        payload.approval.attempt?.status === "Failed"
        || payload.approval.status === "Superseded";
      setNotice({
        kind: executionFailed ? "error" : "success",
        text:
          action === "approve"
            ? executionFailed
              ? payload.approval.attempt?.failureMessage ?? "The approved action could not complete."
              : payload.approval.attempt?.status === "Queued"
                ? "Approved and queued."
                : "Approved."
            : finalApproval.executionAction === "deploy" ? "Deployment rejected." : "Merge rejected. The PR is unchanged.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Final execution approval failed",
      });
    } finally {
      setBusy(null);
    }
  }

  const itemTitle = (item: ApprovalItem) =>
    problemTitles[item.workflow.problemId] ?? "Issue";

  const itemAction = (item: ApprovalItem) => item.kind === "engineering"
    ? "Coding run"
    : `${item.workflow.finalApproval?.executionAction === "deploy" ? "Deploy" : "Merge"} PR #${item.workflow.finalApproval?.pullRequestNumber ?? ""}`;

  const itemStatus = (item: ApprovalItem) => {
    if (pendingApprovalBlockReason(item)) return "Needs attention";
    if (item.kind === "engineering") return item.workflow.approval?.status ?? "Pending";
    if (item.kind === "final") {
      return item.workflow.finalApproval?.attempt?.status ?? item.workflow.finalApproval?.status ?? "Pending";
    }
    return "Pending";
  };

  return (
    <>
      <PageTitle title={WORKSPACE_LABELS.approvals} />
      {demoNotice}
      {tab === "pending" && domainReviews}
      <div className="approval-tabs" role="group" aria-label="Approval status">
        {(["pending", "history"] as const).map((item) => (
          <button
            type="button"
            aria-pressed={tab === item}
            className={tab === item ? "active" : ""}
            onClick={() => selectTab(item)}
            key={item}
          >
            {item === "pending" ? "Pending" : "History"}
            <span>{item === "pending" ? pendingItems.length : historyItems.length}</span>
          </button>
        ))}
      </div>
      <div className={`approval-layout approval-compact${visibleItems.length ? "" : " is-empty"}`}>
        {visibleItems.length ? (
          <section className="card approval-queue-card" aria-label={tab === "pending" ? "Pending approvals" : "Approval history"}>
            <div className="approval-request-list">
              {visibleItems.map((item) => (
                <button
                  type="button"
                  className={`queue-item approval-queue-button${selected === item.key ? " selected" : ""}`}
                  aria-current={selected === item.key ? "true" : undefined}
                  onClick={() => {
                    setSelected(item.key);
                    setNotice(undefined);
                  }}
                  key={item.key}
                >
                  <div>
                    <strong>{itemTitle(item)}</strong>
                    <p className="subtle">
                      {itemAction(item)} · {item.kind === "engineering"
                        ? item.workflow.approval?.repository
                        : item.workflow.finalApproval?.repository}
                    </p>
                  </div>
                  <span
                    className={`badge queue-item-badge ${["Approved", "Succeeded"].includes(itemStatus(item)) ? "success" : ["Rejected", "Failed", "Superseded", "Expired"].includes(itemStatus(item)) ? "high" : "medium"}`}
                  >
                    {itemStatus(item)}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
        {visibleItems.length ? (
          <section
            className="card approval-detail-card"
            id={`approval-${selectedKind === "engineering" ? engineeringApproval?.id : finalApproval?.id}`}
          >
            {selectedKind === "engineering" && engineeringApproval && engineeringWorkflow ? (
              <>
                <div className="card-head">
                  <div>
                    <h2>Coding run</h2>
                    <p className="subtle approval-destination">{engineeringApproval.repository} · {engineeringApproval.baseBranch}</p>
                  </div>
                  <span
                    className={`badge ${engineeringApproval.status === "Approved" ? "success" : ["Rejected", "Expired", "Superseded"].includes(engineeringApproval.status) ? "high" : "medium"}`}
                  >
                    {selectedItem ? itemStatus(selectedItem) : engineeringApproval.status}
                  </span>
                </div>
                <div className="card-body approval-summary">
                  {engineeringApproval.status === "Pending" ? (
                    <>
                      {approvalBlockReason && <p className="callout warning" role="alert">{approvalBlockReason}</p>}
                      <p>One isolated coding run. Merge and deployment need separate approval.</p>
                      <p className="subtle approval-expiry">Expires {new Date(engineeringApproval.expiresAt).toLocaleString()}</p>
                      <Link className="text-link" href={`/problems/${engineeringWorkflow.problemId}`}>View issue <ChevronRight size={14} aria-hidden="true" /></Link>
                      {!canApprove && !presentationDemo && <p role="status">An administrator must approve this action.</p>}
                      <div className="approval-actions">
                        <button
                          type="button"
                          className="btn danger"
                          disabled={!canApprove || busy !== null}
                          onClick={() => decideEngineering("reject")}
                        >
                          {busy === selectedItem?.key ? "Recording…" : "Reject run"}
                        </button>
                        <button
                          type="button"
                          className="btn primary"
                          disabled={!canApprove || busy !== null || Boolean(approvalBlockReason)}
                          onClick={() => decideEngineering("approve")}
                        >
                          {busy === selectedItem?.key ? "Queueing run…" : "Approve one run"} <Check size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="approval-result-actions">
                      {engineeringWorkflow.run ? (
                        <Link className="btn" href={`/agent-runs/${engineeringWorkflow.run.id}`}>
                          View result
                        </Link>
                      ) : null}
                    </div>
                  )}
                </div>
              </>
            ) : selectedKind === "final" && finalApproval ? (
              <>
                <div className="card-head">
                  <div>
                    <h2>{finalApproval.executionAction === "deploy" ? "Deploy" : "Merge"} PR #{finalApproval.pullRequestNumber}</h2>
                    <p className="subtle approval-destination">{finalApproval.repository} · {finalApproval.baseBranch}{finalApproval.targetEnvironment ? ` · ${finalApproval.targetEnvironment}` : ""}</p>
                  </div>
                  <span
                    className={`badge ${finalApproval.attempt?.status === "Succeeded" || finalApproval.status === "Approved" ? "success" : finalApproval.attempt?.status === "Failed" || finalApproval.status === "Rejected" || finalApproval.status === "Superseded" ? "high" : "medium"}`}
                  >
                    {selectedItem ? itemStatus(selectedItem) : finalApproval.status}
                  </span>
                </div>
                <div className="card-body approval-summary">
                  {finalApproval.status === "Pending" || finalApproval.attempt?.status === "Failed" ? (
                    <>
                      <p>Only the reviewed commit will be {finalApproval.executionAction === "deploy" ? "deployed" : "merged"}.</p>
                      <p className="subtle">{finalApproval.testSummary.passed} tests passed · {finalApproval.acceptanceSummary.passed} acceptance checks passed</p>
                      {presentationDemo && <Link className="text-link" href={`/agent-runs/${finalApproval.agentRunId}`}>View sample result <ChevronRight size={14} aria-hidden="true" /></Link>}
                      {!presentationDemo && <a className="text-link" href={`${finalApproval.pullRequestUrl}/commits/${finalApproval.headSha}`} target="_blank" rel="noreferrer">Review changes <ExternalLink size={14} aria-hidden="true" /></a>}
                      {finalApproval.autoDeployOnMerge || finalApproval.executionAction === "deploy" ? (
                        <div className="callout warning" role="note">
                          <strong>{finalApproval.executionAction === "deploy" ? "This will deploy to production." : "Merging this PR will automatically deploy to production."}</strong>
                        </div>
                      ) : null}
                      {finalApproval.remainingRisks.length ? (
                        <div className="callout warning">
                          <strong>Remaining risks</strong>
                          <ul>{finalApproval.remainingRisks.map((risk) => <li key={risk}>{risk}</li>)}</ul>
                        </div>
                      ) : null}
                      {finalApproval.rollbackPlan ? <p><strong>Rollback:</strong> {finalApproval.rollbackPlan}</p> : null}
                    </>
                  ) : null}
                  {finalApproval.releaseVerification?.scopeAssessment.compatible === false ? (
                    <div className="callout warning" role="alert">
                      <div className="callout-title">Verification scope changed</div>
                      <p>The changes need new verification before approval.</p>
                      <ul>
                        {finalApproval.releaseVerification.scopeAssessment.mismatches.map((mismatch) => (
                          <li key={mismatch}>{mismatch}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {approvalBlockReason && finalApproval.releaseVerification?.scopeAssessment.compatible !== false
                    ? <p className="callout warning" role="alert">{approvalBlockReason}</p> : null}
                  {finalApproval.status === "Pending" ? (
                    <>
                    {!canApprove && !presentationDemo && <p role="status">An administrator must approve this action.</p>}
                    <div className="approval-actions">
                      <button
                        type="button"
                        className="btn danger"
                        disabled={!canApprove || busy !== null}
                        onClick={() => decideFinalExecution("reject")}
                      >
                        {busy === selectedItem?.key ? "Recording…" : finalApproval.executionAction === "deploy" ? "Reject deployment" : "Reject merge"}
                      </button>
                      {approvalBlockReason && (
                        <Link className="btn primary" href={`/problems/${finalApproval.problemId}`}>
                          View issue
                          <ChevronRight size={14} />
                        </Link>
                      )}
                      <button
                        type="button"
                        className="btn primary"
                        disabled={!canApprove || busy !== null || Boolean(approvalBlockReason)}
                        onClick={() => decideFinalExecution("approve")}
                      >
                        {busy === selectedItem?.key
                          ? "Queueing execution…"
                          : finalApproval.executionAction === "deploy"
                            ? "Approve production deployment"
                            : "Approve and merge PR"}
                        {busy !== selectedItem?.key ? <Check size={14} /> : null}
                      </button>
                    </div>
                    </>
                  ) : (
                    <div className="approval-result-actions">
                      {finalApproval.attempt?.status === "Failed" ? (
                        <p className="callout warning" role="alert">
                          {finalApproval.executionAction === "deploy" ? "Deployment" : "Merge"} failed: {finalApproval.attempt.failureMessage}
                        </p>
                      ) : finalApproval.status === "Superseded" || finalApproval.status === "Expired" ? (
                        <p className="callout warning">
                          {finalApproval.status === "Superseded" ? "The reviewed PR changed. A new approval is required." : "This approval expired. A new approval is required."}
                        </p>
                      ) : null}
                      <div className="top-actions">
                        {finalApproval.status === "Approved" && finalApproval.attempt?.status === "Failed" ? (
                          <button
                            type="button"
                            className="btn primary"
                            disabled={!canApprove || busy !== null}
                            onClick={() => decideFinalExecution("approve")}
                          >
                            {busy === selectedItem?.key ? "Queueing retry…" : finalApproval.executionAction === "deploy" ? "Retry approved deployment" : "Retry approved merge"}
                          </button>
                        ) : null}
                        {!presentationDemo && <a
                          className="btn"
                          href={finalApproval.pullRequestUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open pull request
                        </a>}
                        <Link className="btn" href={`/agent-runs/${finalApproval.agentRunId}`}>
                          View result
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : null}
            {notice ? (
              <p
                className={`toast ${notice.kind}`}
                role={notice.kind === "error" ? "alert" : "status"}
              >
                {notice.text}
              </p>
            ) : null}
          </section>
        ) : (
          <section className="card approval-detail-empty">
            <h2>{tab === "pending" ? requirementReviews.length ? "No merge or coding approvals" : "Nothing needs your review" : "No decisions yet"}</h2>
            <Link className="btn" href="/problems">
              View issues
            </Link>
          </section>
        )}
      </div>
    </>
  );
}

type ApprovalTab = "pending" | "history";

type ApprovalKind = "engineering" | "final";

interface ApprovalItem {
  key: string;
  kind: ApprovalKind;
  workflow: EngineeringWorkflowView;
}

function pendingApprovalBlockReason(item: ApprovalItem, now = Date.now()): string | null {
  const { workflow } = item;
  const approval = item.kind === "engineering" ? workflow.approval : workflow.finalApproval;
  // A failed, approved execution can receive fresh authorization through its retry action.
  if (!approval || approval.status !== "Pending") return null;
  if (!(Date.parse(approval.expiresAt) > now)) return "This approval expired. Open the issue for a new review.";
  const codingApproval = workflow.approval;
  const prompt = workflow.prompt;
  const currentPrompt = prompt && codingApproval && prompt.status !== "Superseded"
    && prompt.contentHash === codingApproval.promptHash
    && prompt.repository === codingApproval.repository
    && prompt.baseBranch === codingApproval.baseBranch
    && prompt.baseSha === codingApproval.baseSha;
  if (!currentPrompt) return "This approval does not match the current expected behavior. Open the issue for a new review.";
  if (item.kind === "final") {
    const finalApproval = workflow.finalApproval!;
    if (codingApproval.status !== "Approved" || workflow.run?.approvalId !== codingApproval.id
      || finalApproval.agentRunId !== workflow.run?.id || finalApproval.problemId !== workflow.problemId
      || finalApproval.repository !== codingApproval.repository || finalApproval.baseBranch !== codingApproval.baseBranch) {
      return "This approval does not match the current result. Open the issue for a new review.";
    }
    if (finalApproval.releaseVerification?.scopeAssessment.compatible === false) {
      return "The changes need new verification before approval.";
    }
  }
  return null;
}
