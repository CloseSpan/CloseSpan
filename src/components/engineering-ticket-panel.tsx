"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, ExternalLink, MonitorCheck, ShieldCheck } from "lucide-react";
import type {
  EngineeringWorkflowView,
  ImplementationPromptView,
  UserStoryPromptTestView,
} from "@/lib/engineering-workflow-repository";
import type { PddPromptReview } from "@/lib/pdd-prompt-review";
import type { PddPromptTimingSummary } from "@/lib/pdd-prompt-timing-repository";
import { userStoryInputIssue } from "@/lib/user-story-prompt-test";
import { RepositoryMatchReview } from "./repository-match-review";

interface AppliedPromptComparison {
  agentPrompt: ImplementationPromptView;
  improvedPrompt: ImplementationPromptView;
  testedUserStory: string;
}

export interface StructuredPddChange {
  summary: string;
  steps: string[];
}

function splitNumberedPddChanges(change: string): string[] {
  const normalized = change.trim().replace(/\s+/g, " ");
  const marker = /(^|\s)(\d+)\.\s+(?=[A-Z"'])/g;
  const matches = Array.from(normalized.matchAll(marker));
  if (matches.length === 0) return [];

  const firstStart = (matches[0].index ?? 0) + matches[0][1].length;
  if (firstStart !== 0) return [];

  return matches
    .map((match, index) => {
      const contentStart = (match.index ?? 0) + match[0].length;
      const nextMatch = matches[index + 1];
      const contentEnd = nextMatch
        ? (nextMatch.index ?? normalized.length) + nextMatch[1].length
        : normalized.length;
      return normalized.slice(contentStart, contentEnd).trim();
    })
    .filter(Boolean);
}

export function structurePddChange(change: string): StructuredPddChange {
  const normalized = change.trim().replace(/\s+/g, " ");
  const [summaryPart, instructionPart] = normalized.split(
    /\s*Follow these specific instructions:\s*/i,
    2,
  );
  const summary = (summaryPart || normalized)
    .replace(/^[-*]\s*/, "")
    .trim();
  if (!instructionPart) return { summary, steps: [] };

  const steps = instructionPart
    .split(/\s+(?=\d+\.\s+)/)
    .map((step) => step.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
  return { summary, steps };
}

export function structurePddChanges(changes: string[]): StructuredPddChange[] {
  return changes.flatMap((change) => {
    const numberedChanges = splitNumberedPddChanges(change);
    if (numberedChanges.length > 0) {
      return numberedChanges.map((summary) => ({ summary, steps: [] }));
    }
    return [structurePddChange(change)];
  });
}

export function estimatedPddProgress(
  elapsedMs: number,
  estimatedDurationMs: number,
): number {
  const estimate = Math.max(1, estimatedDurationMs);
  if (elapsedMs <= estimate) {
    return Math.round(4 + (91 * elapsedMs) / estimate);
  }
  const overtime = elapsedMs - estimate;
  return Math.min(99, Math.round(95 + 4 * (1 - Math.exp(-overtime / estimate))));
}

export function formatPddDuration(durationMs: number): string {
  const seconds = Math.max(1, Math.round(durationMs / 1_000));
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0
    ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
    : `${minutes}m ${remainingSeconds}s`;
}

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
  initialPddTiming = {
    estimatedDurationMs: 45_000,
    averageDurationMs: null,
    sampleCount: 0,
  },
}: {
  orgId: string;
  problemId: string;
  initialWorkflow: EngineeringWorkflowView;
  initialPddTiming?: PddPromptTimingSummary;
}) {
  const [workflow, setWorkflow] = useState(initialWorkflow);
  const [userStory, setUserStory] = useState(
    initialWorkflow.specification?.userStory ?? "",
  );
  const [storyTest, setStoryTest] = useState<UserStoryPromptTestView>();
  const [promptEvaluation, setPromptEvaluation] = useState<PddPromptReview>();
  const [busy, setBusy] = useState(false);
  const [pddProgress, setPddProgress] = useState(0);
  const [pddTiming, setPddTiming] = useState(initialPddTiming);
  const [pddBusy, setPddBusy] = useState(false);
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [pddProfileReady, setPddProfileReady] = useState(false);
  const [appliedPromptComparison, setAppliedPromptComparison] = useState<AppliedPromptComparison>();

  useEffect(() => {
    if (!busy) return;
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      setPddProgress(estimatedPddProgress(
        performance.now() - startedAt,
        pddTiming.estimatedDurationMs,
      ));
    }, 200);
    return () => window.clearInterval(timer);
  }, [busy, pddTiming.estimatedDurationMs]);

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
    setPddProgress(4);
    let nextTiming: PddPromptTimingSummary | undefined;
    try {
      const result = await request<{
        workflow: EngineeringWorkflowView;
        promptEvaluation: PddPromptReview;
        timing: PddPromptTimingSummary & { durationMs: number };
      }>(
        `/api/problems/${problemId}/engineering/test-story`,
        orgId,
        { userStory: userStory.trim() },
      );
      setWorkflow(result.workflow);
      setPromptEvaluation(result.promptEvaluation);
      nextTiming = result.timing;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The story could not be tested against the prompt.",
      );
    } finally {
      setPddProgress(100);
      await new Promise((resolve) => window.setTimeout(resolve, 280));
      setBusy(false);
      if (nextTiming) setPddTiming(nextTiming);
    }
  }

  async function applyImprovedPrompt() {
    if (!promptEvaluation?.suggestedRevision || !promptEvaluation.revisionReceipt) return;
    const agentPrompt = workflow.prompt;
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
      if (agentPrompt && result.workflow.prompt) {
        setAppliedPromptComparison({
          agentPrompt,
          improvedPrompt: result.workflow.prompt,
          testedUserStory: userStory.trim(),
        });
      }
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

  const promptStatus = workflow.prompt?.status ?? "No prompt yet";
  const verification = workflow.verification;
  const verificationReady = verification?.status === "Ready for approval";
  const ticketContextMissing = !workflow.specification || !workflow.readiness.ready;
  const pddReady = pddProfileReady && !ticketContextMissing;
  const canTestPrompt = Boolean(workflow.prompt) || Boolean(
    workflow.specification && workflow.readiness.ready,
  );
  const promptAligned = promptEvaluation?.verdict === "Passed";
  const recommendedChanges = promptEvaluation
    ? structurePddChanges(promptEvaluation.changes)
    : [];
  const displayedPromptStatus = promptEvaluation?.verdict ?? promptStatus;
  const currentPromptLabel = appliedPromptComparison
    && workflow.prompt?.id === appliedPromptComparison.improvedPrompt.id
    ? "Current improved prompt"
    : "Agent-written prompt";

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
        {workflow.prompt && (
          <section className="prompt-version-card" aria-label="Prompt currently under test">
            <div className="prompt-version-heading">
              <div>
                <span className="eyebrow">{currentPromptLabel}</span>
                <h3>Revision {workflow.prompt.revision}</h3>
              </div>
              <span className="badge brand">SHA {workflow.prompt.contentHash.slice(0, 10)}</span>
            </div>
            <p className="subtle">
              This is the exact prompt PDD will compare with the user story below.
            </p>
            <details className="prompt-content-disclosure">
              <summary>View prompt under test</summary>
              <pre className="prompt-evaluation-revision">{workflow.prompt.content}</pre>
            </details>
          </section>
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
            <span className={busy ? "pdd-testing-button-shimmer" : undefined}>
              {busy
                ? "Testing your prompt"
                : canTestPrompt
                  ? "Test with PDD"
                  : "Suggested prompt required"}
            </span>
          </button>
        </div>

        {busy && (
          <div className="pdd-testing-progress" role="status" aria-live="polite">
            <div className="pdd-testing-progress-copy">
              <strong className="pdd-testing-shimmer-text">PDD is testing your prompt</strong>
              <span>{pddProgress}%</span>
            </div>
            <p className="pdd-testing-progress-detail">
              Comparing the agent prompt with your user story. {pddTiming.sampleCount > 0
                ? `Recent successful tests average ${formatPddDuration(pddTiming.estimatedDurationMs)}.`
                : `The first run uses a ${formatPddDuration(pddTiming.estimatedDurationMs)} estimate.`}
            </p>
            <div
              className="pdd-testing-progress-track"
              role="progressbar"
              aria-label="PDD prompt evaluation in progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pddProgress}
            >
              <span style={{ inlineSize: `${pddProgress}%` }} />
            </div>
          </div>
        )}

        {promptEvaluation && (
          <div
            className={`callout pdd-evaluation-result ${promptAligned ? "success" : "warning"}`}
            role="status"
          >
            <div className="callout-title">
              {promptAligned ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
              {promptAligned
                ? "PDD passed"
                : `PDD found ${recommendedChanges.length} ${recommendedChanges.length === 1 ? "change" : "changes"}`}
            </div>
            <p>{promptEvaluation.summary}</p>
            {recommendedChanges.length > 0 && (
              <section aria-labelledby="pdd-recommended-changes">
                <strong id="pdd-recommended-changes">Recommended changes</strong>
                <div className="pdd-change-list">
                  {recommendedChanges.slice(0, 8).map((structured, index) => (
                    <article className="pdd-change-card" key={`${index}-${structured.summary}`}>
                      <span className="pdd-change-number">{index + 1}</span>
                      <div>
                        <h4>{structured.summary}</h4>
                        {structured.steps.length > 0 && (
                          <ol>
                            {structured.steps.map((step) => <li key={step}>{step}</li>)}
                          </ol>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
            {promptEvaluation.suggestedRevision && (
              <div className="top-actions pdd-evaluation-actions">
                <button type="button" className="btn primary" disabled={revisionBusy} onClick={applyImprovedPrompt}>
                  <CheckCircle2 size={14} />
                  {revisionBusy ? "Applying…" : "Apply improved prompt"}
                </button>
                <button type="button" className="btn secondary" disabled={busy || revisionBusy} onClick={testAgainstPrompt}>
                  Test again
                </button>
              </div>
            )}
            <details className="pdd-evaluation-technical">
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

        {appliedPromptComparison && (
          <section className="prompt-comparison" aria-labelledby="prompt-comparison-title">
            <div className="prompt-comparison-heading">
              <div>
                <span className="eyebrow">PDD revision history</span>
                <h3 id="prompt-comparison-title">Agent prompt and applied improvement</h3>
              </div>
              <span className="badge success">Improved prompt is current</span>
            </div>
            <p className="subtle">
              Tested against: <strong>{appliedPromptComparison.testedUserStory}</strong>
            </p>
            <div className="prompt-comparison-grid">
              <article className="prompt-comparison-version">
                <div className="prompt-version-heading">
                  <div>
                    <span className="eyebrow">Original</span>
                    <h4>Agent-written prompt · revision {appliedPromptComparison.agentPrompt.revision}</h4>
                  </div>
                  <span className="badge">Tested</span>
                </div>
                <pre className="prompt-evaluation-revision">{appliedPromptComparison.agentPrompt.content}</pre>
              </article>
              <article className="prompt-comparison-version current">
                <div className="prompt-version-heading">
                  <div>
                    <span className="eyebrow">Applied</span>
                    <h4>Improved prompt · revision {appliedPromptComparison.improvedPrompt.revision}</h4>
                  </div>
                  <span className="badge success">Current</span>
                </div>
                <pre className="prompt-evaluation-revision">{appliedPromptComparison.improvedPrompt.content}</pre>
              </article>
            </div>
          </section>
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
                <Link className="btn primary" href="/approvals">
                  Review execution approval
                </Link>
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

        {workflow.releaseEvidence && (
          <div
            className={`callout ${workflow.releaseEvidence.status === "Failed" ? "warning" : ""}`}
            role="region"
            aria-label="Production release verification"
          >
            <div className="callout-title">
              <MonitorCheck size={14} />
              Production verification {workflow.releaseEvidence.status.toLowerCase()}
            </div>
            <p className="subtle">{workflow.releaseEvidence.evidence}</p>
            {workflow.releaseEvidence.productionVerification ? (
              <>
                <div className="release-verification-sections" role="list" aria-label="Production verification sections">
                  {([
                    ["Backend", workflow.releaseEvidence.productionVerification.backend],
                    ["Frontend", workflow.releaseEvidence.productionVerification.frontend],
                  ] as const).map(([label, section]) => (
                    <div className="release-verification-section" role="listitem" key={label}>
                      <span>
                        {section.status === "Passed" ? (
                          <CheckCircle2 size={14} aria-hidden="true" />
                        ) : section.status === "Failed" ? (
                          <AlertCircle size={14} aria-hidden="true" />
                        ) : (
                          <ShieldCheck size={14} aria-hidden="true" />
                        )}
                        <strong>{label}</strong>
                      </span>
                      <span className="subtle">
                        {section.status} · {section.passedChecks} of {section.totalChecks} checks passed
                      </span>
                    </div>
                  ))}
                </div>
                <p className="subtle">Environment: {workflow.releaseEvidence.environment}</p>
                <div className="top-actions">
                  {workflow.releaseEvidence.productionVerification.captures.map((capture) => (
                    <a
                      className="btn secondary"
                      href={`/api/release-verifications/${workflow.releaseEvidence!.productionVerification!.jobId}/artifacts/${encodeURIComponent(capture.key)}`}
                      target="_blank"
                      rel="noreferrer"
                      key={capture.key}
                    >
                      {capture.viewport} screenshot <ExternalLink size={13} />
                    </a>
                  ))}
                </div>
              </>
            ) : null}
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
