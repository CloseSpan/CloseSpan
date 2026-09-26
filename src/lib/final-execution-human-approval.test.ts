import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Octokit } from "@octokit/rest";
import { autonomyLevels } from "./autonomy-policy";
import { approveFinalExecution, processQueuedFinalExecutions } from "./final-execution-repository";

const mocks = vi.hoisted(() => ({ query: vi.fn(), transactionQuery: vi.fn(), policy: vi.fn(), merge: vi.fn() }));
vi.mock("./db", () => ({
  databasePool: () => ({ query: mocks.query }),
  transaction: async (work: (client: { query: typeof mocks.transactionQuery }) => Promise<unknown>) => work({ query: mocks.transactionQuery }),
}));
vi.mock("./workspace-settings-repository", () => ({ readAutonomyLevel: mocks.policy }));
vi.mock("./github-app-auth", () => ({ createGithubInstallationClient: mocks.merge }));

const human = { actorId: "admin-human", actorName: "Administrator", role: "Admin", traceId: "human-approval" };
const candidate = {
  id: "approval", problem_id: "problem", status: "Pending", expires_at: new Date("2999-01-01"),
  agent_run_id: "run", repository: "acme/api", base_branch: "main", pull_request_number: 42,
  pull_request_url: "https://github.com/acme/api/pull/42", head_sha: "a".repeat(40),
  installation_id: "123", run_status: "Draft PR opened", implementation_commit_sha: "a".repeat(40),
  tenki_review_required: false, verification_status: "passed", evidence_snapshot: null,
  attempt_id: null, attempt_status: null,
};
const queuedCandidate = {
  id: "attempt", org_id: "org", approval_id: "approval", agent_run_id: "run", problem_id: "problem",
  repository: "acme/api", base_branch: "main", pull_request_number: 42,
  expected_head_sha: "a".repeat(40), installation_id: "123", approval_status: "Approved",
  approval_expires_at: new Date("2999-01-01"), approval_head_sha: "a".repeat(40),
  has_current_human_approval: true,
};

