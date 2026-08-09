"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, ShieldCheck } from "lucide-react";
import type {
  EngineeringWorkflowView,
  UserStoryPromptTestView,
} from "@/lib/engineering-workflow-repository";
import type { PddPromptReview } from "@/lib/pdd-prompt-review";
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
  const [promptEvaluation, setPromptEvaluation] = useState<PddPromptReview>();
  const [busy, setBusy] = useState(false);
  const [pddBusy, setPddBusy] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
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
    setNotice(undefined);
    setStoryTest(undefined);
    setPromptEvaluation(undefined);
    try {
      const result = await request<{
        workflow: EngineeringWorkflowView;
        promptEvaluation: PddPromptReview;
      }>(
        `/api/problems/${problemId}/engineering/test-story`,
        orgId,
        { userStory: userStory.trim() },
      );
      setWorkflow(result.workflow);
      setPromptEvaluation(result.promptEvaluation);
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

  async function applyImprovedPrompt() {
    if (!promptEvaluation?.suggestedRevision || !promptEvaluation.revisionReceipt) return;
    setRevisionBusy(true);
    setError(undefined);
    try {
      const result = await request<{ workflow: EngineeringWorkflowView }>(
        `/api/problems/${problemId}/engineering/apply-pdd-revision`,
        orgId,
        {
          userStory: userStory.trim(),
          currentPromptHash: promptEvaluation.promptHash,
          revisedPrompt: promptEvaluation.suggestedRevision,
          revisionReceipt: promptEvaluation.revisionReceipt,
        },
      );
      setWorkflow(result.workflow);
      setPromptEvaluation(undefined);
      setStoryTest(undefined);
      setNotice("Improved prompt applied. Test it with PDD again before approval.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The improved prompt could not be applied.");
    } finally {
      setRevisionBusy(false);
    }
  }

  async function generateAcceptanceTests() {
    setPddBusy(true);
    setError(undefined);
    setStoryTest(undefined);
    try {
      const result = await request<{
        workflow: EngineeringWorkflowView;
        storyTest: UserStoryPromptTestView;
      }>(
        `/api/problems/${problemId}/engineering/generate-acceptance`,
        orgId,
        {
          userStory: userStory.trim(),
          alignmentReceipt: promptEvaluation?.alignmentReceipt,
        },
      );
      setWorkflow(result.workflow);
      setStoryTest(result.storyTest);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Repository acceptance tests could not be generated.",
      );
    } finally {
      setPddBusy(false);
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
  const ticketContextMissing = !workflow.specification || !workflow.readiness.ready;
  const pddReady = pddProfileReady && !ticketContextMissing;
  const canTestPrompt = Boolean(workflow.prompt) || Boolean(
    workflow.specification && workflow.readiness.ready,
  );
  const promptAligned = promptEvaluation?.verdict === "Passed";
  const displayedPromptStatus = promptEvaluation?.verdict ?? promptStatus;

  return (
    <section className="card section-gap" id="engineering-ticket">
      <div className="card-head">
        <div>
          <h2>Improve the suggested prompt</h2>
          <p className="subtle">
            PDD compares the agent&apos;s prompt with your user story and identifies
            what to change. No repository or Tenki VM runs here.
          </p>
        </div>
        <span
          className={`badge ${verificationReady ? "success" : "medium"}`}
        >
          {displayedPromptStatus}
        </span>
      </div>

      <div className="card-body detail-stack">
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
              setPromptEvaluation(undefined);
              setError(undefined);
              setNotice(undefined);
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
            disabled={busy || !canTestPrompt}
            onClick={testAgainstPrompt}
          >
            <CheckCircle2 size={14} />
            {busy
              ? "Testing…"
              : canTestPrompt
                ? "Test with PDD"
                : "Suggested prompt required"}
          </button>
        </div>

        {promptEvaluation && (
          <div
            className={`callout ${promptAligned ? "success" : "warning"}`}
            role="status"
          >
            <div className="callout-title">
              {promptAligned ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
              {promptAligned
                ? "PDD passed"
                : `PDD found ${promptEvaluation.changes.length} ${promptEvaluation.changes.length === 1 ? "change" : "changes"}`}
            </div>
            <p>{promptEvaluation.summary}</p>
            {promptEvaluation.changes.length > 0 && (
              <>
                <strong>Change these</strong>
                <ul className="evidence-list">
                  {promptEvaluation.changes.slice(0, 3).map((change) => <li key={change}>{change}</li>)}
                </ul>
              </>
            )}
            {promptEvaluation.suggestedRevision && (
              <div className="top-actions">
                <button type="button" className="btn primary" disabled={revisionBusy} onClick={applyImprovedPrompt}>
                  <CheckCircle2 size={14} />
                  {revisionBusy ? "Applying…" : "Apply improved prompt"}
                </button>
                <button type="button" className="btn secondary" disabled={busy || revisionBusy} onClick={testAgainstPrompt}>
                  Test again
                </button>
              </div>
            )}
            <details>
              <summary>Technical details</summary>
              <p className="subtle">
                PDD {promptEvaluation.pddVersion} · {promptEvaluation.executionMode === "cloud" ? "PDD Cloud" : "local fallback"}
                {promptEvaluation.model ? ` · ${promptEvaluation.model}` : ""}
                {promptEvaluation.costUsd !== null ? ` · $${promptEvaluation.costUsd.toFixed(4)}` : ""}
              </p>
            </details>
          </div>
        )}

        {notice && (
          <div className="callout success" role="status">
            <div className="callout-title"><CheckCircle2 size={14} />Prompt updated</div>
            <p>{notice}</p>
          </div>
        )}

        {promptAligned && (
          <section className="detail-stack" aria-label="Repository acceptance tests">
            <div>
              <h3>Generate repository acceptance tests</h3>
              <p className="subtle">
                After prompt alignment, bind the approved repository context and let PDD create executable tests. This is the first step that needs repository access.
              </p>
            </div>
            <RepositoryMatchReview
              orgId={orgId}
              problemId={problemId}
              onPddProfileReady={setPddProfileReady}
            />
            {ticketContextMissing && (
              <div
                className="callout warning"
                id="ticket-context-readiness"
                role="status"
              >
                <div className="callout-title">
                  <AlertCircle size={14} />
                  {workflow.specification
                    ? "Complete the engineering ticket"
                    : "Engineering ticket specification required"}
                </div>
                <p className="subtle">
                  Repository-native PDD generation requires reviewed acceptance criteria, test commands, and code boundaries.
                </p>
                <ul className="evidence-list">
                  {workflow.specification ? (
                    workflow.readiness.issues.slice(0, 6).map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))
                  ) : (
                    <>
                      <li>Current behavior, expected behavior, reproduction steps, and business outcome</li>
                      <li>Measurable acceptance criteria mapped to test scenarios</li>
                      <li>Permitted code paths and required validation commands</li>
                      <li>Repository, base branch, and exact base commit</li>
                    </>
                  )}
                </ul>
                <Link className="btn secondary" href="/settings#prompt-drafts">
                  Review drafting policy
                </Link>
              </div>
            )}
            <div className="top-actions">
              <button
                type="button"
                className="btn primary"
                disabled={pddBusy || !pddReady}
                aria-describedby={ticketContextMissing ? "ticket-context-readiness" : undefined}
                onClick={generateAcceptanceTests}
              >
                <CheckCircle2 size={14} />
                {pddBusy
                  ? "Generating…"
                  : pddReady
                    ? "Generate repository acceptance tests"
                    : ticketContextMissing
                      ? "Complete ticket context"
                      : "Review repository first"}
              </button>
            </div>
          </section>
        )}

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
