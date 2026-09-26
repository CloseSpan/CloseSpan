import type { EngineeringWorkflowView } from "./engineering-workflow-repository";
import type { ProblemPromptReview } from "./problem-prompt-review";

export interface RequirementReviewInput {
  review: ProblemPromptReview | null;
  currentPromptHash: string | null;
  currentPromptStatus?: string | null;
  preparationEnabled: boolean;
  closed?: boolean;
  demo?: boolean;
  presentationDemo?: boolean;
  storageReady?: boolean;
}

export function requirementNeedsReview(input: RequirementReviewInput): boolean {
  return !input.closed && !input.demo && !input.presentationDemo && input.storageReady !== false && input.preparationEnabled
    && !["Awaiting approval", "Approved", "Superseded"].includes(input.currentPromptStatus ?? "")
    && Boolean(input.review?.promptHash && input.review.promptHash === input.currentPromptHash)
    && input.review?.status === "Ready" && !input.review.confirmedAt && input.review.result?.verdict === "Passed";
}

export function currentIssueCodingApprovalId(workflow: EngineeringWorkflowView, now = Date.now()): string | null {
  return workflow.approval?.status === "Pending"
    && workflow.approval.promptHash === workflow.prompt?.contentHash
    && Date.parse(workflow.approval.expiresAt) > now ? workflow.approval.id : null;
}

export interface IssueReport {
  id: string;
  quote: string;
  source: string;
  customer: string;
}

export type IssueCodeReviewStatus = "Approved" | "Changes requested" | "Improving" | "Review requested" | "Blocked" | null;
export type IssueStep = "Report" | "Track" | "Implement" | "Review" | "Improve" | "Validate" | "Human merge";
export const issueSteps: IssueStep[] = ["Report", "Track", "Implement", "Review", "Improve", "Validate", "Human merge"];

export interface IssueCheck {
  label: string;
  value: string;
  state: "passed" | "failed" | "pending";
}

/** A small public projection: raw commands, prompts, logs and infrastructure stay on diagnostics. */
export interface IssueExecutionSummary {
  current: boolean;
  status: NonNullable<EngineeringWorkflowView["run"]>["status"];
  summary: string | null;
  previewUrl: string | null;
  pullRequestUrl: string | null;
  checks: IssueCheck[];
  criteria: Array<{ id: string; statement: string; status: string }>;
  remainingRisks: string[];
  manualChecks: string[];
  codeReview: IssueCodeReviewStatus;
  liveAppPassed: boolean;
  allChecksPassed: boolean;
  releaseCheck?: { status: "Passed" | "Failed"; current: boolean; evidence: string } | null;
  approval: {
    id: string;
    action: "merge_pull_request" | "deploy";
    status: NonNullable<EngineeringWorkflowView["finalApproval"]>["status"];
    attempt: NonNullable<NonNullable<EngineeringWorkflowView["finalApproval"]>["attempt"]>["status"] | null;
    compatible: boolean;
    autoDeploy: boolean;
  } | null;
}

function safeWebUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? value : null;
  } catch { return null; }
}