describe("mandatory human final approval", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.policy.mockResolvedValue("Automatic coding, human merge");
    mocks.transactionQuery.mockImplementation(async (sql: string) => sql.startsWith("SELECT implementation_commit_sha,status")
      ? { rows: [{ implementation_commit_sha: candidate.head_sha, status: "Draft PR opened" }], rowCount: 1 }
      : { rows: [], rowCount: 1 });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("allowlist.installation_id::text")) return { rows: [candidate] };
      return { rows: [{ ...candidate, evidence_snapshot: {}, attempt_id: "attempt", attempt_status: "Queued" }] };
    });
  });

  it.each(autonomyLevels)("rejects system final authorization even with an Admin role under %s", async (level) => {
    mocks.policy.mockResolvedValue(level);
    await expect(approveFinalExecution("org", "approval", { ...human, actorId: "system:full-autonomy" }))
      .rejects.toMatchObject({ status: 403 });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.transactionQuery).not.toHaveBeenCalled();
  });

  it.each([undefined, "Contributor", "Member"])("rejects callers without the Admin role (%s)", async (role) => {
    await expect(approveFinalExecution("org", "approval", { ...human, role }))
      .rejects.toMatchObject({ status: 403 });
  });

  it("keeps pending approvals inert under Observe before reading candidates or contacting GitHub", async () => {
    mocks.policy.mockResolvedValue("Observe");

    await expect(approveFinalExecution("org", "approval", human)).rejects.toMatchObject({
      status: 409,
      message: "Final execution is disabled while Agent autonomy is set to Observe.",
    });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.transactionQuery).not.toHaveBeenCalled();
    expect(mocks.merge).not.toHaveBeenCalled();
  });

  it.each(["Execute with approval", "Automatic coding, human merge", "Full autonomy"])("permits human approval of the verified exact commit under %s", async (level) => {
    mocks.policy.mockResolvedValue(level);
    await approveFinalExecution("org", "approval", human);
    expect(mocks.transactionQuery).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO final_execution_attempts"), expect.arrayContaining(["org", "approval", "a".repeat(40)]));
    expect(mocks.transactionQuery).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_events"), expect.arrayContaining(["admin-human", `Approved and queued merge of acme/api#42 at ${"a".repeat(40)}`]));
    expect(mocks.merge).not.toHaveBeenCalled();
  });

  it("keeps the exact-commit and independent-verification gate for human approvals", async () => {
    mocks.query.mockResolvedValue({ rows: [{ ...candidate, implementation_commit_sha: "b".repeat(40) }] });
    await expect(approveFinalExecution("org", "approval", human)).rejects.toThrow("no longer ready");
    expect(mocks.transactionQuery).not.toHaveBeenCalled();
  });

  it("requires a matching human decision before claiming any queued merge, including legacy jobs", async () => {
    mocks.transactionQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await processQueuedFinalExecutions()).toEqual([]);
    const sql = mocks.transactionQuery.mock.calls[0][0];
    expect(sql).toContain("JOIN workspace_members member");
    expect(sql).toContain("member.role='Admin'");
    expect(sql).toContain("lower(decision.actor_id) NOT LIKE 'system:%'");
    expect(sql).toContain("decision.entity_id=attempt.approval_id");
    expect(sql).toContain("decision.occurred_at>=approval.consumed_at");
    expect(sql).toContain("attempt.expected_head_sha");
    expect(sql).toContain("AS has_current_human_approval");
    expect(sql).toContain("FOR UPDATE OF run,attempt SKIP LOCKED");
    expect(mocks.merge).not.toHaveBeenCalled();
  });

  it.each([
    { reason: "legacy system authorization", changes: { has_current_human_approval: false } },
    { reason: "the human approver is no longer an administrator", changes: { has_current_human_approval: false } },
    { reason: "the human approval expired in the queue", changes: { approval_expires_at: new Date("2020-01-01") } },
  ])("reopens a fresh human decision when $reason", async ({ changes }) => {
    mocks.transactionQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mocks.transactionQuery.mockResolvedValueOnce({ rows: [{ ...queuedCandidate, ...changes }], rowCount: 1 });
    const results = await processQueuedFinalExecutions(1);
    expect(results).toEqual([{ attemptId: "attempt", status: "Failed", message: expect.stringContaining("fresh human approval") }]);
    expect(mocks.transactionQuery).toHaveBeenCalledWith(expect.stringContaining("SET status='Failed',failure_message=$3"), expect.arrayContaining(["org", "attempt"]));
    expect(mocks.transactionQuery).toHaveBeenCalledWith(expect.stringContaining("SET status='Pending',consumed_at=NULL"), expect.arrayContaining(["org", "approval", "a".repeat(40)]));
    const reopen = mocks.transactionQuery.mock.calls.find(([sql]) => sql.includes("SET status='Pending'"))!;
    expect(reopen[0]).toContain("expires_at=now()+interval '24 hours'");
    expect(mocks.transactionQuery.mock.calls.some(([sql]) => sql.includes("SET status='Running'"))).toBe(false);
    expect(mocks.transactionQuery.mock.calls.some(([, values]) => values?.some((value: unknown) => typeof value === "string" && value.startsWith("Approved and queued merge")))).toBe(false);
    expect(mocks.merge).not.toHaveBeenCalled();
  });

  it.each(["Rejected", "Superseded"])("does not reopen a %s decision during recovery", async (approval_status) => {
    mocks.transactionQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mocks.transactionQuery.mockResolvedValueOnce({ rows: [{ ...queuedCandidate, approval_status }], rowCount: 1 });
    expect((await processQueuedFinalExecutions(1))[0].status).toBe("Failed");
    expect(mocks.transactionQuery.mock.calls.some(([sql]) => sql.includes("SET status='Pending'"))).toBe(false);
    expect(mocks.merge).not.toHaveBeenCalled();
  });

  it("does not reuse approval authority for a changed commit", async () => {
    mocks.transactionQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mocks.transactionQuery.mockResolvedValueOnce({ rows: [{ ...queuedCandidate, approval_head_sha: "b".repeat(40) }], rowCount: 1 });
    expect((await processQueuedFinalExecutions(1))[0]).toMatchObject({ status: "Failed", message: expect.stringContaining("commit changed") });
    expect(mocks.transactionQuery.mock.calls.some(([sql]) => sql.includes("SET status='Pending'"))).toBe(false);
    expect(mocks.merge).not.toHaveBeenCalled();
  });

  it("bounds recovery work so invalid jobs cannot cause an unbounded sweep", async () => {
    let claimed = 0;
    mocks.transactionQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT attempt.id")) return { rows: [{ ...queuedCandidate, id: `attempt-${++claimed}`, has_current_human_approval: false }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    expect(await processQueuedFinalExecutions(2)).toHaveLength(2);
    expect(claimed).toBe(2);
    expect(mocks.merge).not.toHaveBeenCalled();
  });

  it("executes a current human-approved queued commit through the existing GitHub head check", async () => {
    mocks.transactionQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mocks.transactionQuery.mockResolvedValueOnce({ rows: [queuedCandidate], rowCount: 1 });
    const get = vi.fn(async () => ({ data: { state: "open", draft: false,
      base: { ref: "main" }, head: { sha: queuedCandidate.expected_head_sha },
      html_url: "https://github.com/acme/api/pull/42" } }));
    const merge = vi.fn(async () => ({ data: { merged: true, sha: "b".repeat(40) } }));
    const github = { rest: { pulls: { get, merge } } } as unknown as Octokit;
    expect(await processQueuedFinalExecutions(1, { createClient: () => github }))
      .toEqual([{ attemptId: "attempt", status: "Succeeded" }]);
    expect(get).toHaveBeenCalledOnce();
    expect(merge).toHaveBeenCalledWith(expect.objectContaining({ sha: queuedCandidate.expected_head_sha }));
    expect(mocks.transactionQuery.mock.calls.some(([sql]) => sql.includes("SET status='Pending'"))).toBe(false);
  });

  it.each(["Pending", "Approved", "Expired"])("accepts a fresh admin decision after a failed %s attempt, even when the old window expired", async (status) => {
    mocks.query.mockImplementation(async (sql: string) => {
      const row = { ...candidate, status, expires_at: new Date("2020-01-01"), attempt_id: "attempt", attempt_status: "Failed" };
      return { rows: [sql.includes("allowlist.installation_id::text") ? row : { ...row, evidence_snapshot: {} }] };
    });
    await approveFinalExecution("org", "approval", human);
    const consumed = mocks.transactionQuery.mock.calls.find(([sql]) => sql.includes("UPDATE approval_requests approval"))!;
    expect(consumed[0]).toContain("consumed_at=now()");
    expect(consumed[0]).toContain("expires_at=CASE WHEN expires_at<=now() THEN now()+interval '24 hours'");
    expect(consumed[1]).toEqual(["org", "approval", "a".repeat(40), "attempt"]);
    expect(mocks.transactionQuery).toHaveBeenCalledWith(expect.stringContaining("SET status='Queued',failure_message=NULL"), ["org", "attempt"]);
    expect(mocks.transactionQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO final_execution_attempts"))).toBe(false);
    expect(mocks.transactionQuery).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_events"), expect.arrayContaining([human.actorId]));
    expect(mocks.merge).not.toHaveBeenCalled();
  });

  it("cannot renew an expired failed attempt when its verified commit changed", async () => {
    mocks.query.mockResolvedValue({ rows: [{ ...candidate, status: "Expired", expires_at: new Date("2020-01-01"),
      attempt_id: "attempt", attempt_status: "Failed", implementation_commit_sha: "b".repeat(40) }] });
    await expect(approveFinalExecution("org", "approval", human)).rejects.toThrow("no longer ready");
    expect(mocks.transactionQuery).not.toHaveBeenCalled();
  });

  it("blocks approval if result feedback requests changes after the candidate was loaded", async () => {
    mocks.transactionQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT implementation_commit_sha,status")) return { rows: [{ implementation_commit_sha: candidate.head_sha, status: "Draft PR opened" }], rowCount: 1 };
      if (sql.includes("to_regclass")) return { rows: [{ ready: true }], rowCount: 1 };
      if (sql.includes("SELECT review.decision")) return { rows: [{ decision: "changes" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    await expect(approveFinalExecution("org", "approval", human)).rejects.toThrow("Human result review requested changes");
    expect(mocks.transactionQuery.mock.calls.some(([sql]) => sql.startsWith("UPDATE") || sql.startsWith("INSERT"))).toBe(false);
    expect(mocks.transactionQuery.mock.calls[0][0]).toContain("FOR UPDATE");
  });

  it("blocks a queued final action on current result feedback without reopening its authority", async () => {
    mocks.transactionQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT attempt.id")) return { rows: [queuedCandidate], rowCount: 1 };
      if (sql.includes("to_regclass")) return { rows: [{ ready: true }], rowCount: 1 };
      if (sql.includes("SELECT review.decision")) return { rows: [{ decision: "changes" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    expect(await processQueuedFinalExecutions(1)).toEqual([{ attemptId: "attempt", status: "Failed", message: expect.stringContaining("Human result review requested changes") }]);
    expect(mocks.transactionQuery.mock.calls.some(([sql]) => sql.includes("SET status='Running'") || sql.includes("SET status='Pending'"))).toBe(false);
    expect(mocks.merge).not.toHaveBeenCalled();
  });
});
