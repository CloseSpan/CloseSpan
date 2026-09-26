import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reconcileFullAutonomy } from "./autonomy-automation-repository";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), policy: vi.fn(), budget: vi.fn(), persistence: vi.fn(),
  approve: vi.fn(), request: vi.fn(), context: vi.fn(), dispatch: vi.fn(),
  fail: vi.fn(), finalApprove: vi.fn(), align: vi.fn(),
}));
vi.mock("./db", () => ({ databasePool: () => ({ query: mocks.query }) }));
vi.mock("./workspace-settings-repository", () => ({
  readAutonomyLevel: mocks.policy, automaticCodingBudgetAvailable: mocks.budget,
}));
vi.mock("./workspace-persistence", () => ({ workspacePersistenceMode: mocks.persistence }));
vi.mock("./engineering-workflow-repository", () => ({
  approveImplementationRun: mocks.approve,
  requestImplementationApproval: mocks.request,
  getAgentRunExecutionContext: mocks.context,
  failAgentRun: mocks.fail,
  failPddVerification: vi.fn(),
  generatePddAcceptanceContract: vi.fn(),
  getPddVerificationExecutionContext: vi.fn(),
  getPromptAlignmentContext: mocks.align,
  markPddVerificationGenerating: vi.fn(),
}));
vi.mock("./agent-executor-client", () => ({
  dispatchAgentRun: mocks.dispatch,
  agentRunDispatchFailureCode: () => "autonomy_dispatch_failed",
}));
vi.mock("./final-execution-repository", () => ({ approveFinalExecution: mocks.finalApprove }));
vi.mock("./closespan-prompt-agent", () => ({
  applyPromptRevisionWithCloseSpanAgent: vi.fn(), testPromptWithCloseSpanAgent: vi.fn(),
}));

const activation = new Date("2026-09-11T12:00:00Z");
describe("automatic coding reconciliation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.policy.mockResolvedValue("Automatic coding, human merge");
    mocks.budget.mockResolvedValue(true);
    mocks.persistence.mockReturnValue("postgres");
    mocks.query.mockImplementation(async (sql: string) => sql.includes("max(occurred_at)")
      ? { rows: [{ enabled_at: activation }] }
      : { rows: [] });
    mocks.approve.mockResolvedValue({ problemId: "problem", run: { id: "run" } });
    mocks.context.mockResolvedValue({ runId: "run" });
  });

  it.each(["Observe", "Recommend", "Execute with approval"])("does not auto-authorize %s", async (level) => {
    mocks.policy.mockResolvedValue(level);
    expect((await reconcileFullAutonomy("org")).action).toBe("not_enabled");
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it.each(["Automatic coding, human merge", "Full autonomy"])("dispatches eligible coding through existing authorization guards in %s", async (level) => {
    mocks.policy.mockResolvedValue(level);
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("max(occurred_at)")) return { rows: [{ enabled_at: activation }] };
      if (sql.includes("approval.action_type='agent_run'")) return { rows: [{ id: "approval", problem_id: "problem" }] };
      return { rows: [] };
    });
    expect((await reconcileFullAutonomy("org")).action).toBe("agent_dispatched");
    expect(mocks.approve).toHaveBeenCalledWith("org", "approval", expect.objectContaining({ actorId: "system:full-autonomy" }));
    expect(mocks.context).toHaveBeenCalledWith("org", "run");
    expect(mocks.dispatch).toHaveBeenCalledWith({ runId: "run" });
    expect(mocks.finalApprove).not.toHaveBeenCalled();
  });

  it("keeps historical prompts and pending approvals outside the opt-in boundary", async () => {
    expect((await reconcileFullAutonomy("org")).action).toBe("idle");
    const workQueries = mocks.query.mock.calls.filter(([sql]) => !sql.includes("max(occurred_at)"));
    expect(workQueries).toHaveLength(3);
    for (const [sql, parameters] of workQueries) {
      expect(sql).toContain("prompt.created_at >= $2::timestamptz");
      expect(parameters).toEqual(["org", activation]);
    }
    expect(workQueries[0][0]).toContain("approval.created_at >= $2::timestamptz");
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("blocks an unaudited opt-in and exhausted or missing budgets", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    expect((await reconcileFullAutonomy("org")).action).toBe("blocked");
    mocks.budget.mockResolvedValue(false);
    mocks.query.mockClear();
    expect((await reconcileFullAutonomy("org")).message).toContain("budget");
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("uses the audit timestamp column defined by the database schema", async () => {
    const migration = await readFile(new URL("../../db/migrations/001_initial.sql", import.meta.url), "utf8");
    const auditTable = migration.split("CREATE TABLE IF NOT EXISTS audit_events (")[1]?.split(");")[0];
    expect(auditTable).toContain("occurred_at timestamptz");
    expect(auditTable).not.toContain("created_at");
    await reconcileFullAutonomy("org");
    const [query] = mocks.query.mock.calls.find(([sql]) => sql.includes("FROM audit_events"))!;
    expect(query).toContain("max(occurred_at) AS enabled_at");
    expect(query).not.toContain("created_at");
  });

  it.each(["Automatic coding, human merge", "Full autonomy"])("leaves final approvals to humans under %s", async (level) => {
    mocks.policy.mockResolvedValue(level);
    await reconcileFullAutonomy("org");
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("action_type='final_execution'"))).toBe(false);
    expect(mocks.finalApprove).not.toHaveBeenCalled();
  });

  it("does not dispatch when immutable approval validation rejects the run", async () => {
    mocks.policy.mockResolvedValue("Full autonomy");
    mocks.query.mockResolvedValue({ rows: [{ id: "approval", problem_id: "problem" }] });
    mocks.approve.mockRejectedValue(new Error("The target repository is not allowlisted for agent execution"));
    await expect(reconcileFullAutonomy("org")).rejects.toThrow("not allowlisted");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
