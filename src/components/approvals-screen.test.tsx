import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineeringWorkflowView } from "@/lib/engineering-workflow-repository";
import { ApprovalsScreen } from "./screens";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-11T19:30:00.000Z"));
});
afterEach(() => { vi.useRealTimers(); });

const workflow: EngineeringWorkflowView = {
  problemId: "prob_export",
  specification: null,
  readiness: { ready: false, issues: [] },
  prompt: {
    id: "prompt_1", revision: 1, status: "Approved", artifactPath: "prompts/export.prompt",
    content: "Fix empty CSV exports.", contentHash: "c".repeat(64), repository: "acme/api",
    baseBranch: "main", baseSha: "d".repeat(40), createdAt: "2026-08-11T19:00:00.000Z",
  },
  verification: null,
  approval: {
    id: "apr_coding_complete", status: "Approved", expiresAt: "2026-08-11T20:00:00.000Z",
    promptHash: "c".repeat(64), repository: "acme/api", baseBranch: "main", baseSha: "d".repeat(40),
    allowedCapabilities: [],
  },
  finalApproval: {
    id: "apr_final_1",
    status: "Pending",
    expiresAt: "2026-08-11T20:00:00.000Z",
    problemId: "prob_export",
    agentRunId: "run_1",
    repository: "acme/api",
    baseBranch: "main",
    pullRequestNumber: 42,
    pullRequestUrl: "https://github.com/acme/api/pull/42",
    headSha: "a".repeat(40),
    targetEnvironment: null,
    executionAction: "merge_pull_request",
    autoDeployOnMerge: false,
    rollbackPlan: null,
    uiBaseline: null,
    releaseVerification: {
      planHash: "b".repeat(64),
      backendChecks: 1,
      frontendJourneys: 2,
      backendRequired: true,
      frontendRequired: true,
      scopeAssessment: {
        schemaVersion: 1,
        compatible: true,
        declared: { backend: true, frontend: true },
        observed: { backend: true, frontend: false, unknown: true },
        recommended: { backend: true, frontend: true },
        files: [
          { path: "src/export.ts", surface: "unknown" },
          { path: "src/export.test.ts", surface: "neutral" },
        ],
        mismatches: [],
      },
    },
    changedFiles: ["src/export.ts", "src/export.test.ts"],
    testSummary: { passed: 4, failed: 0, skipped: 0 },
    acceptanceSummary: { passed: 2, unresolved: 0 },
    remainingRisks: [],
    attempt: null,
  },
  run: {
    id: "run_1", approvalId: "apr_coding_complete", status: "Draft PR opened", branchName: "closespan/export",
    changedFiles: ["src/export.ts"], testResults: [], criterionResults: [], failureCode: null, failureMessage: null,
    pullRequestUrl: "https://github.com/acme/api/pull/42", queuedAt: "2026-08-11T19:00:00.000Z", completedAt: "2026-08-11T19:02:00.000Z",
  },
  releaseEvidence: null,
};

const codingWorkflow: EngineeringWorkflowView = {
  ...workflow,
  finalApproval: null,
  prompt: {
    id: "prompt_1",
    revision: 11,
    status: "Awaiting approval",
    artifactPath: "prompts/export.prompt",
    content: "Fix empty CSV exports.",
    contentHash: "c".repeat(64),
    repository: "acme/api",
    baseBranch: "main",
    baseSha: "d".repeat(40),
    createdAt: "2026-08-11T19:00:00.000Z",
  },
  approval: {
    id: "apr_coding_1",
    status: "Pending",
    expiresAt: "2026-08-11T20:00:00.000Z",
    promptHash: "c".repeat(64),
    repository: "acme/api",
    baseBranch: "main",
    baseSha: "d".repeat(40),
    allowedCapabilities: ["repository:read", "repository:write", "tests:execute", "pull_requests:write:draft"],
  },
};

function renderApprovals(workflows: EngineeringWorkflowView[] = [workflow]) {
  return renderToStaticMarkup(
    <ApprovalsScreen
      problem={null}
      problemTitles={{
        prob_export: "Large CSV exports produce empty files",
        prob_filters: "Mobile dashboard freezes when filters change",
      }}
      initialEngineeringWorkflows={workflows}
      orgId="org_1"
      initialApprovalId={workflows[0]?.finalApproval
        ? workflows[0].finalApproval.status !== "Pending" ? workflows[0].finalApproval.id : undefined
        : workflows[0]?.approval?.status !== "Pending" ? workflows[0]?.approval?.id : undefined}
    />,
  );
}

function visibleText(markup: string) {
  return markup.replace(/<[^>]*>/g, " ");
}

