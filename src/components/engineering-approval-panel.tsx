"use client";

import { useState } from "react";
import { FileCode2, GitBranch, ShieldCheck } from "lucide-react";
import type { EngineeringWorkflowView } from "@/lib/engineering-workflow-repository";

async function decide(path: string, orgId: string): Promise<EngineeringWorkflowView> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "x-org-id": orgId,
      "idempotency-key": crypto.randomUUID(),
      "x-request-id": crypto.randomUUID(),
    },
  });
  const payload = (await response.json()) as { workflow?: EngineeringWorkflowView; error?: string };
  if (!response.ok || !payload.workflow) throw new Error(payload.error ?? "Approval action failed");
  return payload.workflow;
}

export function EngineeringApprovalPanel({
  orgId,
  initialWorkflow,
}: {
  orgId: string;
  initialWorkflow: EngineeringWorkflowView;
}) {
  const [workflow, setWorkflow] = useState(initialWorkflow);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const approval = workflow.approval;
  if (!approval || !workflow.prompt) return null;

  async function act(action: "approve" | "reject") {
    setBusy(true);
    setError(undefined);
    try {
      setWorkflow(await decide(`/api/engineering-approvals/${approval!.id}/${action}`, orgId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Approval action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card section-gap">
      <div className="card-head">
        <div><h2>Approval-bound coding run</h2><p className="subtle">One approval starts implementation in Tenki and an independent replay in a second fresh session. CloseSpan asks again only if the scope changes.</p></div>
        <span className={`badge ${approval.status === "Pending" ? "medium" : approval.status === "Approved" ? "success" : "high"}`}>{approval.status}</span>
      </div>
      <div className="card-body detail-stack">
        <div className="approval-facts">
          <div><div className="metric-label"><FileCode2 size={13} /> Prompt</div><strong>Revision {workflow.prompt.revision}</strong><p className="subtle">{approval.promptHash}</p></div>
          <div><div className="metric-label"><GitBranch size={13} /> Destination</div><strong>{approval.repository}</strong><p className="subtle">{approval.baseBranch}@{approval.baseSha}</p></div>
          <div><div className="metric-label"><ShieldCheck size={13} /> Capabilities</div><p className="subtle">{approval.allowedCapabilities.join(" · ")}</p></div>
        </div>
        <p className="subtle">Expires {new Date(approval.expiresAt).toLocaleString()}. Any prompt, repository, branch, permission, or base-commit change requires a new approval.</p>
        {approval.status === "Pending" && <div className="top-actions"><button type="button" className="btn primary" disabled={busy} onClick={() => act("approve")}>Approve one run</button><button type="button" className="btn danger" disabled={busy} onClick={() => act("reject")}>Reject</button></div>}
        {workflow.run && <div className="callout"><div className="callout-title">Run {workflow.run.status}</div><p className="subtle">{workflow.run.branchName}</p></div>}
        {error && <p className="toast error" role="alert">{error}</p>}
      </div>
    </section>
  );
}
