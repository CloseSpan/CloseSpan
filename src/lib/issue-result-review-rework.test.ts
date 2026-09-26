import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestContext } from "./request-security";
import { authorizeIssueResultRework, issueResultReworkSchema } from "./issue-result-review-rework";

const mocks = vi.hoisted(() => ({ query: vi.fn(), execution: vi.fn(), github: vi.fn(), pull: vi.fn(), mode: vi.fn() }));
vi.mock("./db", () => ({ databasePool: () => ({ query: mocks.query }),
  transaction: async (work: (client: { query: typeof mocks.query }) => Promise<unknown>) => work({ query: mocks.query }) }));
vi.mock("./engineering-workflow-repository", () => ({ getAgentRunExecutionContext: mocks.execution }));
vi.mock("./github-app-auth", () => ({ createGithubInstallationClient: mocks.github }));
vi.mock("./workspace-persistence", () => ({ workspacePersistenceMode: mocks.mode }));
const context: RequestContext = { orgId: "org-a", organizationName: "A", actorId: "admin-a", actorName: "Avery",
  actorEmail: "avery@example.test", role: "Admin", idempotencyKey: "rework-001", traceId: "request-001" };
const input = { reviewId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", version: 1,
  runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", commitSha: "a".repeat(40), promptHash: "b".repeat(64) };
const execution = { orgId: "org-a", problemId: "issue-a", runId: input.runId, promptHash: input.promptHash,
  installationId: "123", repository: "acme/api", branchName: "closespan/issue-a", baseBranch: "main",
  pullRequestNumber: 42, sourcePromptCommitSha: "f".repeat(40), executionProfileHash: "e".repeat(64) };
const source = { id: input.runId, status: "Draft PR opened", implementation_commit_sha: input.commitSha,
  prompt_hash: input.promptHash, prompt_revision_id: "prompt-original", pdd_verification_id: "contract-original",
  execution_profile_id: "profile-original", execution_profile_hash: execution.executionProfileHash,
  execution_profile_snapshot: { protected: "profile-original" }, repository: execution.repository,
  branch_name: execution.branchName, pull_request_number: 42, pull_request_url: "https://github.com/acme/api/pull/42",
  prompt_commit_sha: execution.sourcePromptCommitSha, base_branch: "main", pull_request_base_branch: null,
  allowed_capabilities: ["repository:read", "repository:write", "tests:execute", "pull_requests:write:draft"],
  approval_status: "Approved", current_prompt_hash: input.promptHash, current_prompt_id: "prompt-original", contract_current: true };
const feedback = { id: input.reviewId, version: 1, decision: "changes", run_id: input.runId,
  commit_sha: input.commitSha, prompt_hash: input.promptHash, feedback: "The exported CSV is still missing a column." };
let currentSource = { ...source }, currentFeedback = { ...feedback };
let duplicate: Record<string, unknown> | null = null;
let policy = { autonomy_level: "Execute with approval", hard_stop: true, monthly_model_budget: 100, used_model_cost: 10 };
let attempts: Array<{ status: string }> = [];
let alreadyAuthorized = false;

beforeEach(() => {
  vi.resetAllMocks(); currentSource = { ...source }; currentFeedback = { ...feedback }; duplicate = null;
  vi.stubEnv("CLOSESPAN_DOMAIN_RESULT_REWORK_ENABLED", "true");
  policy = { autonomy_level: "Execute with approval", hard_stop: true, monthly_model_budget: 100, used_model_cost: 10 };
  attempts = []; alreadyAuthorized = false;
  mocks.mode.mockReturnValue("postgres"); mocks.execution.mockResolvedValue(execution);
  mocks.github.mockResolvedValue({ rest: { pulls: { get: mocks.pull } } });
  mocks.pull.mockResolvedValue({ data: { state: "open", merged: false,
    head: { sha: input.commitSha, ref: execution.branchName }, base: { ref: "main" } } });
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("to_regclass")) return { rows: [{ ready: true }], rowCount: 1 };
    if (sql.includes("SELECT stage FROM product_problems")) return { rows: [{ stage: "In progress" }], rowCount: 1 };
    if (sql.includes("idempotency_key=$4")) return { rows: duplicate ? [duplicate] : [], rowCount: duplicate ? 1 : 0 };
    if (sql.includes("FROM workspace_settings")) return { rows: [policy], rowCount: 1 };
    if (sql.includes("SELECT run.*,coding.allowed_capabilities")) return { rows: [currentSource], rowCount: 1 };
    if (sql.startsWith("SELECT id FROM agent_runs")) return { rows: [{ id: currentSource.id }], rowCount: 1 };
    if (sql.startsWith("SELECT id,content_hash,status FROM implementation_prompts")) return { rows: [{ id: "prompt-original", content_hash: input.promptHash, status: "Approved" }], rowCount: 1 };
    if (sql.includes("SELECT * FROM issue_result_reviews")) return { rows: [currentFeedback], rowCount: 1 };
    if (sql.includes("SELECT run_id FROM issue_result_rework_requests")) return { rows: alreadyAuthorized ? [{ run_id: "next" }] : [], rowCount: alreadyAuthorized ? 1 : 0 };
    if (sql.includes("SELECT status FROM final_execution_attempts")) return { rows: attempts, rowCount: attempts.length };
    return { rows: [], rowCount: 1 };
  });
});
afterEach(() => vi.unstubAllEnvs());
const writes = () => mocks.query.mock.calls.filter(([sql]) => /^(INSERT|UPDATE)/.test(sql));