describe("Approval Center", () => {
  it.each([workflow, codingWorkflow])("disables sample decisions even when the caller grants admin approval", (item) => {
    const html = renderToStaticMarkup(<ApprovalsScreen problem={null} problemTitles={{ prob_export: "CSV exports" }}
      initialEngineeringWorkflows={[item]} orgId="org_demo" canApprove presentationDemo />);
    expect(html).toContain("Demo · sample data");
    expect(html).toContain("Read-only decisions");
    const actions = html.match(/<button[^>]*>[^<]*(?:Approve|Reject)[\s\S]*?<\/button>/g) ?? [];
    expect(actions.length).toBeGreaterThan(0);
    for (const button of actions) expect(button).toContain('disabled=""');
    expect(html).not.toContain("https://github.com");
  });
  it("includes domain reviews without requiring an execution approval", () => {
    const markup = renderToStaticMarkup(<ApprovalsScreen problem={null} problemTitles={{}}
      initialEngineeringWorkflows={[]} orgId="org_1" canApprove={false}
      requirementReviews={[{ problemId: "prob_menu", title: "More menu actions", needsHelp: false }]} />);
    expect(markup).toContain("Confirm expected behavior");
    expect(markup).toContain('href="/problems/prob_menu"');
    expect(markup).not.toContain("Nothing needs your review");
  });

  it("does not show old decisions by default when no action is pending", () => {
    const markup = renderToStaticMarkup(<ApprovalsScreen problem={null} problemTitles={{}}
      initialEngineeringWorkflows={[{ ...workflow, finalApproval: { ...workflow.finalApproval!, status: "Approved" } }]}
      orgId="org_1" />);
    expect(markup).toContain("Nothing needs your review");
    expect(markup).toContain("History");
    expect(markup).not.toContain("Open pull request");
  });

  it("requires an administrator for merge decisions in the interface", () => {
    const markup = renderToStaticMarkup(<ApprovalsScreen problem={null} problemTitles={{}}
      initialEngineeringWorkflows={[workflow]} orgId="org_1" canApprove={false} />);
    expect(markup).toContain("An administrator must approve this action.");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Approve and merge PR/);
  });

  it("opens the approval requested by its deep link", () => {
    const markup = renderToStaticMarkup(<ApprovalsScreen problem={null} problemTitles={{}}
      initialEngineeringWorkflows={[workflow, { ...codingWorkflow, problemId: "prob_other" }]}
      orgId="org_1" initialApprovalId="apr_coding_1" />);
    expect(markup).toContain("Approve one run");
    expect(markup).not.toContain("Approve and merge PR");
  });

  it.each([{ workflows: [] }, { workflows: [workflow, codingWorkflow] }])("does not substitute another decision for a missing historical link (%#)", ({ workflows }) => {
    const markup = renderToStaticMarkup(<ApprovalsScreen problem={null} problemTitles={{}}
      initialEngineeringWorkflows={workflows} orgId="org_1" initialApprovalId="apr_previous" />);
    expect(markup).toContain("Decision unavailable");
    expect(markup).toContain('href="/approvals/apr_previous"');
    expect(markup).toContain('href="/approvals"');
    expect(markup).toContain('href="/problems"');
    expect(markup).not.toContain("Approve one run");
    expect(markup).not.toContain("Approve and merge PR");
    expect(markup).not.toContain("Nothing needs your review");
  });

  it("keeps an expired pending coding request visible without permitting approval", () => {
    const markup = renderApprovals([{ ...codingWorkflow,
      approval: { ...codingWorkflow.approval!, expiresAt: "2026-08-11T19:00:00.000Z" },
    }]);
    expect(markup).toContain("Needs attention");
    expect(markup).toContain("This approval expired. Open the issue for a new review.");
    expect(markup).toContain('href="/problems/prob_export"');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Approve one run/);
    expect(markup).toMatch(/<button(?![^>]*disabled)[^>]*>Reject run/);
  });

  it.each([
    { contentHash: "e".repeat(64) },
    { status: "Superseded" as const },
    { repository: "acme/other" },
    { baseBranch: "release" },
    { baseSha: "e".repeat(40) },
  ])("blocks coding approval when its prompt association changed (%#)", (change) => {
    const markup = renderApprovals([{ ...codingWorkflow, prompt: { ...codingWorkflow.prompt!, ...change } }]);
    expect(markup).toContain("Needs attention");
    expect(markup).toContain("Open the issue for a new review.");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Approve one run/);
  });

  it("keeps an expired pending merge visible without permitting approval", () => {
    const markup = renderApprovals([{ ...workflow,
      finalApproval: { ...workflow.finalApproval!, expiresAt: "2026-08-11T19:00:00.000Z" },
    }]);
    expect(markup).toContain("Needs attention");
    expect(markup).toContain("This approval expired. Open the issue for a new review.");
    expect(markup).toContain('href="/problems/prob_export"');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Approve and merge PR/);
    expect(markup).toMatch(/<button(?![^>]*disabled)[^>]*>Reject merge/);
  });

  it.each([
    { prompt: null },
    { prompt: { ...workflow.prompt!, contentHash: "e".repeat(64) } },
    { approval: { ...workflow.approval!, status: "Rejected" as const } },
    { run: null },
    { run: { ...workflow.run!, id: "run_new" } },
    { run: { ...workflow.run!, approvalId: "apr_new" } },
    { finalApproval: { ...workflow.finalApproval!, repository: "acme/other" } },
  ])("blocks pending merge approval when the recorded result is no longer current (%#)", (change) => {
    const markup = renderApprovals([{ ...workflow, ...change }]);
    expect(markup).toContain("Needs attention");
    expect(markup).toContain("Open the issue for a new review.");
    expect(markup).toContain('href="/problems/prob_export"');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Approve and merge PR/);
  });
  it("keeps the reviewed-commit boundary and call to action without technical fact cards", () => {
    const markup = renderApprovals();

    expect(markup).toContain("Action approvals");
    expect(markup).toContain("Merge PR #42");
    expect(markup).toContain("Approve and merge PR");
    expect(markup).toContain("Only the reviewed commit will be merged.");
    expect(markup).toContain("acme/api");
    expect(markup).toContain("main");
    expect(markup).toContain("4 tests passed · 2 acceptance checks passed");
    expect(markup).toContain(`href="https://github.com/acme/api/pull/42/commits/${"a".repeat(40)}"`);
    expect(markup).toContain("Review changes");
    expect(visibleText(markup)).not.toContain("a".repeat(40));
    expect(visibleText(markup)).not.toContain("b".repeat(64));
    expect(markup).not.toContain("Production verification contract");
    expect(markup).not.toContain("PR scope classification");
    expect(markup).not.toContain("No unresolved risks reported");
    expect(markup).not.toContain("Completed execution decisions remain available for traceability.");
    expect(markup).not.toContain("External action");
    expect(markup).not.toContain("Customer follow-up drafts");
    expect(markup).not.toContain("Customer communication");
  });

  it("shows a concise one-run boundary and explicit decisions for a pending coding run", () => {
    const markup = renderApprovals([codingWorkflow]);

    expect(markup).toContain("Coding run");
    expect(markup).toContain("Large CSV exports produce empty files");
    expect(markup).toContain("acme/api");
    expect(markup).toContain("main");
    expect(markup).toContain("One isolated coding run. Merge and deployment need separate approval.");
    expect(markup).toContain("Approve one run");
    expect(markup).toContain("Reject run");
    expect(markup).not.toContain("c".repeat(64));
    expect(markup).not.toContain("d".repeat(40));
    expect(markup).not.toContain("Allowed capabilities");
    expect(markup).not.toContain("repository:write");
    expect(markup).not.toContain("Revision 11");
  });

  it("keeps coding history to the result and run link", () => {
    const completed: EngineeringWorkflowView = {
      ...codingWorkflow,
      approval: { ...codingWorkflow.approval!, status: "Approved" },
      run: {
        id: "run_approved",
        status: "Draft PR opened",
        branchName: "closespan/export",
        changedFiles: ["src/export.ts"],
        testResults: [],
        criterionResults: [],
        failureCode: null,
        failureMessage: null,
        pullRequestUrl: "https://github.com/acme/api/pull/42",
        queuedAt: "2026-08-11T19:00:00.000Z",
        completedAt: "2026-08-11T19:02:00.000Z",
      },
    };
    const markup = renderApprovals([completed]);

    expect(markup).toContain("Approved");
    expect(markup).toContain('href="/agent-runs/run_approved"');
    expect(markup).toContain("View result");
    expect(markup).not.toContain("Approve one run");
    expect(markup).not.toContain("Reject run");
    expect(markup).not.toContain("One isolated coding run.");
    expect(markup).not.toContain("Approving starts");
    expect(markup).not.toContain("Authorization expires");
    expect(markup).not.toContain("Decision recorded in the shared audit trail.");
  });

  it("keeps production consequences and actual remaining risks visible", () => {
    const markup = renderApprovals([{
      ...workflow,
      finalApproval: {
        ...workflow.finalApproval!,
        autoDeployOnMerge: true,
        targetEnvironment: "production",
        remainingRisks: ["Large exports need a production smoke check."],
      },
    }]);

    expect(markup).toContain("automatically deploy");
    expect(markup).toContain("production");
    expect(markup).toContain("Large exports need a production smoke check.");
    expect(markup).toContain("Approve and merge PR");
  });

  it("distinguishes deployment from merge approval", () => {
    const markup = renderApprovals([{
      ...workflow,
      finalApproval: {
        ...workflow.finalApproval!,
        executionAction: "deploy",
        targetEnvironment: "production",
      },
    }]);

    expect(markup).toContain("Deploy PR #42");
    expect(markup).toContain("Only the reviewed commit will be deployed.");
    expect(markup).toContain("production");
    expect(markup).toContain("Approve production deployment");
    expect(markup).not.toContain("Approve and merge PR");
    expect(markup).not.toContain("Only the reviewed commit will be merged.");
  });

  it("locks merge approval when changed files exceed the sealed Prompt Testing scope", () => {
    const blockedWorkflow: EngineeringWorkflowView = {
      ...workflow,
      finalApproval: workflow.finalApproval
        ? {
            ...workflow.finalApproval,
            releaseVerification: workflow.finalApproval.releaseVerification
              ? {
                  ...workflow.finalApproval.releaseVerification,
                  backendRequired: false,
                  scopeAssessment: {
                    schemaVersion: 1,
                    compatible: false,
                    declared: { backend: false, frontend: true },
                    observed: { backend: true, frontend: true, unknown: false },
                    recommended: { backend: true, frontend: true },
                    files: [{ path: "src/app/api/export/route.ts", surface: "backend" }],
                    mismatches: [
                      "The PR contains backend or shared changes, but backend production verification is not approved in the Prompt Testing contract.",
                    ],
                  },
                }
              : null,
          }
        : null,
    };
    const markup = renderToStaticMarkup(
      <ApprovalsScreen
        problem={null}
        problemTitles={{ prob_export: "Large CSV exports produce empty files" }}
        initialEngineeringWorkflows={[blockedWorkflow]}
        orgId="org_1"
      />,
    );

    expect(markup).toContain("Verification scope changed");
    expect(markup).toContain("View issue");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Approve and merge PR/);
  });

  it("keeps failed merge feedback and the approved retry action", () => {
    const markup = renderApprovals([{
      ...workflow,
      finalApproval: {
        ...workflow.finalApproval!,
        status: "Approved",
        expiresAt: "2026-08-11T19:00:00.000Z",
        attempt: {
          id: "attempt_failed",
          status: "Failed",
          resultSha: null,
          resultUrl: null,
          failureMessage: "Branch protection requires another check.",
        },
      },
    }]);

    expect(markup).toContain("Failed");
    expect(markup).toContain("Branch protection requires another check.");
    expect(markup).toContain("Retry approved merge");
    expect(markup).toMatch(/<button(?![^>]*disabled)[^>]*>Retry approved merge/);
    expect(markup).not.toContain("This approval expired.");
    expect(markup).toContain("Open pull request");
    expect(markup).toContain("View result");
    expect(markup).not.toContain("Approve and merge PR");
  });

  it.each(["Rejected", "Expired", "Superseded"] as const)("preserves the %s history state without a fresh approve action", (status) => {
    const markup = renderApprovals([{
      ...workflow,
      finalApproval: { ...workflow.finalApproval!, status },
    }]);

    expect(markup).toContain(status);
    expect(markup).toContain("Open pull request");
    expect(markup).toContain("View result");
    expect(markup).not.toContain("Approve and merge PR");
    expect(markup).not.toContain("Retry approved merge");
    expect(markup).not.toContain("Only the reviewed commit will be merged.");
  });

  it("uses a minimal empty state with an issues call to action", () => {
    const markup = renderApprovals([{ ...workflow, finalApproval: null, approval: null, run: null }]);

    expect(markup).toContain("Action approvals");
    expect(markup).toContain("Nothing needs your review");
    expect(markup).toContain("View issues");
    expect(markup).toContain('href="/problems"');
    expect(markup).not.toContain("customer follow-up");
  });

  it("shows execution gates from multiple product problems in one workspace queue", () => {
    const second = {
      ...workflow,
      problemId: "prob_filters",
      finalApproval: workflow.finalApproval
        ? { ...workflow.finalApproval, id: "apr_final_2", problemId: "prob_filters", pullRequestNumber: 77 }
        : null,
    };
    const markup = renderToStaticMarkup(
      <ApprovalsScreen
        problem={null}
        problemTitles={{
          prob_export: "Large CSV exports produce empty files",
          prob_filters: "Mobile dashboard freezes when filters change",
        }}
        initialEngineeringWorkflows={[workflow, second]}
        orgId="org_1"
      />,
    );
    expect(markup).toContain("Large CSV exports produce empty files");
    expect(markup).toContain("Mobile dashboard freezes when filters change");
    expect(markup).toContain("Merge PR #42 · acme/api");
    expect(markup).toContain("Merge PR #77 · acme/api");
    expect(markup).toContain('aria-label="Approval status"');
    expect(markup).toMatch(/Pending.*?<span>2<\/span>/);
  });
});
