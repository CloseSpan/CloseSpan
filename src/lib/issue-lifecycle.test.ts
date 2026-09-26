import { describe, expect, it } from "vitest";
import { issueProgress, requirementNeedsReview, summarizeIssueExecution } from "./issue-lifecycle";
import type { RequirementReviewInput } from "./issue-lifecycle";
import type { EngineeringWorkflowView } from "./engineering-workflow-repository";

const requirement: RequirementReviewInput = {
  preparationEnabled: true, currentPromptHash: "a".repeat(64),
  review: { status: "Ready", version: 1, promptHash: "a".repeat(64), userStory: "The menu includes archive.",
    feedback: "", result: { verdict: "Passed", summary: "Covered", changes: [] }, failureMessage: null,
    confirmedAt: null, updatedAt: "2026-09-11T00:00:00Z" },
};

function workflow(): EngineeringWorkflowView {
  return {
    problemId: "issue-1", specification: null, readiness: { ready: true, issues: [] }, verification: null, releaseEvidence: null,
    prompt: { id: "prompt-1", revision: 1, status: "Approved", artifactPath: "secret.prompt", content: "private prompt body", contentHash: "a".repeat(64),
      repository: "acme/private", baseBranch: "main", baseSha: "c".repeat(40), createdAt: "2026-09-11T00:00:00Z" },
    approval: { id: "coding-1", status: "Approved", expiresAt: "2027-09-11T00:00:00Z", promptHash: "a".repeat(64),
      repository: "acme/private", baseBranch: "main", baseSha: "c".repeat(40), allowedCapabilities: [] },
    run: { id: "run-1", approvalId: "coding-1", status: "Draft PR opened", branchName: "agent/fix", changedFiles: ["src/menu.ts"],
      testResults: [{ command: "npm test private-command", status: "passed", output: "private log" }],
      criterionResults: [{ criterionId: "AC-1", statement: "The menu includes archive.", status: "Passed", evidence: "private evidence", scenarioIds: ["TEST-1"] }],
      failureCode: null, failureMessage: null, pullRequestUrl: "https://github.com/acme/private/pull/1",
      queuedAt: "2026-09-11T00:00:00Z", completedAt: "2026-09-11T01:00:00Z", implementationSummary: "Added archive to the menu.",
      runtimeEvidence: { configured: true, healthStatus: "passed", applicationPort: 3000, previewUrl: "https://preview.example.test",
        interactions: [], logExcerpt: [], userStoryReplay: "passed", userStoryReplayMode: "contract" },
      independentVerification: { provider: "Tenki Sandbox", sessionId: "private-session", status: "passed", completedAt: "2026-09-11T01:00:00Z", durationMs: 1000 } },
    finalApproval: { id: "merge-1", status: "Pending", expiresAt: "2027-09-11T00:00:00Z", problemId: "issue-1", agentRunId: "run-1",
      repository: "acme/private", baseBranch: "main", pullRequestNumber: 1, pullRequestUrl: "https://github.com/acme/private/pull/1", headSha: "d".repeat(40),
      targetEnvironment: null, executionAction: "merge_pull_request", autoDeployOnMerge: false, rollbackPlan: null, uiBaseline: null, releaseVerification: null,
      changedFiles: ["src/menu.ts"], testSummary: { passed: 1, failed: 0, skipped: 0 }, acceptanceSummary: { passed: 1, unresolved: 0 }, remainingRisks: [], attempt: null },
  };
}

