"use client";

import { Button } from "@/components/ui";
import { useState } from "react";
import type { DemoState } from "@/lib/store";
import type { FeedbackItem } from "@/lib/domain";

async function workflowMutation(
  path: string,
  orgId: string,
  problemId?: string,
): Promise<DemoState> {
  const response = await fetch(problemId ? `${path}?problemId=${encodeURIComponent(problemId)}` : path, {
    method: "POST",
    headers: {
      "x-org-id": orgId,
      "idempotency-key": crypto.randomUUID(),
      "x-request-id": crypto.randomUUID(),
    },
  });
  const payload = (await response.json()) as {
    state?: DemoState;
    error?: string;
  };
  if (!response.ok || !payload.state)
    throw new Error(payload.error ?? "Action failed");
  return payload.state;
}

/**
 * Customer follow-up for one issue: drafts appear once its approved work has
 * merged, and can be approved only after the release is verified.
 */
export function IssueFollowUp({
  initialState,
  problem,
  orgId,
  feedbackItems,
}: {
  initialState: DemoState;
  problem: { id: string; title: string };
  orgId: string;
  feedbackItems: FeedbackItem[];
}) {
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const prepared = state.notifications !== "Not drafted";
  const verified = ["Verified", "Closed"].includes(state.problemStage);
  const affected = Array.from(
    feedbackItems
      .filter((item) => item.problemId === problem.id)
      .reduce((recipients, item) => {
        const customerKey = item.customer.trim().toLocaleLowerCase() || item.id;
        if (!recipients.has(customerKey)) recipients.set(customerKey, item);
        return recipients;
      }, new Map<string, FeedbackItem>())
      .values(),
  );
  async function approveDrafts() {
    if (affected.length === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      setState(await workflowMutation("/api/workflow/notify", orgId, problem.id));
      setNotice({
        kind: "success",
        text: "Customer drafts approved in the audited workflow; no external message was sent.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Action failed",
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card section-gap" id="follow-up" aria-labelledby="issue-follow-up-title">
      <div className="card-head">
        <div>
          <h2 id="issue-follow-up-title">Customer follow-up</h2>
          <p className="subtle">
            {!prepared
              ? "Drafts are prepared after the approved pull request merges."
              : verified
                ? "Verified release · deployment evidence recorded"
                : "Agent PR merged · awaiting release verification"}
          </p>
        </div>
        <span className={`badge ${verified ? "success" : prepared ? "brand" : ""}`}>
          {verified
            ? "Verified resolution"
            : prepared
              ? `${affected.length} draft${affected.length === 1 ? "" : "s"}`
              : "Waiting for agent merge"}
        </span>
      </div>
      {prepared && (
        <div className="card-body">
          {affected.length === 0 ? (
            <div className="callout" role="status">
              <div className="callout-title">No recipients found</div>
              <p className="subtle">
                This resolution has no distinct customer recipients yet.
                Draft approval will become available after linked feedback is
                imported.
              </p>
            </div>
          ) : (
            affected.map((customer) => (
              <article className="follow-card" key={customer.id}>
                <div className="split">
                  <div>
                    <strong>{customer.customer}</strong>
                    <p className="subtle">
                      Original conversation · {customer.source}
                    </p>
                  </div>
                  <span
                    className={`badge ${state.notifications === "Approved" ? "success" : ""}`}
                  >
                    {state.notifications === "Approved" ? "Approved" : "Draft"}
                  </span>
                </div>
                <p>
                  {verified
                    ? `Hi ${customer.customer}, we’ve resolved ${problem.title.toLowerCase()}. The verified fix is now available.`
                    : `Hi ${customer.customer}, we’re preparing an update about ${problem.title.toLowerCase()}. This draft will be finalized after release verification.`}
                </p>
                <small>
                  No sensitive data included · simulated delivery only
                </small>
              </article>
            ))
          )}
          <Button
            type="button"
            variant="primary"
            disabled={
              busy ||
              !verified ||
              affected.length === 0 ||
              state.notifications === "Approved"
            }
            onClick={approveDrafts}
          >
            {!verified
              ? "Awaiting release verification"
              : state.notifications === "Approved"
              ? "Drafts approved"
              : "Approve all drafts"}
          </Button>
          {notice && (
            <p
              className={`toast ${notice.kind}`}
              role={notice.kind === "error" ? "alert" : "status"}
            >
              {notice.text}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
