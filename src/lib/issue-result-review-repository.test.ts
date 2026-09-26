import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestContext } from "./request-security";
import { issueResultReviewSchema } from "./issue-result-review";
import { issueResultChangesBlockExecution, readIssueResultReview, recordIssueResultReview } from "./issue-result-review-repository";

const mocks = vi.hoisted(() => ({ query: vi.fn(), mode: vi.fn() }));
vi.mock("./db", () => ({ databasePool: () => ({ query: mocks.query }),
  transaction: async (work: (client: { query: typeof mocks.query }) => Promise<unknown>) => work({ query: mocks.query }) }));
vi.mock("./workspace-persistence", () => ({ workspacePersistenceMode: mocks.mode }));
const context: RequestContext = { orgId: "org-a", organizationName: "A", actorId: "contributor-a", actorName: "Avery",
  actorEmail: "avery@example.test", role: "Contributor", idempotencyKey: "result-review-001", traceId: "request-001" };
const input = { runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", commitSha: "a".repeat(40), promptHash: "b".repeat(64),
  version: 0, decision: "accept" as const, feedback: "" };
const run = { id: input.runId, status: "Draft PR opened", prompt_hash: input.promptHash,
  prompt_revision_id: "prompt-a", implementation_commit_sha: input.commitSha,
  current_prompt_hash: input.promptHash, current_prompt_id: "prompt-a", coding_approval_status: "Approved", coding_approval_hash: input.promptHash };
const decision = { id: "review-a", run_id: input.runId, commit_sha: input.commitSha, prompt_hash: input.promptHash,
  version: 1, decision: "changes", feedback: "The export is still missing a column.", actor_name: "Avery", created_at: new Date("2026-09-15T00:00:00Z") };
let currentRun = { ...run };
let latest: typeof decision | null = null;
let stored: Record<string, unknown> | null = null;
let attempts: Array<{ status: string }> = [];
let exists = true;
let ready = true;

beforeEach(() => {
  vi.resetAllMocks(); mocks.mode.mockReturnValue("postgres"); currentRun = { ...run };
  latest = null; stored = null; attempts = []; exists = true; ready = true;
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("to_regclass")) return { rows: [{ ready }], rowCount: 1 };
    if (sql.includes("SELECT stage FROM product_problems")) return { rows: exists ? [{ stage: "In progress" }] : [], rowCount: exists ? 1 : 0 };
    if (sql.includes("SELECT run.id,run.status")) return { rows: [currentRun], rowCount: 1 };
    if (sql.startsWith("SELECT id,content_hash FROM implementation_prompts")) return { rows: [{ id: currentRun.current_prompt_id, content_hash: currentRun.current_prompt_hash }], rowCount: 1 };
    if (sql.includes("idempotency_key=$4")) return { rows: stored ? [stored] : [], rowCount: stored ? 1 : 0 };
    if (sql.startsWith("SELECT version FROM issue_result_reviews") || sql.startsWith("SELECT * FROM issue_result_reviews")) {
      return { rows: latest ? [latest] : [], rowCount: latest ? 1 : 0 };
    }
    if (sql.includes("SELECT status FROM final_execution_attempts") || sql.includes("SELECT 1 FROM final_execution_attempts")) {
      return { rows: attempts, rowCount: attempts.length };
    }
    if (sql.includes("SELECT review.decision")) return { rows: latest ? [latest] : [], rowCount: latest ? 1 : 0 };
    return { rows: [], rowCount: 1 };
  });
});
const writes = () => mocks.query.mock.calls.filter(([sql]) => /^(INSERT|UPDATE)/.test(sql));

