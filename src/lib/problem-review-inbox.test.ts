import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), mode: vi.fn(() => "postgres") }));
vi.mock("./db", () => ({ databasePool: () => ({ query: mocks.query }), transaction: vi.fn() }));
vi.mock("./workspace-persistence", () => ({ workspacePersistenceMode: mocks.mode }));
import { listProblemReviewInbox } from "./problem-prompt-review-repository";

beforeEach(() => { vi.clearAllMocks(); mocks.mode.mockReturnValue("postgres"); });

describe("human review inbox", () => {
  it("returns concise decisions from a read-only, tenant-scoped query", async () => {
    mocks.query.mockResolvedValue({ rows: [
      { problem_id: "issue-ready", status: "Ready" },
      { problem_id: "issue-blocked", status: "Needs attention" },
    ] });
    expect(await listProblemReviewInbox("org-1")).toEqual([
      { problemId: "issue-ready", needsHelp: false },
      { problemId: "issue-blocked", needsHelp: true },
    ]);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(params).toEqual(["org-1"]);
    expect(sql).toContain("p.org_id=r.org_id AND p.id=r.problem_id");
    expect(sql).toContain("r.org_id=$1");
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  it("requires current, passed, unconfirmed evidence and excludes authorized work", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await listProblemReviewInbox("org-1");
    const [sql] = mocks.query.mock.calls[0];
    expect(sql).toContain("r.confirmed_at IS NULL");
    expect(sql).toContain("r.evaluation->>'verdict'='Passed'");
    expect(sql).toContain("r.prompt_hash=(SELECT i.content_hash");
    expect(sql).toContain("i.org_id=r.org_id AND i.problem_id=r.problem_id");
    expect(sql).toContain("i.status <> 'Superseded'");
    expect(sql).toContain("a.status IN ('Pending','Approved')");
    expect(sql).toContain("p.stage NOT IN ('Closed','Released')");
  });

  it("does not connect to persistent data for demo workspaces", async () => {
    mocks.mode.mockReturnValue("memory");
    expect(await listProblemReviewInbox("demo")).toEqual([]);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
