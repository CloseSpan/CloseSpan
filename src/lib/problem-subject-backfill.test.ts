import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), analyze: vi.fn(), configuration: vi.fn() }));
vi.mock("./db", () => ({ databasePool: () => ({ query: mocks.query }), transaction: mocks.transaction }));
vi.mock("./ai-config", () => ({ getAiRuntimeConfiguration: mocks.configuration }));
vi.mock("./ai-provider", () => ({ analyzeFeedbackWithProvider: mocks.analyze }));
vi.mock("./workspace-persistence", () => ({ requirePostgresWorkspace: vi.fn() }));
import { backfillProblemSubjects } from "./problem-subject-backfill";

const row = { id: "problem-1", title: "Customer requests additional actions in the three-dot menu because it currently duplicates existing actions", statement: "More menu actions", summary: "Original complete evidence" };
describe("existing problem subjects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [row], rowCount: 1 });
    mocks.configuration.mockResolvedValue({});
    mocks.analyze.mockResolvedValue({ analyses: [{ feedbackId: row.id, problemSubject: "Missing three-dot menu actions" }], model: "test", inputTokens: 20, outputTokens: 10 });
    mocks.transaction.mockImplementation((work) => work({ query: mocks.query }));
  });
  it("previews bounded tenant-specific changes without writing", async () => {
    const result = await backfillProblemSubjects("org-one");
    expect(result.changes[0]).toMatchObject({ subject: "Missing three-dot menu actions", applied: false });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("WHERE org_id=$1"), ["org-one", 25]);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("changes only the canonical title and audits the original, preserving evidence and artifacts", async () => {
    const result = await backfillProblemSubjects("org-one", { apply: true });
    expect(result.changes[0].applied).toBe(true);
    const update = mocks.query.mock.calls.find(([sql]) => sql.startsWith("UPDATE product_problems"));
    expect(update?.[0]).toContain("SET title=$3");
    expect(update?.[0]).not.toMatch(/SET.*(?:summary|statement)=/);
    expect(update?.[1]).toEqual(["org-one", row.id, "Missing three-dot menu actions", row.title, row.statement, row.summary]);
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO audit_events"))).toBe(true);
    expect(mocks.query.mock.calls.some(([sql]) => /UPDATE (?:implementation_prompts|feedback_items|agent_approvals)/.test(sql))).toBe(false);
  });
  it("refuses stale evidence rather than overwriting a concurrent edit", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rowCount: 0 });
    await expect(backfillProblemSubjects("org-one", { apply: true })).rejects.toThrow("changed during subject generation");
  });
  it("does no model work when all subjects are already short", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    expect((await backfillProblemSubjects("org-one")).changes).toEqual([]);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
});