describe("human implementation result decisions", () => {
  it("records a contributor's exact result and audit without modifying tests, prompts, coding approvals or runs", async () => {
    await recordIssueResultReview(context, "issue-a", input);
    const insert = mocks.query.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO issue_result_reviews"))!;
    expect(insert[1]).toEqual(expect.arrayContaining([context.orgId, "issue-a", input.runId, input.commitSha, input.promptHash, "accept", context.actorId]));
    expect(writes().map(([sql]) => sql.split(/\s+/).slice(0, 3).join(" ")))
      .toEqual(["INSERT INTO issue_result_reviews(id,org_id,problem_id,run_id,commit_sha,prompt_hash,version,decision,feedback,", "INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id)", "UPDATE workspaces SET"]);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("'IssueResultReview'"), expect.arrayContaining([expect.stringContaining('"kind":"human_result_review"')]));
    const locks = mocks.query.mock.calls.filter(([sql]) => sql.includes("FOR UPDATE")).map(([sql]) => sql);
    expect(locks[0]).toContain("product_problems");
    expect(locks[1]).toContain("FOR UPDATE OF run");
    expect(locks[2]).toContain("final_execution_attempts");
  });

  it("requires useful feedback for changes and refuses unknown request fields", async () => {
    await expect(recordIssueResultReview(context, "issue-a", { ...input, decision: "changes", feedback: "  " })).rejects.toMatchObject({ status: 400 });
    await expect(recordIssueResultReview(context, "issue-a", { ...input, orgId: "other-org" })).rejects.toMatchObject({ status: 400 });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it.each(["Viewer", "Member"])("rejects %s without touching storage", async (role) => {
    await expect(recordIssueResultReview({ ...context, role }, "issue-a", input)).rejects.toMatchObject({ status: 403 });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("does not allow system identities to impersonate human confirmation", async () => {
    await expect(recordIssueResultReview({ ...context, actorId: "system:worker" }, "issue-a", input)).rejects.toMatchObject({ status: 403 });
  });

  it("rejects foreign issues using only the authenticated organization", async () => {
    exists = false;
    await expect(recordIssueResultReview(context, "foreign-issue", input)).rejects.toMatchObject({ status: 404 });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("org_id=$1 AND id=$2 FOR UPDATE"), ["org-a", "foreign-issue"]);
    expect(writes()).toEqual([]);
  });

  it.each(["Queued", "Running", "Failed", "No changes", "Cancelled"])("refuses %s runs", async (status) => {
    currentRun.status = status;
    await expect(recordIssueResultReview(context, "issue-a", input)).rejects.toMatchObject({ status: 409 });
    expect(writes()).toEqual([]);
  });

  it.each([
    { runId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, { commitSha: "c".repeat(40) }, { promptHash: "d".repeat(64) },
  ])("rejects a stale run/commit/prompt binding: %j", async (changes) => {
    await expect(recordIssueResultReview(context, "issue-a", { ...input, ...changes })).rejects.toMatchObject({ status: 409 });
    expect(writes()).toEqual([]);
  });

  it.each([
    { current_prompt_hash: "c".repeat(64) }, { current_prompt_id: "new-prompt" },
    { coding_approval_status: "Superseded" }, { coding_approval_hash: "d".repeat(64) }, { implementation_commit_sha: "" },
  ])("rejects stale or absent implementation authority: %j", async (changes) => {
    currentRun = { ...currentRun, ...changes };
    await expect(recordIssueResultReview(context, "issue-a", input)).rejects.toMatchObject({ status: 409 });
    expect(writes()).toEqual([]);
  });

  it("rejects a competing review after the issue lock instead of overwriting it", async () => {
    latest = decision;
    await expect(recordIssueResultReview(context, "issue-a", input)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Another result review") });
    expect(writes()).toEqual([]);
  });

  it("cannot dismiss changes on the same result by accepting it without a new implementation", async () => {
    latest = decision;
    await expect(recordIssueResultReview(context, "issue-a", { ...input, version: 1 })).rejects.toMatchObject({
      status: 409, message: expect.stringContaining("new implementation result"),
    });
    expect(writes()).toEqual([]);
  });

  it("replays an identical actor-scoped idempotency key without another audit or decision", async () => {
    const request_hash = createHash("sha256").update(JSON.stringify(issueResultReviewSchema.parse(input))).digest("hex");
    stored = { ...decision, request_hash };
    await recordIssueResultReview(context, "issue-a", input);
    expect(writes()).toEqual([]);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("actor_id=$3 AND idempotency_key=$4"), ["org-a", "issue-a", context.actorId, context.idempotencyKey]);
  });

  it("rejects changed content under the same idempotency key", async () => {
    stored = { ...decision, request_hash: "other" };
    await expect(recordIssueResultReview(context, "issue-a", input)).rejects.toMatchObject({ status: 409 });
    expect(writes()).toEqual([]);
  });

  it("cancels queued final actions and rejects pending/approved final authority when changes win the run lock", async () => {
    attempts = [{ status: "Queued" }];
    await recordIssueResultReview(context, "issue-a", { ...input, decision: "changes", feedback: "Export still misses a column." });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("status IN ('Pending','Approved')"), expect.arrayContaining(["org-a", "issue-a", input.runId, input.commitSha]));
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("expected_head_sha=$3 AND status='Queued'"), expect.arrayContaining(["org-a", input.runId, input.commitSha]));
    expect(writes().some(([sql]) => sql.includes("tenki_pr_review_cycles") || sql.includes("INSERT INTO agent_runs"))).toBe(false);
  });

  it.each(["Running", "Succeeded"])("rejects feedback when final execution won the lock and is %s", async (status) => {
    attempts = [{ status }];
    await expect(recordIssueResultReview(context, "issue-a", { ...input, decision: "changes", feedback: "Still fails." })).rejects.toMatchObject({ status: 409 });
    expect(writes()).toEqual([]);
  });

  it("reports unavailable storage without breaking older workspaces and refuses writes", async () => {
    ready = false;
    expect(await readIssueResultReview("org-a", "issue-a")).toMatchObject({ storageReady: false, canReview: false });
    await expect(recordIssueResultReview(context, "issue-a", input)).rejects.toMatchObject({ status: 409 });
    expect(writes()).toEqual([]);
  });

  it("marks old decisions stale and only recommends rework for the current result", async () => {
    latest = decision;
    expect(await readIssueResultReview("org-a", "issue-a")).toMatchObject({ version: 1, latestDecision: { current: true }, reworkRecommendation: expect.stringContaining("administrator") });
    currentRun.implementation_commit_sha = "c".repeat(40);
    expect(await readIssueResultReview("org-a", "issue-a")).toMatchObject({ latestDecision: { current: false }, reworkRecommendation: null });
  });

  it("scopes the final gate to exact tenant, issue, run, SHA and prompt rather than unrelated prior decisions", async () => {
    latest = decision;
    expect(await issueResultChangesBlockExecution({ query: mocks.query }, { orgId: "org-a", problemId: "issue-a", ...input })).toBe(true);
    const gate = mocks.query.mock.calls.find(([sql]) => sql.includes("SELECT review.decision"))!;
    expect(gate[1]).toEqual(["org-a", "issue-a", input.runId, input.commitSha]);
    expect(gate[0]).toContain("review.prompt_hash=run.prompt_hash");
    expect(gate[0]).toContain("review.commit_sha=run.implementation_commit_sha");
    expect(gate[0]).toContain("ORDER BY review.version DESC LIMIT 1");
    latest = { ...decision, decision: "accept" };
    expect(await issueResultChangesBlockExecution({ query: mocks.query }, { orgId: "org-a", problemId: "issue-a", ...input })).toBe(false);
  });
});