describe("issue lifecycle evidence", () => {
  it("projects sample lifecycle evidence without live actions or background refresh", () => {
    const input = { ...requirement, presentationDemo: true, preparationEnabled: false };
    expect(requirementNeedsReview(input)).toBe(false);
    expect(issueProgress(input)).toMatchObject({ label: "Confirm expected behavior", refreshing: false, detail: "Read-only sample. No live work is running." });
    expect(issueProgress({ ...input, execution: summarizeIssueExecution(workflow()) })).toMatchObject({ label: "Review for merge", refreshing: false });
  });
  it("requires a passed, current, reviewable requirement", () => {
    expect(requirementNeedsReview(requirement)).toBe(true);
    expect(requirementNeedsReview({ ...requirement, currentPromptHash: "b".repeat(64) })).toBe(false);
    expect(requirementNeedsReview({ ...requirement, closed: true })).toBe(false);
    expect(requirementNeedsReview({ ...requirement, demo: true })).toBe(false);
    expect(requirementNeedsReview({ ...requirement, storageReady: false })).toBe(false);
    expect(requirementNeedsReview({ ...requirement, currentPromptStatus: "Approved" })).toBe(false);
    expect(requirementNeedsReview({ ...requirement, currentPromptStatus: "Awaiting approval" })).toBe(false);
  });
  it("does not equate requirement alignment or contract replay with a live app test", () => {
    const summary = summarizeIssueExecution(workflow())!;
    expect(summary.allChecksPassed).toBe(true);
    expect(summary.liveAppPassed).toBe(false);
    expect(summary.checks.find((item) => item.label === "Live app test")?.value).toBe("Not run");
    expect(issueProgress(requirement).label).toBe("Confirm expected behavior");
    expect(issueProgress({ ...requirement, execution: summary }).label).toBe("Review for merge");
  });
  it("does not expose commands, infrastructure, prompts or logs in the public projection", () => {
    const json = JSON.stringify(summarizeIssueExecution(workflow()));
    for (const secret of ["private prompt body", "private-command", "private log", "private evidence", "private-session", "secret.prompt", "agent/fix", "applicationPort"]) expect(json).not.toContain(secret);
  });
  it("marks result evidence stale when either its requirement or its coding approval changed", () => {
    const changed = workflow();
    changed.prompt!.contentHash = "b".repeat(64);
    const summary = summarizeIssueExecution(changed, "Approved")!;
    expect(summary.current).toBe(false);
    expect(summary.allChecksPassed).toBe(false);
    expect(summary.approval?.compatible).toBe(false);
    expect(summary.codeReview).toBeNull();
    changed.prompt!.contentHash = "a".repeat(64);
    changed.approval!.id = "coding-2";
    expect(summarizeIssueExecution(changed)!.current).toBe(false);
  });
  it("rejects a final approval from another run or an expired approval", () => {
    const changed = workflow();
    changed.finalApproval!.agentRunId = "previous-run";
    expect(summarizeIssueExecution(changed)!.approval).toBeNull();
    changed.finalApproval!.agentRunId = "run-1";
    expect(summarizeIssueExecution(changed, null, Date.parse("2028-01-01"))!.approval?.compatible).toBe(false);
  });
  it("records live validation only when replay is in a healthy live application", () => {
    const changed = workflow();
    changed.run!.runtimeEvidence!.userStoryReplayMode = "live_application";
    expect(summarizeIssueExecution(changed)!.liveAppPassed).toBe(true);
    changed.run!.runtimeEvidence!.healthStatus = "failed";
    expect(summarizeIssueExecution(changed)!.liveAppPassed).toBe(false);
  });
  it("blocks unsafe preview links", () => {
    const changed = workflow();
    changed.run!.runtimeEvidence!.previewUrl = "javascript:alert(1)";
    expect(summarizeIssueExecution(changed)!.previewUrl).toBeNull();
  });
  it("never shows a passed live test when application health was not configured", () => {
    const data = workflow();
    data.run!.runtimeEvidence!.userStoryReplayMode = "live_application";
    data.run!.runtimeEvidence!.healthStatus = "not_configured";
    const summary = summarizeIssueExecution(data)!;
    expect(summary.liveAppPassed).toBe(false);
    expect(summary.checks.find((check) => check.label === "Live app test")?.state).toBe("pending");
  });
  it("keeps failed release checks visible after a completed merge and scopes them to the requirement", () => {
    const data = workflow();
    data.specification = { ...data.specification!, revision: 7 };
    data.releaseEvidence = { id: "release-1", status: "Failed", environment: "Production", evidence: "The export lost rows.",
      specificationRevision: 7, verifiedBy: "reviewer", verifiedAt: "2026-09-11T03:00:00Z" };
    data.finalApproval!.attempt = { id: "attempt-1", status: "Succeeded", resultSha: null, resultUrl: null, failureMessage: null };
    let summary = summarizeIssueExecution(data)!;
    expect(issueProgress({ ...requirement, execution: summary }).label).toBe("Release needs attention");
    expect(summary.releaseCheck?.evidence).toBe("The export lost rows.");
    data.specification.revision = 8;
    summary = summarizeIssueExecution(data)!;
    expect(summary.releaseCheck?.current).toBe(false);
    expect(summary.releaseCheck?.status).toBe("Failed");
  });
  it("shows correction progress and only records merged after successful execution", () => {
    const data = workflow();
    expect(issueProgress({ ...requirement, execution: summarizeIssueExecution(data, "Improving") }).step).toBe("Improve");
    data.finalApproval!.status = "Approved";
    data.finalApproval!.attempt = { id: "attempt-1", status: "Running", resultSha: null, resultUrl: null, failureMessage: null };
    expect(issueProgress({ ...requirement, execution: summarizeIssueExecution(data) }).label).toBe("Merging");
    data.finalApproval!.attempt.status = "Succeeded";
    expect(issueProgress({ ...requirement, execution: summarizeIssueExecution(data) }).label).toBe("Merged");
  });
});
