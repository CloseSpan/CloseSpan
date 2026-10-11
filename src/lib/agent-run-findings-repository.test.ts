import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), list: vi.fn(), mode: vi.fn(() => "postgres") }));
vi.mock("./db", () => ({ databasePool: () => ({ query: mocks.query }), transaction: async (fn: (client: unknown) => unknown) => fn({ query: mocks.query }) }));
vi.mock("./workspace-persistence", () => ({ workspacePersistenceMode: mocks.mode }));
vi.mock("./engineering-workflow-repository", () => ({ listAgentRuns: mocks.list }));
import { createFindingIssue, readFindingIssueLinks, readIssueRunFinding } from "./agent-run-findings-repository";
import { detectRunFindings } from "./agent-run-findings";
import type { AgentRunSummaryView } from "./engineering-workflow-repository";
import type { RequestContext } from "./request-security";
const run: AgentRunSummaryView = { id: "r1", approvalId: null, problemId: "p1", problemTitle: "Export", status: "Failed", repository: "org/repo", branchName: "b", pullRequestUrl: null, queuedAt: "2026-10-01T00:00:00Z", completedAt: "2026-10-01T00:01:00Z", independentVerificationStatus: null, finalExecutionStatus: null };
const context = { orgId: "org_alpha", actorId: "user1", actorName: "User", traceId: "t1" } as RequestContext;
const fingerprint = detectRunFindings([run])[0].id;
beforeEach(() => { mocks.query.mockReset().mockResolvedValue({ rows: [] }); mocks.list.mockReset().mockResolvedValue([run]); mocks.mode.mockReturnValue("postgres"); });
describe("finding issue persistence", () => {
  it("creates a review-only issue using server evidence and a tenant-scoped lock", async () => {
    const result = await createFindingIssue(context, fingerprint);
    expect(result.created).toBe(true);
    expect(mocks.list).toHaveBeenCalledWith("org_alpha");
    expect(mocks.query.mock.calls[0][1]).toEqual([`org_alpha:finding:${fingerprint}`]);
    const insert = mocks.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO product_problems"));
    expect(insert?.[0]).toContain("'Needs review'");
    expect(insert?.[1][1]).toBe("org_alpha");
    expect(insert?.[1][3]).toContain("Runs: r1");
  });
  it("updates evidence for the same issue instead of creating a duplicate or overwriting user text", async () => {
    mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith("SELECT problem_id") ? [{ problem_id: "existing" }] : [] }));
    expect(await createFindingIssue(context, fingerprint)).toEqual({ problemId: "existing", created: false });
    expect(mocks.query.mock.calls.some(([sql]) => /INSERT INTO product_problems|UPDATE product_problems/.test(sql))).toBe(false);
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("ON CONFLICT(org_id,fingerprint)"))).toBe(true);
  });
  it("rejects stale or other-tenant finding ids before any write", async () => {
    mocks.list.mockResolvedValue([]);
    await expect(createFindingIssue(context, fingerprint)).rejects.toMatchObject({ status: 404 });
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("keeps analysis usable before database migration", async () => {
    mocks.query.mockRejectedValue({ code: "42P01" });
    expect(await readFindingIssueLinks("org_alpha")).toEqual({ ready: false, links: {} });
  });
  it("shows current evidence on linked issues as more matching runs arrive", async () => {
    mocks.query.mockResolvedValue({ rows: [{ fingerprint, evidence: detectRunFindings([run])[0] }] });
    mocks.list.mockResolvedValue([run, { ...run, id: "r2" }]);
    expect((await readIssueRunFinding("org_alpha", "linked"))?.runIds).toEqual(["r1", "r2"]);
    expect(mocks.query.mock.calls[0][1]).toEqual(["org_alpha", "linked"]);
  });
  it("does not pretend memory demo issues can be persisted", async () => {
    mocks.mode.mockReturnValue("memory");
    await expect(createFindingIssue(context, fingerprint)).rejects.toMatchObject({ status: 409 });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
