"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RunFinding } from "@/lib/agent-run-findings";

export function AgentRunFinding({ finding, linkedIssue, canCreate, storageReady }: {
  finding: RunFinding; linkedIssue?: string; canCreate: boolean; storageReady: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function createIssue() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/agent-runs/findings/${finding.id}/issue`, {
        method: "POST", headers: { "idempotency-key": `finding_${crypto.randomUUID()}` },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not save the finding.");
      router.push(`/problems/${encodeURIComponent(body.problemId)}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the finding.");
    } finally { setBusy(false); }
  }
  return (
    <details className="agent-finding">
      <summary>{finding.title}{finding.runIds.length > 1 ? ` · ${finding.runIds.length} runs` : ""}{finding.resolved ? " · Superseded" : ""}</summary>
      <div className="agent-finding-body">
        <p>{finding.explanation}</p>
        {finding.runIds.length > 1 && <p>The same finding appeared in {finding.runIds.length} runs for this issue. Repetition alone does not prove a retry loop.</p>}
        <p>{finding.nextStep}</p>
        <p className="subtle">Rule-based evidence from the latest 100 runs. Root cause is unconfirmed.</p>
        <div className="agent-finding-links">
          {finding.runIds.slice(0, 5).map((id, index) => <Link key={id} className="text-link" href={`/agent-runs/${id}/details`}>Evidence {index + 1}</Link>)}
          {finding.runIds.length > 5 && <span className="subtle">{finding.runIds.length - 5} more matching runs</span>}
          <Link className="text-link" href={`/problems/${finding.sourceProblemId}`}>Source issue</Link>
          {linkedIssue && <Link className="text-link" href={`/problems/${linkedIssue}`}>View linked issue</Link>}
        </div>
        {!finding.resolved && canCreate && storageReady && <button type="button" className="btn" onClick={createIssue} disabled={busy}>{busy ? "Saving…" : linkedIssue ? "Update issue evidence" : "Create issue"}</button>}
        {!finding.resolved && canCreate && !storageReady && <p className="subtle">Issue creation requires database setup.</p>}
        {error && <p role="alert">{error}</p>}
      </div>
    </details>
  );
}
