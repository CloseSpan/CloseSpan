import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EngineeringWorkflowView } from "@/lib/engineering-workflow-repository";
import { ApprovalsScreen } from "./screens";

const workflow: EngineeringWorkflowView = {
  problemId: "prob_export",
  specification: null,
  readiness: { ready: false, issues: [] },
  prompt: null,
  verification: null,
  approval: null,
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
    changedFiles: ["src/export.ts", "src/export.test.ts"],
    testSummary: { passed: 4, failed: 0, skipped: 0 },
    acceptanceSummary: { passed: 2, unresolved: 0 },
    remainingRisks: [],
    attempt: null,
  },
  run: null,
  releaseEvidence: null,
};

describe("Approval Center final execution", () => {
  it("uses the existing approval surface for the exact reviewed PR commit", () => {
    const markup = renderToStaticMarkup(
      <ApprovalsScreen
        problem={null}
        problemTitles={{ prob_export: "Large CSV exports produce empty files" }}
        initialEngineeringWorkflows={[workflow]}
        orgId="org_1"
      />,
    );

    expect(markup).toContain("Approve final PR execution");
    expect(markup).toContain("Approve and merge PR");
    expect(markup).toContain("Approval applies only to aaaaaaaa");
    expect(markup).toContain("4 tests passed · 2 acceptance checks passed");
    expect(markup).toContain("does not mark the problem released");
    expect(markup).not.toContain("External action");
    expect(markup).not.toContain("Customer follow-up drafts");
    expect(markup).not.toContain("Customer communication");
  });

  it("defines the center as the two execution gates when no request exists", () => {
    const markup = renderToStaticMarkup(
      <ApprovalsScreen
        problem={null}
        problemTitles={{ prob_export: "Large CSV exports produce empty files" }}
        initialEngineeringWorkflows={[{ ...workflow, finalApproval: null }]}
        orgId="org_1"
      />,
    );

    expect(markup).toContain("Execution approvals");
    expect(markup).toContain("Agent-run and final-execution requests");
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
    expect(markup).toContain("Merge PR #42 · Large CSV exports produce empty files");
    expect(markup).toContain("Merge PR #77 · Mobile dashboard freezes when filters change");
    expect(markup).toContain("2 awaiting review");
  });
});
