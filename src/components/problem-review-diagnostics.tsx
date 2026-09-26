"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProblemPromptReview } from "@/lib/problem-prompt-review";

export function ProblemReviewDiagnostics({ problemId, review }: { problemId: string; review: ProblemPromptReview | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!review) return null;
  async function retry() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/problems/${encodeURIComponent(problemId)}/prompt-review/retry`, {
        method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ version: review!.version }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Retry could not be queued.");
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Retry failed."); }
    finally { setBusy(false); }
  }
  return <section className="card section-gap"><div className="card-head"><h2>Background review diagnostics</h2><span className="badge">{review.status}</span></div>
    <div className="card-body"><p>{review.failureMessage ?? review.result?.summary}</p>
      {review.status === "Needs attention" && <><p className="subtle">Queues up to three new prompt evaluations. Provider and sandbox charges may apply.</p>
        <button className="btn" type="button" disabled={busy} onClick={() => void retry()}>{busy ? "Queuing…" : "Retry background preparation"}</button></>}
      {error && <p className="toast error" role="alert">{error}</p>}
    </div></section>;
}