describe("human-authorized domain result rework", () => {
  it("blocks authorization until a compatible executor rollout is explicitly enabled", async () => {
    vi.stubEnv("CLOSESPAN_DOMAIN_RESULT_REWORK_ENABLED", "false");
    await expect(authorizeIssueResultRework(context, "issue-a", input)).rejects.toThrow("updating the coding executor");
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.github).not.toHaveBeenCalled();
  });
  it("queues exactly one follow-up on the existing PR while retaining the original prompt, tests, profile and explicit human receipt", async () => {
    const result = await authorizeIssueResultRework(context, "issue-a", input);
    expect(result).toMatchObject({ runId: expect.any(String), approvalId: expect.stringMatching(/^apr_domain_/), replayed: false });
    expect(mocks.pull).toHaveBeenCalledWith({ owner: "acme", repo: "api", pull_number: 42 });
    const approval = mocks.query.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO approval_requests"))!;
    expect(approval[1]).toEqual(expect.arrayContaining(["org-a", "issue-a", "prompt-original", "contract-original", "profile-original", input.promptHash, input.commitSha, execution.branchName]));
    const run = mocks.query.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO agent_runs"))!;
    expect(run[0]).toContain("'domain_result_rework'");
    expect(run[0]).not.toContain("tenki_review_remediation");
    expect(run[1]).toEqual(expect.arrayContaining([input.reviewId, input.runId, "contract-original", 42, expect.stringContaining(currentFeedback.feedback)]));
    expect(run[1]).toEqual(expect.arrayContaining([expect.stringContaining("If the feedback requires changing expected behavior or widening scope, stop")]));
    expect(writes().some(([sql]) => sql.includes("UPDATE implementation_prompts") || sql.includes("UPDATE pdd_prompt_verifications") || sql.includes("tenki_pr_review_cycles"))).toBe(false);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_events"), expect.arrayContaining(["admin-a", expect.stringContaining('"kind":"human_domain_rework_authorization"')]));
  });

  it.each(["Contributor", "Viewer"])("refuses %s authorization without storage or provider calls", async (role) => {
    await expect(authorizeIssueResultRework({ ...context, role }, "issue-a", input)).rejects.toMatchObject({ status: 403 });
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.github).not.toHaveBeenCalled();
  });
  it("never accepts a system administrator as the human authorizer", async () => {
    await expect(authorizeIssueResultRework({ ...context, actorId: "system:automation" }, "issue-a", input)).rejects.toMatchObject({ status: 403 });
  });
  it("rejects an issue mismatch before contacting GitHub", async () => {
    mocks.execution.mockResolvedValue({ ...execution, problemId: "other-issue" });
    await expect(authorizeIssueResultRework(context, "issue-a", input)).rejects.toMatchObject({ status: 409 });
    expect(mocks.github).not.toHaveBeenCalled(); expect(writes()).toEqual([]);
  });
  it("replays an identical authorization without a second provider call, run or audit", async () => {
    duplicate = { run_id: "existing", approval_id: "existing-approval",
      request_hash: createHash("sha256").update(JSON.stringify(issueResultReworkSchema.parse(input))).digest("hex") };
    expect(await authorizeIssueResultRework(context, "issue-a", input)).toEqual({ runId: "existing", approvalId: "existing-approval", replayed: true });
    expect(mocks.github).not.toHaveBeenCalled(); expect(writes()).toEqual([]);
  });
  it("rejects an idempotency key reused for a different authorized payload", async () => {
    duplicate = { request_hash: "wrong" };
    await expect(authorizeIssueResultRework(context, "issue-a", input)).rejects.toMatchObject({ status: 409 });
    expect(writes()).toEqual([]);
  });
  it.each([
    { state: "closed" }, { merged: true }, { head: { sha: "c".repeat(40), ref: execution.branchName } },
    { head: { sha: input.commitSha, ref: "different" } }, { base: { ref: "different" } },
  ])("refuses stale PR state before recording authority: %j", async (change) => {
    mocks.pull.mockResolvedValue({ data: { state: "open", merged: false, head: { sha: input.commitSha, ref: execution.branchName }, base: { ref: "main" }, ...change } });
    await expect(authorizeIssueResultRework(context, "issue-a", input)).rejects.toMatchObject({ status: 409 });
    expect(writes()).toEqual([]);
  });
  it.each(["Observe", "Recommend"])("respects the workspace %s policy", async (autonomy_level) => {
    policy.autonomy_level = autonomy_level;
    await expect(authorizeIssueResultRework(context, "issue-a", input)).rejects.toMatchObject({ status: 409 });
    expect(writes()).toEqual([]);
  });
  it("honors recorded budget hard stops", async () => {
    policy.used_model_cost = 100;
    await expect(authorizeIssueResultRework(context, "issue-a", input)).rejects.toThrow("coding budget");
    expect(writes()).toEqual([]);
  });
  it.each([
    { status: "Running" }, { id: "new-run" }, { implementation_commit_sha: "c".repeat(40) },
    { current_prompt_id: "changed" }, { contract_current: false }, { approval_status: "Rejected" }, { allowed_capabilities: [] },
  ])("rechecks stale scope after GitHub preflight under the run lock: %j", async (change) => {
    currentSource = { ...currentSource, ...change };
    await expect(authorizeIssueResultRework(context, "issue-a", input)).rejects.toMatchObject({ status: 409 });
    expect(writes()).toEqual([]);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("FOR UPDATE OF run"), ["org-a", "issue-a", "123"]);
  });
  it.each([{ version: 2 }, { decision: "accept" }, { commit_sha: "c".repeat(40) }, { feedback: " " }])("rejects superseded domain feedback: %j", async (change) => {
    currentFeedback = { ...currentFeedback, ...change };
    await expect(authorizeIssueResultRework(context, "issue-a", input)).rejects.toMatchObject({ status: 409 });
    expect(writes()).toEqual([]);
  });
  it("prevents another authorization for the same feedback with a fresh key", async () => {
    alreadyAuthorized = true;
    await expect(authorizeIssueResultRework(context, "issue-a", input)).rejects.toThrow("already authorized");
    expect(writes()).toEqual([]);
  });
  it("rejects a Tenki successor committed while waiting for the source run lock", async () => {
    const implementation = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (sql: string, ...values: unknown[]) => sql.startsWith("SELECT id FROM agent_runs")
      ? { rows: [{ id: "new-tenki-run" }], rowCount: 1 } : implementation(sql, ...values));
    await expect(authorizeIssueResultRework(context, "issue-a", input)).rejects.toThrow("newer coding run");
    expect(writes()).toEqual([]);
  });
  it.each(["Running", "Succeeded"])("does not revise a result once final execution is %s", async (status) => {
    attempts = [{ status }];
    await expect(authorizeIssueResultRework(context, "issue-a", input)).rejects.toThrow("final action already started");
    expect(writes()).toEqual([]);
  });
});