export function summarizeIssueExecution(
  workflow: EngineeringWorkflowView,
  codeReview: IssueCodeReviewStatus = null,
  now = Date.now(),
): IssueExecutionSummary | null {
  const run = workflow.run;
  if (!run) return null;
  const current = Boolean(run.approvalId && run.approvalId === workflow.approval?.id
    && workflow.approval?.promptHash === workflow.prompt?.contentHash
    && !["Superseded", "Rejected", "Expired"].includes(workflow.approval?.status ?? ""));
  const tests = run.testResults;
  const passedTests = tests.filter((test) => test.status === "passed").length;
  const failedTests = tests.filter((test) => test.status === "failed").length;
  const skippedTests = tests.filter((test) => test.status === "skipped").length;
  const passedCriteria = run.criterionResults.filter((criterion) => criterion.status === "Passed").length;
  const runtime = run.runtimeEvidence;
  const liveApp = runtime?.userStoryReplayMode === "live_application";
  const liveAppPassed = liveApp && runtime.userStoryReplay === "passed" && runtime.healthStatus === "passed";
  const allChecksPassed = current && passedTests > 0 && !failedTests && !skippedTests
    && passedCriteria > 0 && passedCriteria === run.criterionResults.length
    && run.independentVerification?.status === "passed";
  const finalApproval = workflow.finalApproval?.agentRunId === run.id ? workflow.finalApproval : null;
  const finalCurrent = finalApproval && current
    && !["Superseded", "Expired"].includes(finalApproval.status)
    && (finalApproval.status !== "Pending" || Date.parse(finalApproval.expiresAt) > now);
  return {
    current,
    status: run.status,
    summary: run.implementationSummary?.trim() || null,
    previewUrl: safeWebUrl(runtime?.previewUrl),
    pullRequestUrl: safeWebUrl(run.pullRequestUrl),
    checks: [
      { label: "Automated tests", value: tests.length
        ? [`${passedTests} passed`, failedTests ? `${failedTests} failed` : "", skippedTests ? `${skippedTests} skipped` : ""].filter(Boolean).join(" · ")
        : "Not run", state: failedTests ? "failed" : passedTests && !skippedTests ? "passed" : "pending" },
      { label: "Expected behavior", value: run.criterionResults.length ? `${passedCriteria} of ${run.criterionResults.length} checks passed` : "Not checked",
        state: run.criterionResults.some((criterion) => criterion.status === "Failed") ? "failed"
          : passedCriteria && passedCriteria === run.criterionResults.length ? "passed" : "pending" },
      { label: "Independent check", value: run.independentVerification?.status === "passed" ? "Passed"
        : run.independentVerification?.status === "failed" ? "Failed" : "Not completed",
        state: run.independentVerification?.status ?? "pending" },
      { label: "Live app test", value: liveApp && (runtime.healthStatus === "failed" || runtime.userStoryReplay === "failed") ? "Failed"
        : liveAppPassed ? "Passed" : "Not run",
        state: liveApp && (runtime.healthStatus === "failed" || runtime.userStoryReplay === "failed") ? "failed" : liveAppPassed ? "passed" : "pending" },
    ],
    criteria: run.criterionResults.filter((criterion) => criterion.statement?.trim()).map((criterion) => ({
      id: criterion.criterionId, statement: criterion.statement!, status: criterion.status,
    })),
    remainingRisks: run.remainingRisks ?? [],
    manualChecks: run.manualVerification ?? [],
    codeReview: current ? codeReview : null,
    liveAppPassed: Boolean(current && liveAppPassed),
    allChecksPassed,
    releaseCheck: workflow.releaseEvidence ? {
      status: workflow.releaseEvidence.status,
      current: current && workflow.releaseEvidence.specificationRevision === workflow.specification?.revision,
      evidence: workflow.releaseEvidence.evidence,
    } : null,
    approval: finalApproval ? {
      id: finalApproval.id,
      action: finalApproval.executionAction,
      status: finalApproval.status,
      attempt: finalApproval.attempt?.status ?? null,
      compatible: Boolean(finalCurrent && finalApproval.releaseVerification?.scopeAssessment.compatible !== false),
      autoDeploy: finalApproval.autoDeployOnMerge,
    } : null,
  };
}

export interface IssueProgress {
  label: string;
  detail: string;
  step: IssueStep;
  tone: "neutral" | "attention" | "success";
  refreshing: boolean;
}

