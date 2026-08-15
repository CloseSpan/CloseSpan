"use client";

import { LoaderCircle, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { EngineeringWorkflowView } from "@/lib/engineering-workflow-repository";

export function AgentRunRetryButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/agent-runs/${encodeURIComponent(runId)}/retry`,
        {
          method: "POST",
          headers: {
            "idempotency-key": `retry_run_${crypto.randomUUID().replaceAll("-", "")}`,
            "x-request-id": crypto.randomUUID(),
          },
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { workflow?: EngineeringWorkflowView; error?: string }
        | null;
      if (!response.ok || !payload?.workflow?.run) {
        throw new Error(payload?.error ?? "The coding run could not be retried.");
      }
      router.push(`/agent-runs/${payload.workflow.run.id}`);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The coding run could not be retried.",
      );
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className="btn primary"
        type="button"
        disabled={busy}
        onClick={retry}
      >
        {busy
          ? <LoaderCircle className="spin" size={16} aria-hidden="true" />
          : <RotateCcw size={16} aria-hidden="true" />}
        {busy ? "Starting fresh run…" : "Retry one coding run"}
      </button>
      {error ? <p className="toast error" role="alert">{error}</p> : null}
    </>
  );
}
