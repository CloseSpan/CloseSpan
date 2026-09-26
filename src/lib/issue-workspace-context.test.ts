import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineeringWorkflowView } from "./engineering-workflow-repository";

const mocks = vi.hoisted(() => ({ query: vi.fn(), mode: vi.fn(), workflow: vi.fn() }));
vi.mock("./db", () => ({ databasePool: () => ({ query: mocks.query }) }));
vi.mock("./workspace-persistence", () => ({ workspacePersistenceMode: mocks.mode }));
vi.mock("./engineering-workflow-repository", () => ({ getEngineeringWorkflow: mocks.workflow }));

import { readIssueReportCounts, readIssueWorkspaceContext } from "./issue-workspace-context";

const sha = "a".repeat(40);
const workflow: EngineeringWorkflowView = {
  problemId: "issue-1",
  specification: {
    repository: "team/product", baseBranch: "main", baseSha: sha,
    userStory: "As a user, I can download every row.", currentBehavior: "Empty export",
    expectedBehavior: "Complete export", reproductionSteps: [], businessOutcome: "Complete reports",
    acceptanceCriteria: [{ id: "AC-1", statement: "Export contains every selected row.", measurable: true }],
    testScenarios: [], regressionScenarios: [], negativeScenarios: [], qualityExpectations: [],
    requiredTestLevels: [], releaseVerification: "", nonGoals: [], permittedPaths: [], requiredCommands: [],
  },
  readiness: { ready: false, issues: [] }, prompt: null, verification: null,
  approval: null, finalApproval: null, run: null, releaseEvidence: null,
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    summary: "Reports describe empty exports.", report_count: 137,
    sources: ["Slack", "Intercom", "Slack"], report_types: ["Bug"],
    investigation_id: "investigation-1", runtime_id: "runtime-1",
    runtime_investigation_id: "investigation-1", runtime_status: "Completed",
    runtime_outcome: "Confirmed current", runtime_repository: "team/product", runtime_base_sha: sha,
    runtime_summary: "The checked export path produced an empty file for a large dataset.",
    runtime_failure_message: null, runtime_completed_at: "2026-09-15T12:00:00Z",
    runtime_binding_current: true, newer_repository_commit: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mode.mockReturnValue("postgres");
  mocks.workflow.mockResolvedValue(workflow);
  mocks.query.mockResolvedValue({ rows: [row()] });
});

