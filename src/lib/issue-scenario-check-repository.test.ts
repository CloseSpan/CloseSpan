import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestContext } from "./request-security";
import { assertPromptAlignmentReceipt } from "./prompt-alignment-receipt";
import { sha256 } from "./pdd-verification";

const mock = vi.hoisted(() => ({ query: vi.fn(), mode: vi.fn(), demo: vi.fn(), evaluate: vi.fn(), begin: vi.fn(), fail: vi.fn(), contract: vi.fn() }));
vi.mock("./db", () => ({ databasePool: () => ({ query: mock.query }),
  transaction: async (run: (client: { query: typeof mock.query }) => unknown) => run({ query: mock.query }) }));
vi.mock("./workspace-persistence", () => ({ workspacePersistenceMode: mock.mode }));
vi.mock("./presentation-demo", () => ({ readPresentationDemo: mock.demo }));
vi.mock("./closespan-prompt-agent", () => ({ testPromptWithCloseSpanAgent: mock.evaluate }));
vi.mock("./pdd-prompt-evaluation-repository", () => ({ beginPddPromptEvaluation: mock.begin,
  failPddPromptEvaluation: mock.fail, readPddAcceptanceContract: mock.contract }));
import { postIssueScenarioCheck, readIssueScenarioCheck } from "./issue-scenario-check-repository";

const hash = "a".repeat(64);
const context: RequestContext = { orgId: "org", organizationName: "Team", actorId: "alice", actorName: "Alice", actorEmail: "alice@example.com", role: "Contributor", idempotencyKey: "scenario-send-123", traceId: "trace" };
const body = { userStory: "Export every selected row.", currentPromptHash: hash };
const evaluation = { verdict: "Passed", changes: [], suggestedRevision: null, acceptanceContract: "Keep protected criteria",
  pddVersion: "0.0.309", executionMode: "local", model: "test-model", costUsd: 0.1, promptHash: hash };
const defaultPrompt = { id: "prompt", content_hash: hash, status: "Ready", rendered_content: "Export every selected row and preserve existing tests.", specification_id: "spec", specification_revision: 1 };
type Stored = { id: string; org_id: string; problem_id: string; actor_id: string; idempotency_key: string; request_hash: string;
  prompt_id: string; prompt_hash: string; user_story: string; status: string; evaluation_id: string | null;
  prompt_evaluation: unknown; reserved_budget_usd: number; cost_usd: number | null; created_at: Date };
let checks: Stored[];
let prompt: typeof defaultPrompt | null;
let settings: { autonomy_level: string; monthly_model_budget: number; used_model_cost: number; hard_stop: boolean };
let activeRun: boolean;
let missingTable: boolean;
let committed: number;
const rows = (items: unknown[]) => ({ rows: items, rowCount: items.length });