export function issueProgress(input: RequirementReviewInput & {
  execution?: IssueExecutionSummary | null;
  approvalId?: string | null;
}): IssueProgress {
  if (input.presentationDemo) {
    const sample = issueProgress({ ...input, presentationDemo: false, demo: false, preparationEnabled: true });
    return { ...sample, detail: "Read-only sample. No live work is running.", refreshing: false };
  }
  const result = (label: string, detail: string, step: IssueStep, tone: IssueProgress["tone"] = "neutral", refreshing = false): IssueProgress =>
    ({ label, detail, step, tone, refreshing });
  if (input.closed) return result("Closed", "This issue is closed.", "Track");
  if (input.demo) return result("Demo issue", "Sample issue. No live work is running.", "Track");
  const execution = input.execution;
  if (execution?.current) {
    const approval = execution.approval;
    if (execution.releaseCheck?.current && execution.releaseCheck.status === "Failed") return result("Release needs attention", "The release check failed. Review the result before taking further action.", "Validate", "attention");
    if (approval?.attempt === "Succeeded") return result(approval.action === "deploy" ? "Deployed" : "Merged", approval.action === "deploy" ? "The approved deployment completed." : "The approved fix was merged.", "Human merge", "success");
    if (approval?.attempt === "Running" || approval?.attempt === "Queued") return result(approval.action === "deploy" ? "Deploying" : "Merging", "The approved action is in progress.", "Human merge", "neutral", true);
    if (approval?.attempt === "Failed") return result("Needs attention", "The approved action could not complete. Review the result before retrying.", "Human merge", "attention");
    if (execution.codeReview === "Improving") return result("Improving the fix", "The agent is addressing review feedback. The updated fix will be checked again.", "Improve", "neutral", true);
    if (execution.codeReview === "Changes requested" || execution.codeReview === "Blocked") return result("Needs improvement", "Code review found changes that need attention.", "Improve", "attention");
    if (execution.status === "Failed") return result("Needs attention", "The implementation could not complete. A workspace administrator can inspect the failure.", "Implement", "attention");
    if (execution.status === "Cancelled") return result("Work stopped", "This implementation was cancelled.", "Implement", "attention");
    if (execution.status === "No changes") return result("No fix produced", "The run finished without an implementation to review.", "Implement", "attention");
    if (execution.status === "Queued") return result("Implementation queued", "The agent is waiting to start the approved work.", "Implement", "neutral", true);
    if (execution.status === "Running") return result("Implementing", "The agent is working on the fix. Results will appear here.", "Implement", "neutral", true);
    if (approval && !approval.compatible) return result("Review needs updating", "The recorded approval no longer covers the current result. A new review is needed.", "Validate", "attention");
    if (execution.checks.some((check) => check.state === "failed")) return result("Checks need attention", "One or more checks failed. The fix needs another pass.", "Improve", "attention");
    if (approval?.status === "Rejected") return result("Changes requested", "The final action was declined. The fix needs another review.", "Improve", "attention");
    if (approval?.status === "Pending") return result(approval.action === "deploy" ? "Review deployment" : "Review for merge", "Review the recorded results before approving the final action.", "Human merge");
    if (execution.codeReview === "Approved") return result("Checking the fix", "Code review is complete for the recorded change. Remaining checks and final approval are still required.", "Validate", "neutral", true);
    if (execution.codeReview === "Review requested" || execution.status === "Draft PR opened") return result("Reviewing the fix", "The proposed change is available. Code review and final approval are still required.", "Review", "neutral", true);
    return result("Checking the fix", "Implementation results are recorded. Remaining checks must finish before final review.", "Validate", "neutral", true);
  }
  if (input.approvalId) return result("Approve implementation", "The requirement is recorded. One coding run is waiting for approval.", "Implement");
  if (input.storageReady === false) return result("Setup required", "An administrator needs to finish workspace setup before this issue can continue.", "Track", "attention");
  if (!input.preparationEnabled) return result("Automation paused", "Work on this issue is paused by workspace policy.", "Track");
  if (input.review?.status === "Needs attention") return result("Needs attention", "The agent could not prepare this issue. An administrator can inspect the blocker.", "Track", "attention");
  if (requirementNeedsReview(input)) return result("Confirm expected behavior", "Review the outcome below so the agent works toward the right result.", "Track");
  const current = Boolean(input.review?.promptHash && input.review.promptHash === input.currentPromptHash);
  if (current && ["Preparing tests", "Awaiting approval"].includes(input.review?.status ?? "")) return result("Preparing implementation", "The agent is preparing the next step under workspace policy.", "Implement", "neutral", true);
  if (current && input.review?.confirmedAt) return result("Preparing implementation", "Expected behavior is confirmed. The agent is preparing the next step under workspace policy.", "Implement", "neutral", true);
  if (input.review && !current) return result("Updating the requirement", "The issue changed. The latest expected behavior needs to be checked again.", "Track", "neutral", true);
  return result(input.review ? "Understanding the issue" : "Reported", input.review
    ? "The agent is checking the reported behavior and expected outcome."
    : "The issue is recorded and waiting for background preparation.", "Track", "neutral", true);
}
