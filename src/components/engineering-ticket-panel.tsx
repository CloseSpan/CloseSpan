"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, ShieldCheck } from "lucide-react";
import type {
  EngineeringWorkflowView,
  UserStoryPromptTestView,
} from "@/lib/engineering-workflow-repository";
import { userStoryInputIssue } from "@/lib/user-story-prompt-test";
import { RepositoryMatchReview } from "./repository-match-review";

async function request<T>(
  path: string,
  orgId: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-org-id": orgId,
      "idempotency-key": crypto.randomUUID(),
      "x-request-id": crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "The prompt test failed");
  return payload;
}

export function EngineeringTicketPanel({
  orgId,
  problemId,
  initialWorkflow,
}: {
  orgId: string;
  problemId: string;
  initialWorkflow: EngineeringWorkflowView;
}) {
  const [workflow, setWorkflow] = useState(initialWorkflow);
  const [userStory, setUserStory] = useState(
    initialWorkflow.specification?.userStory ?? "",
  );
  const [storyTest, setStoryTest] = useState<UserStoryPromptTestView>();
  const [busy, setBusy] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [pddProfileReady, setPddProfileReady] = useState(false);

  useEffect(() => {
    if (!workflow.verification || !["Queued", "Generating tests"].includes(workflow.verification.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/problems/${problemId}/engineering`, {
          headers: { "x-org-id": orgId },
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = await response.json() as { workflow: EngineeringWorkflowView };
        setWorkflow(payload.workflow);
        if (payload.workflow.verification) {
          setStoryTest({
            id: payload.workflow.verification.id,
            status: payload.workflow.verification.status,
            message: payload.workflow.verification.summary
              ?? payload.workflow.verification.failureMessage
              ?? "PDD is preparing the executable acceptance contract.",
            promptHash: payload.workflow.verification.promptHash,
          });
        }
      } catch {
        // A later poll or a manual refresh can recover from a transient read failure.
      }
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [orgId, problemId, workflow.verification]);

  async function testAgainstPrompt() {
    const issue = userStoryInputIssue(userStory);
    if (issue) {
      setStoryTest(undefined);
      setError(issue);
      return;
    }
    setBusy(true);
    setError(undefined);
    setStoryTest(undefined);
    try {
      const result = await request<{
        workflow: EngineeringWorkflowView;
        storyTest: UserStoryPromptTestView;
      }>(
        `/api/problems/${problemId}/engineering/test-story`,
        orgId,
        { userStory: userStory.trim() },
      );
      setWorkflow(result.workflow);
      setStoryTest(result.storyTest);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The story could not be tested against the prompt.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function decideApproval(action: "approve" | "reject") {
    const approval = workflow.approval;
    if (!approval) return;
    setApprovalBusy(true);
    setError(undefined);
    try {
      const result = await request<{ workflow: EngineeringWorkflowView }>(
        `/api/engineering-approvals/${approval.id}/${action}`,
        orgId,
      );
      setWorkflow(result.workflow);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Approval action failed",
      );
    } finally {
      setApprovalBusy(false);
    }
  }

  const promptStatus = workflow.prompt?.status ?? "No prompt yet";
  const verification = workflow.verification;
  const verificationReady = verification?.status === "Ready for approval";

  return (
    <section className="card section-gap" id="engineering-ticket">
      <div className="card-head">
        <div>
          <h2>Test the implementation prompt</h2>
          <p className="subtle">
            Write the outcome as a user story. PDD will turn it into executable
            acceptance tests for the agent&apos;s proposed solution.
          </p>
        </div>
        <span
          className={`badge ${verificationReady ? "success" : "medium"}`}
        >
          {promptStatus}
        </span>
      </div>

      <div className="card-body detail-stack">
        <RepositoryMatchReview
          orgId={orgId}
          problemId={problemId}
          onPddProfileReady={setPddProfileReady}
        />
        {workflow.prompt?.status === "Draft" && (
          <div className="callout" role="status">
            <div className="callout-title">Agent-created draft ready for review</div>
            <p className="subtle">{workflow.prompt.draftReason}</p>
            {workflow.prompt.reviewerId && (
              <p className="subtle">
                Reviewer: {workflow.prompt.reviewerName ?? workflow.prompt.reviewerId}
                {workflow.prompt.reviewerNotificationRequested ? " · notification created" : ""}
                {workflow.prompt.reviewerEmailNotificationRequested ? " · email queued" : ""}
              </p>
            )}
            {!workflow.readiness.ready && (
              <>
                <p className="subtle">Complete these ticket details before PDD testing:</p>
                <ul className="evidence-list">
                  {workflow.readiness.issues.slice(0, 6).map((issue) => <li key={issue}>{issue}</li>)}
                </ul>
              </>
            )}
          </div>
        )}
        <label className="field">
          User story
          <textarea
            rows={5}
            value={userStory}
            placeholder="As a customer, I want…, so that…"
            onChange={(event) => {
              setUserStory(event.target.value);
              setStoryTest(undefined);
              setError(undefined);
            }}
          />
        </label>
        <p className="subtle">
          Use the format: As a…, I want…, so that…
        </p>

        <div className="top-actions">
          <button
            type="button"
            className="btn primary"
            disabled={busy || !pddProfileReady}
            onClick={testAgainstPrompt}
          >
            <CheckCircle2 size={14} />
            {busy
              ? "Queuing…"
              : pddProfileReady
                ? "Generate acceptance test"
                : "Review repository first"}
          </button>
        </div>

        {storyTest && (
          <div
            className={`callout ${storyTest.status === "Failed" ? "warning" : ""}`}
            role="status"
          >
            <div className="callout-title">
              {storyTest.status === "Ready for approval" ? (
                <CheckCircle2 size={14} />
              ) : (
                <AlertCircle size={14} />
              )}
              {storyTest.status === "Ready for approval"
                ? "Executable contract ready"
                : storyTest.status}
            </div>
            <p className="subtle">{storyTest.message}</p>
            <p className="subtle">Prompt SHA-256: {storyTest.promptHash}</p>
          </div>
        )}

        {verificationReady && verification && (
          <div className="callout" role="region" aria-label="PDD acceptance contract">
            <div className="callout-title">
              <CheckCircle2 size={14} />
              What the proposed solution must prove
            </div>
            <p className="subtle">{verification.summary}</p>
            <ul className="evidence-list">
              {verification.generatedTests.map((test) => (
                <li key={test.path}>
                  <strong>{test.path}</strong> — run with <code>{test.command}</code>
                </li>
              ))}
            </ul>
            <details>
              <summary>Technical details</summary>
              <p className="subtle">
                PDD {verification.pddVersion} · model {verification.model ?? "provider default"}
                {verification.costUsd === null ? ` · budget $${verification.budgetUsd.toFixed(2)}` : ` · cost $${verification.costUsd.toFixed(4)}`}
              </p>
              <p className="subtle">Generated files are hash-locked and cannot be edited by the coding agent.</p>
            </details>
          </div>
        )}

        {verificationReady &&
          workflow.approval?.status === "Pending" && (
            <div className="callout" role="region" aria-label="Implementation approval">
              <div className="callout-title">
                <ShieldCheck size={14} />
                Ready for one isolated run
              </div>
              <p className="subtle">
                This approval is bound to prompt revision {workflow.prompt?.revision},
                repository {workflow.approval.repository}, and base commit {workflow.approval.baseSha}.
                CloseSpan will run the coding agent in a fresh Tenki microVM, verify the
                result in a second isolated session, and open a draft pull request only
                if verification passes.
              </p>
              <div className="top-actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={approvalBusy}
                  onClick={() => decideApproval("approve")}
                >
                  {approvalBusy ? "Starting…" : "Approve one run"}
                </button>
                <button
                  type="button"
                  className="btn danger"
                  disabled={approvalBusy}
                  onClick={() => decideApproval("reject")}
                >
                  Reject
                </button>
              </div>
            </div>
          )}

        {workflow.run && (
          <div className="callout" role="status">
            <div className="callout-title">Run {workflow.run.status}</div>
            <p className="subtle">
              The approved run continues automatically. Open the run to follow coding,
              tests, independent verification, and the draft pull request.
            </p>
            <Link className="btn secondary" href={`/agent-runs/${workflow.run.id}`}>
              View run
            </Link>
          </div>
        )}

        {error && (
          <p className="toast error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