async function fakeQuery(query: string, values: unknown[] = []) {
  const sql = query.replace(/\s+/g, " ");
  if (sql.includes("FROM product_problems")) return rows(values[0] === "org" && values[1] === "issue" ? [{ stage: "Needs review" }] : []);
  if (sql.includes("FROM implementation_prompts")) return rows(prompt ? [prompt] : []);
  if (sql.includes("FROM workspace_settings")) return rows([settings]);
  if (sql.includes("FROM agent_runs")) return rows(activeRun ? [{}] : []);
  if (missingTable && sql.includes("issue_scenario_checks")) throw Object.assign(new Error("missing table"), { code: "42P01" });
  if (sql.startsWith("SELECT COALESCE")) return rows([{ committed: String(committed + checks.reduce((total, row) => total + (row.cost_usd ?? row.reserved_budget_usd), 0)) }]);
  if (sql.startsWith("SELECT") && sql.includes("FROM issue_scenario_checks")) return rows(checks.filter((row) => row.org_id === values[0] && row.problem_id === values[1]
    && (sql.includes("idempotency_key=$3") ? row.idempotency_key === values[2] : sql.includes("prompt_hash=$3") ? row.prompt_hash === values[2] : row.status === "processing")).slice().reverse().slice(0, 1));
  if (sql.startsWith("INSERT INTO issue_scenario_checks")) {
    const row: Stored = { id: String(values[0]), org_id: String(values[1]), problem_id: String(values[2]), actor_id: String(values[3]), idempotency_key: String(values[4]), request_hash: String(values[5]), prompt_id: String(values[6]), prompt_hash: String(values[7]), user_story: String(values[8]), status: "processing", evaluation_id: null, prompt_evaluation: null, reserved_budget_usd: Number(values[9]), cost_usd: null, created_at: new Date() };
    checks.push(row); return rows([row]);
  }
  if (sql.startsWith("UPDATE issue_scenario_checks")) {
    const selected = checks.filter((row) => row.org_id === values[0] && row.problem_id === values[1] && row.status === "processing"
      && (sql.includes("id=$3") ? row.id === values[2] : Date.now() - row.created_at.getTime() > 600_000));
    for (const row of selected) {
      if (sql.includes("SET evaluation_id")) row.evaluation_id = String(values[3]);
      else if (sql.includes("status='completed'")) { row.status = "completed"; row.prompt_evaluation = JSON.parse(String(values[3])); row.cost_usd = values[4] as number | null; }
      else { row.status = "failed"; if (sql.includes("CASE WHEN") && values[3] === false) row.cost_usd = 0; }
    }
    return rows(selected);
  }
  if (sql.startsWith("UPDATE pdd_prompt_evaluations")) return rows([{}]);
  throw new Error(`Unexpected query: ${sql}`);
}

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("APP_MODE", "production");
  vi.stubEnv("PROMPT_ALIGNMENT_SECRET", "test-scenario-signing-secret-at-least-32-characters");
  checks = []; prompt = { ...defaultPrompt }; activeRun = false; missingTable = false; committed = 0;
  settings = { autonomy_level: "Execute with approval", monthly_model_budget: 100, used_model_cost: 5, hard_stop: true };
  mock.mode.mockReturnValue("postgres"); mock.demo.mockResolvedValue(false); mock.query.mockImplementation(fakeQuery);
  mock.begin.mockResolvedValue({ shouldRun: true, evaluation: { id: "evaluation" } }); mock.fail.mockResolvedValue(undefined);
  mock.contract.mockResolvedValue("Protected existing contract"); mock.evaluate.mockResolvedValue({ ...evaluation });
});
afterEach(() => vi.unstubAllEnvs());

