import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), mode: vi.fn(() => "postgres") }));
vi.mock("./db", () => ({ databasePool: () => ({ query: mocks.query }) }));
vi.mock("./workspace-persistence", () => ({ workspacePersistenceMode: mocks.mode }));
import { readIssueCodeReview, readIssueReports } from "./issue-lifecycle-repository";

beforeEach(() => { vi.clearAllMocks(); mocks.mode.mockReturnValue("postgres"); });

describe("read-only issue context", () => {
  it("reads reports through tenant-scoped memberships without unrelated workspace changes", async () => {
    const report = { id: "report-1", quote: "Archive is missing.", source: "Slack", customer: "Avery" };
    mocks.query.mockResolvedValue({ rows: [report] });
    expect(await readIssueReports("org-1", "issue-1")).toEqual([report]);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(params).toEqual(["org-1", "issue-1"]);
    expect(sql).toContain("feedback.org_id=membership.org_id");
    expect(sql).toContain("membership.org_id=$1 AND membership.problem_id=$2");
    expect(sql).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/);
  });
  it("binds review evidence to the specified workspace, issue, run and change", async () => {
    mocks.query.mockResolvedValue({ rows: [{ state: "Approved" }] });
    expect(await readIssueCodeReview("org-1", "issue-1", "run-1")).toBe("Approved");
    const [sql, params] = mocks.query.mock.calls[0];
    expect(params).toEqual(["org-1", "issue-1", "run-1"]);
    expect(sql).toContain("review.org_id=run.org_id AND review.problem_id=run.problem_id");
    expect(sql).toContain("review.remediation_run_id=run.id");
    expect(sql).toContain("coalesce(review.head_sha_after,review.head_sha_before)=run.implementation_commit_sha");
    expect(sql).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/);
  });
  it("surfaces correction work and keeps absent review evidence unknown", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ state: "Correction running" }] }).mockResolvedValueOnce({ rows: [] });
    expect(await readIssueCodeReview("org-1", "issue-1", "run-1")).toBe("Improving");
    expect(await readIssueCodeReview("org-1", "issue-1", "run-1")).toBeNull();
  });
  it("never opens a database connection for demo context", async () => {
    mocks.mode.mockReturnValue("memory");
    expect(await readIssueReports("demo", "unknown")).toEqual([]);
    expect(await readIssueCodeReview("demo", "issue-1", "run-1")).toBeNull();
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