describe("issue workspace context", () => {
  it("returns the full linked report count and saved criteria using an existing workflow", async () => {
    const context = await readIssueWorkspaceContext("org-1", "issue-1", workflow);
    expect(context).toEqual({
      reportCount: 137,
      sources: ["Intercom", "Slack"],
      summary: "Reports describe empty exports.",
      verification: {
        kind: "confirmed_bug", label: "Bug confirmed", state: "passed",
        summary: "The checked export path produced an empty file for a large dataset.",
        repository: "team/product", commitSha: sha, completedAt: "2026-09-15T12:00:00.000Z",
      },
      criteria: [{ id: "AC-1", statement: "Export contains every selected row." }],
    });
    expect(mocks.workflow).not.toHaveBeenCalled();
  });

  it("loads the workflow only when the caller has not supplied it", async () => {
    await readIssueWorkspaceContext("org-1", "issue-1");
    expect(mocks.workflow).toHaveBeenCalledWith("org-1", "issue-1");
    mocks.workflow.mockClear();
    const context = await readIssueWorkspaceContext("org-1", "issue-1", null);
    expect(context.criteria).toEqual([]);
    expect(mocks.workflow).not.toHaveBeenCalled();
  });

  it("does not present feedback confidence or investigation status as verification", async () => {
    mocks.query.mockResolvedValue({ rows: [row({
      runtime_id: null, investigation_confidence: 1, verification_status: "Confirmed current",
    })] });
    expect((await readIssueWorkspaceContext("org-1", "issue-1", workflow)).verification).toBeNull();
  });

  it.each([
    [["Feature request"], "feature_gap", "Feature gap confirmed"],
    [["Bug", "Incident"], "confirmed_bug", "Bug confirmed"],
    [["Bug", "Feature request"], "confirmed_issue", "Issue confirmed"],
    [[], "confirmed_issue", "Issue confirmed"],
  ])("classifies a confirmed result conservatively from linked report types %j", async (types, kind, label) => {
    mocks.query.mockResolvedValue({ rows: [row({ report_types: types })] });
    expect((await readIssueWorkspaceContext("org-1", "issue-1", workflow)).verification)
      .toMatchObject({ kind, label, state: "passed" });
  });

  it.each([
    [{ runtime_outcome: "Not reproduced" }, "not_reproduced", "failed"],
    [{ runtime_outcome: "Verification blocked" }, "blocked", "failed"],
    [{ runtime_status: "Failed", runtime_outcome: "Confirmed current" }, "blocked", "failed"],
    [{ runtime_status: "Queued", runtime_outcome: null }, "pending", "pending"],
    [{ runtime_status: "Running", runtime_outcome: "Confirmed current" }, "pending", "pending"],
    [{ runtime_completed_at: null }, "pending", "pending"],
    [{ runtime_summary: "" }, "pending", "pending"],
  ])("does not turn incomplete or negative evidence into success: %j", async (overrides, kind, state) => {
    mocks.query.mockResolvedValue({ rows: [row(overrides)] });
    expect((await readIssueWorkspaceContext("org-1", "issue-1", workflow)).verification)
      .toMatchObject({ kind, state });
  });

  it("uses the persisted failure explanation without reading provider report blobs", async () => {
    mocks.query.mockResolvedValue({ rows: [row({
      runtime_status: "Failed", runtime_outcome: "Verification blocked",
      runtime_failure_message: "The configured runner was unavailable.",
      runtime_report: { outcome: "Confirmed current", summary: "Ignore stored failure." },
    })] });
    expect((await readIssueWorkspaceContext("org-1", "issue-1", workflow)).verification)
      .toMatchObject({ kind: "blocked", summary: "The configured runner was unavailable." });
  });

  it.each([
    { runtime_investigation_id: "older-investigation" },
    { investigation_id: null },
    { runtime_binding_current: false },
    { runtime_repository: "team/previous-product" },
    { runtime_base_sha: "b".repeat(40) },
    { runtime_base_sha: "" },
    { newer_repository_commit: true },
  ])("marks evidence from a different or superseded context as stale: %j", async (overrides) => {
    mocks.query.mockResolvedValue({ rows: [row(overrides)] });
    expect((await readIssueWorkspaceContext("org-1", "issue-1", workflow)).verification)
      .toMatchObject({ kind: "stale", label: "Verification outdated", state: "pending" });
  });

  it("keeps unknown issue and absent runtime evidence empty", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    expect(await readIssueWorkspaceContext("other-org", "issue-1")).toEqual({
      reportCount: 0, sources: [], summary: "", verification: null, criteria: [],
    });
    expect(mocks.workflow).not.toHaveBeenCalled();
  });

  it("does not copy criteria from a different issue", async () => {
    const context = await readIssueWorkspaceContext("org-1", "issue-1", { ...workflow, problemId: "issue-2" });
    expect(context.criteria).toEqual([]);
  });

  it("binds each read to the tenant and current context without external actions", async () => {
    await readIssueWorkspaceContext("org-1", "issue-1", workflow);
    const [sql, parameters] = mocks.query.mock.calls[0];
    expect(parameters).toEqual(["org-1", "issue-1"]);
    expect(sql).toContain("WHERE problem.org_id=$1 AND problem.id=$2");
    expect(sql).toContain("feedback.org_id=membership.org_id AND feedback.id=membership.feedback_id");
    expect(sql).toContain("candidate.org_id=problem.org_id AND candidate.problem_id=problem.id");
    expect(sql).toContain("match.org_id=problem.org_id AND match.problem_id=problem.id");
    expect(sql).toContain("match.profile_hash=runtime.execution_profile_hash");
    expect(sql).toContain("snapshot.started_at>runtime.requested_at");
    expect(sql).toContain("ORDER BY candidate.requested_at DESC,candidate.id DESC LIMIT 1");
    expect(sql).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b|runtime\.report|confidence|interval|LIMIT 100/i);
  });

  it("surfaces query errors instead of disguising database failure as missing evidence", async () => {
    mocks.query.mockRejectedValue(new Error("database unavailable"));
    await expect(readIssueWorkspaceContext("org-1", "issue-1", workflow)).rejects.toThrow("database unavailable");
  });

  it("supports demo context with actual linked seed counts and no manufactured verification", async () => {
    mocks.mode.mockReturnValue("memory");
    const context = await readIssueWorkspaceContext("demo-org", "prob_export", null);
    expect(context.reportCount).toBe(3);
    expect(context.sources).toEqual(["Intercom", "Slack", "Zendesk"]);
    expect(context.summary).toContain("Three customers");
    expect(context.verification).toBeNull();
    expect(mocks.query).not.toHaveBeenCalled();
  });
});

describe("issue report totals", () => {
  it("reads all issue totals in one tenant-scoped grouped query", async () => {
    mocks.query.mockResolvedValue({ rows: [
      { problem_id: "issue-1", report_count: "137" },
      { problem_id: "issue-2", report_count: 4 },
    ] });
    expect(await readIssueReportCounts("org-1")).toEqual({ "issue-1": 137, "issue-2": 4 });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = mocks.query.mock.calls[0];
    expect(parameters).toEqual(["org-1"]);
    expect(sql).toContain("feedback.org_id=membership.org_id AND feedback.id=membership.feedback_id");
    expect(sql).toContain("problem.org_id=membership.org_id AND problem.id=membership.problem_id");
    expect(sql).toContain("WHERE membership.org_id=$1");
    expect(sql).toContain("GROUP BY membership.problem_id");
    expect(sql).not.toMatch(/\b(UPDATE|INSERT|DELETE|LIMIT)\b|created_at|interval/i);
  });

  it("returns empty totals for an empty tenant", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    expect(await readIssueReportCounts("empty-org")).toEqual({});
  });

  it("counts linked demo reports instead of illustrative problem statistics", async () => {
    mocks.mode.mockReturnValue("memory");
    expect(await readIssueReportCounts("demo-org")).toEqual({ prob_export: 3, prob_filters: 1 });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