describe("durable issue scenario checks", () => {
  it("reserves before inference, stores the PDD result, and replays without paying again", async () => {
    mock.evaluate.mockImplementationOnce(async (input) => {
      expect(checks).toHaveLength(1); expect(checks[0].status).toBe("processing");
      expect(checks[0].evaluation_id).toBe("evaluation");
      expect(input).toMatchObject({ promptHash: hash, userStory: body.userStory, implementationPrompt: defaultPrompt.rendered_content,
        budgetUsd: 5, acceptanceContract: "Protected existing contract" });
      return evaluation;
    });
    const result = await postIssueScenarioCheck(context, "issue", body);
    expect(result).toMatchObject({ status: "completed", replayed: false, promptHash: hash, evaluationId: "evaluation", promptEvaluation: { verdict: "Passed" } });
    expect(() => assertPromptAlignmentReceipt(result.promptEvaluation?.alignmentReceipt, { orgId: "org", problemId: "issue", promptHash: hash, storyHash: sha256(body.userStory) })).not.toThrow();
    expect(await postIssueScenarioCheck(context, "issue", body)).toMatchObject({ ...result, replayed: true });
    expect(mock.evaluate).toHaveBeenCalledTimes(1); expect(mock.begin).toHaveBeenCalledTimes(1);
    const savedPdd = mock.query.mock.calls.find(([sql]) => String(sql).includes("UPDATE pdd_prompt_evaluations"));
    expect(JSON.parse(savedPdd![1][2])).toMatchObject({ alignmentReceipt: null, revisionReceipt: null, promptHash: hash });
    expect(await readIssueScenarioCheck("org", "issue")).toMatchObject({ storageReady: true, currentPromptHash: hash, check: { status: "completed" } });
  });

  it("keeps in-flight and failed retries safe, including another key", async () => {
    let resolve!: (value: unknown) => void;
    mock.evaluate.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const first = postIssueScenarioCheck(context, "issue", body);
    await vi.waitFor(() => expect(mock.evaluate).toHaveBeenCalledTimes(1));
    expect(await postIssueScenarioCheck(context, "issue", body)).toMatchObject({ status: "processing", replayed: true });
    expect(await readIssueScenarioCheck("org", "issue")).toMatchObject({ check: { status: "processing" } });
    await expect(postIssueScenarioCheck({ ...context, idempotencyKey: "other-send-123" }, "issue", body)).rejects.toMatchObject({ status: 409 });
    resolve(evaluation); await first;
    expect(mock.evaluate).toHaveBeenCalledTimes(1);
  });

  it("makes ambiguous failures terminal and keeps the budget reserved", async () => {
    mock.evaluate.mockRejectedValue(new Error("provider api_key=secret host=private"));
    const result = await postIssueScenarioCheck(context, "issue", body);
    expect(result).toMatchObject({ status: "failed", notice: expect.not.stringMatching(/secret|private/) });
    expect(await postIssueScenarioCheck(context, "issue", body)).toMatchObject({ status: "failed", replayed: true });
    expect(checks[0].cost_usd).toBeNull(); expect(mock.evaluate).toHaveBeenCalledTimes(1);
    expect(mock.fail).toHaveBeenCalledWith("org", "evaluation", expect.not.stringMatching(/secret|private/));
  });

  it("releases the budget when preparation fails before any provider call", async () => {
    mock.contract.mockRejectedValue(new Error("database unavailable"));
    expect(await postIssueScenarioCheck(context, "issue", body)).toMatchObject({ status: "failed" });
    expect(checks[0].cost_usd).toBe(0); expect(mock.evaluate).not.toHaveBeenCalled();
  });

  it("never reclaims an expired key and does not expose obsolete results in GET", async () => {
    await postIssueScenarioCheck(context, "issue", body);
    checks[0].status = "processing"; checks[0].created_at = new Date(Date.now() - 660_000);
    expect(await postIssueScenarioCheck(context, "issue", body)).toMatchObject({ status: "failed", replayed: true });
    prompt!.content_hash = "b".repeat(64);
    expect(await readIssueScenarioCheck("org", "issue")).toMatchObject({ check: null, currentPromptHash: "b".repeat(64) });
    expect(mock.evaluate).toHaveBeenCalledTimes(1);
  });

  it("binds the replay key to actor, scenario text, and prompt hash", async () => {
    await postIssueScenarioCheck(context, "issue", body);
    for (const changed of [{ userStory: "A different expected outcome" }, { currentPromptHash: "b".repeat(64) }])
      await expect(postIssueScenarioCheck(context, "issue", { ...body, ...changed })).rejects.toMatchObject({ status: 409 });
    await expect(postIssueScenarioCheck({ ...context, actorId: "bob" }, "issue", body)).rejects.toMatchObject({ status: 409 });
    expect(mock.evaluate).toHaveBeenCalledTimes(1);
  });

  it.each(["absent", "changed", "approved", "running"])("rejects %s implementation state before paid work", async (kind) => {
    if (kind === "absent") prompt = null;
    if (kind === "changed") prompt!.content_hash = "b".repeat(64);
    if (kind === "approved") prompt!.status = "Approved";
    if (kind === "running") activeRun = true;
    await expect(postIssueScenarioCheck(context, "issue", body)).rejects.toMatchObject({ status: 409 });
    expect(mock.evaluate).not.toHaveBeenCalled(); expect(checks).toHaveLength(0);
  });

  it("rechecks the prompt after evaluation and never saves stale success or receipts", async () => {
    mock.evaluate.mockImplementation(async () => { prompt!.content_hash = "b".repeat(64); return evaluation; });
    expect(await postIssueScenarioCheck(context, "issue", body)).toMatchObject({ status: "failed" });
    expect(mock.query.mock.calls.some(([sql]) => String(sql).includes("UPDATE pdd_prompt_evaluations"))).toBe(false);
    expect(checks[0].prompt_evaluation).toBeNull();
  });

  it("rechecks the prompt immediately before evaluation", async () => {
    mock.contract.mockImplementation(async () => { prompt!.status = "Approved"; return undefined; });
    expect(await postIssueScenarioCheck(context, "issue", body)).toMatchObject({ status: "failed" });
    expect(mock.evaluate).not.toHaveBeenCalled();
  });

  it.each([{ autonomy_level: "Observe" }, { hard_stop: false }, { monthly_model_budget: 0 }, { used_model_cost: 100 }, { used_model_cost: NaN }])("requires policy and available recorded budget %j", async (change) => {
    settings = { ...settings, ...change };
    await expect(postIssueScenarioCheck(context, "issue", body)).rejects.toMatchObject({ status: 409 });
    expect(mock.evaluate).not.toHaveBeenCalled();
  });

  it("subtracts existing scenario commitments and passes only the remaining cap to the runner", async () => {
    committed = 94.5;
    expect(await postIssueScenarioCheck(context, "issue", body)).toMatchObject({ status: "completed" });
    expect(mock.evaluate.mock.calls[0][0].budgetUsd).toBe(0.5);
    committed = 95;
    await expect(postIssueScenarioCheck({ ...context, idempotencyKey: "second-scenario" }, "issue", body)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects mismatched result hashes and over-budget reported charges", async () => {
    mock.evaluate.mockResolvedValue({ ...evaluation, promptHash: "b".repeat(64) });
    expect(await postIssueScenarioCheck(context, "issue", body)).toMatchObject({ status: "failed" });
    mock.evaluate.mockResolvedValue({ ...evaluation, costUsd: 6 });
    expect(await postIssueScenarioCheck({ ...context, idempotencyKey: "second-scenario" }, "issue", body)).toMatchObject({ status: "failed" });
  });

  it("requires tenant ownership and contributor permission", async () => {
    await expect(readIssueScenarioCheck("other-org", "issue")).rejects.toMatchObject({ status: 404 });
    await expect(postIssueScenarioCheck({ ...context, orgId: "other-org" }, "issue", body)).rejects.toMatchObject({ status: 404 });
    await expect(postIssueScenarioCheck({ ...context, role: "Viewer" }, "issue", body)).rejects.toMatchObject({ status: 403 });
    expect(mock.evaluate).not.toHaveBeenCalled();
  });

  it.each(["memory", "demo", "presentation", "test"])("does not call providers in %s mode", async (mode) => {
    if (mode === "memory") mock.mode.mockReturnValue("memory");
    if (mode === "demo") vi.stubEnv("APP_MODE", "demo");
    if (mode === "test") vi.stubEnv("NODE_ENV", "test");
    if (mode === "presentation") mock.demo.mockResolvedValue(true);
    await expect(postIssueScenarioCheck(context, "issue", body)).rejects.toBeInstanceOf(Error);
    expect(mock.evaluate).not.toHaveBeenCalled(); expect(mock.begin).not.toHaveBeenCalled();
  });

  it("has a setup state without its migration and rejects untrusted extra fields", async () => {
    missingTable = true;
    expect(await readIssueScenarioCheck("org", "issue")).toMatchObject({ check: null, storageReady: false });
    await expect(postIssueScenarioCheck(context, "issue", body)).rejects.toMatchObject({ status: 503 });
    await expect(postIssueScenarioCheck(context, "issue", { ...body, triggerSource: "automatic" })).rejects.toMatchObject({ status: 400 });
    expect(mock.evaluate).not.toHaveBeenCalled();
  });
});
