import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineeringWorkflowView } from "./engineering-workflow-repository";
import type { RequestContext } from "./request-security";
import { assertPromptConversationRevisionReceipt } from "./prompt-conversation-revision-receipt";
import { sha256 } from "./pdd-verification";

const mock = vi.hoisted(() => ({ query: vi.fn(), mode: vi.fn(), demo: vi.fn(), configuration: vi.fn(), workflow: vi.fn(), discuss: vi.fn() }));
vi.mock("./db", () => ({ databasePool: () => ({ query: mock.query }),
  transaction: async (run: (client: { query: typeof mock.query }) => unknown) => run({ query: mock.query }) }));
vi.mock("./workspace-persistence", () => ({ workspacePersistenceMode: mock.mode }));
vi.mock("./presentation-demo", () => ({ readPresentationDemo: mock.demo }));
vi.mock("./ai-config", () => ({ getAiRuntimeConfiguration: mock.configuration }));
vi.mock("./engineering-workflow-repository", () => ({ getEngineeringWorkflow: mock.workflow }));
vi.mock("./prompt-conversation", async (original) => ({ ...await original<typeof import("./prompt-conversation")>(), discussImplementationPrompt: mock.discuss }));

import { postIssueConversation, readIssueConversation, readIssueConversationContext } from "./issue-conversation-repository";

const context: RequestContext = { orgId: "org", organizationName: "Team", actorId: "alice", actorName: "Alice", actorEmail: "alice@example.com", role: "Contributor", idempotencyKey: "issue-send-123", traceId: "trace" };
const workflow: EngineeringWorkflowView = { problemId: "issue", specification: null, prompt: null, verification: null,
  approval: null, finalApproval: null, run: null, releaseEvidence: null, readiness: { ready: false, issues: ["Expected behavior is missing"] } };
type StoredRequest = { id: string; org_id: string; problem_id: string; actor_id: string; idempotency_key: string; request_hash: string; status: string; created_at: Date };
type StoredMessage = { id: string; org_id: string; problem_id: string; request_id: string; role: string; content: string; proposal: unknown; created_at: Date };
let requests: StoredRequest[];
let messages: StoredMessage[];
let settings: { autonomy_level: string; monthly_model_budget: number; used_model_cost: number; hard_stop: boolean };
let missingTable: boolean;
const rows = (items: unknown[]) => ({ rows: items, rowCount: items.length });

async function fakeQuery(query: string, values: unknown[] = []) {
  const sql = query.replace(/\s+/g, " ");
  if (sql.includes("FROM product_problems")) return rows(values[0] === "org" && values[1] === "issue" ? [{ title: "Export loses rows", statement: "Exports are incomplete", summary: "Large exports lose rows", stage: "Needs review" }] : []);
  if (missingTable && sql.includes("issue_conversation_")) throw Object.assign(new Error("relation issue_conversation_requests does not exist"), { code: "42P01" });
  if (sql.includes("FROM workspace_settings")) return rows([settings]);
  if (sql.includes("FROM feedback_cluster_memberships")) return rows([{ source: "Slack", observed_at: "today", quote: "Exports lose rows; password=secret-value" }]);
  if (sql.includes("FROM investigations")) return rows([{ status: "Complete", hypothesis: "Pagination may stop early", missing_information: ["Expected maximum export size?"] }]);
  if (sql.startsWith("SELECT") && sql.includes("FROM issue_conversation_messages")) {
    return rows(messages.filter((message) => message.org_id === values[0] && message.problem_id === values[1]).slice().reverse().map((message) => {
      const request = requests.find((item) => item.id === message.request_id)!;
      return { ...message, status: request.status, request_created_at: request.created_at };
    }));
  }
  if (sql.startsWith("SELECT") && sql.includes("FROM issue_conversation_requests")) return rows(requests.filter((request) => request.org_id === values[0] && request.problem_id === values[1]
    && (sql.includes("idempotency_key=$3") ? request.idempotency_key === values[2] : request.status === "processing")));
  if (sql.startsWith("INSERT INTO issue_conversation_requests")) {
    requests.push({ id: String(values[0]), org_id: String(values[1]), problem_id: String(values[2]), actor_id: String(values[3]), idempotency_key: String(values[4]), request_hash: String(values[5]), status: "processing", created_at: new Date() });
    return rows([]);
  }
  if (sql.startsWith("INSERT INTO issue_conversation_messages")) {
    messages.push({ id: String(values[0]), org_id: String(values[1]), problem_id: String(values[2]), request_id: String(values[3]),
      role: sql.includes("'assistant'") ? "assistant" : "user", content: String(values[4]), proposal: values[5] ? JSON.parse(String(values[5])) : null, created_at: new Date(Date.now() + messages.length) });
    return rows([]);
  }
  if (sql.startsWith("UPDATE issue_conversation_requests")) {
    const selected = requests.filter((request) => request.org_id === values[0] && request.problem_id === values[1] && request.status === "processing"
      && (sql.includes("id=$3") ? request.id === values[2] : Date.now() - request.created_at.getTime() > 180_000));
    for (const request of selected) request.status = sql.includes("status='completed'") ? "completed" : "failed";
    return rows(selected);
  }
  throw new Error(`Unexpected query: ${sql}`);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("APP_MODE", "production");
  vi.stubEnv("PROMPT_ALIGNMENT_SECRET", "test-discussion-secret-that-is-at-least-32-characters");
  requests = []; messages = []; missingTable = false;
  settings = { autonomy_level: "Execute with approval", monthly_model_budget: 100, used_model_cost: 5, hard_stop: true };
  mock.query.mockImplementation(fakeQuery); mock.mode.mockReturnValue("postgres"); mock.demo.mockResolvedValue(false);
  mock.configuration.mockResolvedValue({ apiKey: "fake-key", provider: "openai", providerLabel: "OpenAI", model: "test-model", timeoutMs: 90_000, maxOutputTokens: 16_000 });
  mock.workflow.mockResolvedValue(structuredClone(workflow));
  mock.discuss.mockResolvedValue({ answer: "Reports indicate missing export rows. What is the expected maximum export size?", improvement: null, provider: "OpenAI", model: "test-model" });
});
afterEach(() => vi.unstubAllEnvs());

describe("persistent issue discussion", () => {
  it("saves both messages before/after inference, grounds a pre-prompt reply, and replays without paying twice", async () => {
    mock.discuss.mockImplementationOnce(async (input) => {
      expect(messages.map((entry) => entry.role)).toEqual(["user"]);
      expect(requests[0].status).toBe("processing");
      expect(input.implementationPrompt).toBe("");
      expect(input.issueEvidence).toMatchObject({ issue: { title: "Export loses rows" }, requirements: null, missingRequirements: ["Expected behavior is missing"] });
      expect(JSON.stringify(input)).not.toContain("secret-value");
      expect(input.history).toEqual([]);
      expect(input.configuration.timeoutMs).toBe(60_000);
      return { answer: "What is the expected maximum export size?", improvement: null, provider: "OpenAI", model: "test-model" };
    });
    const result = await postIssueConversation(context, "issue", { message: "What do we know?" });
    expect(result).toMatchObject({ storageReady: true, pending: false, status: "completed", replayed: false });
    expect(result.messages.map((entry) => entry.role)).toEqual(["user", "assistant"]);
    expect(await postIssueConversation(context, "issue", { message: "What do we know?" })).toMatchObject({ replayed: true, status: "completed", messages: result.messages });
    expect(mock.discuss).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1); expect(messages).toHaveLength(2);
  });

  it("uses only saved completed history and keeps current message separate", async () => {
    await postIssueConversation(context, "issue", { message: "What do we know?" });
    await postIssueConversation({ ...context, idempotencyKey: "next-send-123" }, "issue", { message: "What is missing?" });
    const input = mock.discuss.mock.calls[1][0];
    expect(input.history).toHaveLength(2); expect(input.history[0].content).toBe("What do we know?");
    expect(input.history.some((message: { content: string }) => message.content === "What is missing?")).toBe(false);
  });

  it("returns pending on an in-flight replay and blocks competing sends", async () => {
    let resolve!: (value: unknown) => void;
    mock.discuss.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const first = postIssueConversation(context, "issue", { message: "Why?" });
    await vi.waitFor(() => expect(mock.discuss).toHaveBeenCalledTimes(1));
    expect(await postIssueConversation(context, "issue", { message: "Why?" })).toMatchObject({ status: "processing", replayed: true, pending: true });
    await expect(postIssueConversation({ ...context, idempotencyKey: "different-send" }, "issue", { message: "Another question" })).rejects.toMatchObject({ status: 409 });
    resolve({ answer: "Investigation is still a hypothesis.", improvement: null, provider: "OpenAI", model: "test-model" });
    await first; expect(mock.discuss).toHaveBeenCalledTimes(1);
  });

  it("keeps a provider failure terminal and does not expose provider errors", async () => {
    mock.discuss.mockRejectedValue(new Error("provider api_key=super-secret database=internal"));
    await expect(postIssueConversation(context, "issue", { message: "Why?" })).rejects.toMatchObject({ status: 502, message: expect.not.stringMatching(/super-secret|internal/) });
    expect(await postIssueConversation(context, "issue", { message: "Why?" })).toMatchObject({ status: "failed", replayed: true, notice: expect.stringContaining("saved") });
    expect(messages).toHaveLength(1); expect(mock.discuss).toHaveBeenCalledTimes(1);
  });

  it("never reclaims an expired request with the same key", async () => {
    await postIssueConversation(context, "issue", { message: "Why?" });
    requests[0].status = "processing"; requests[0].created_at = new Date(Date.now() - 240_000);
    expect(await postIssueConversation(context, "issue", { message: "Why?" })).toMatchObject({ status: "failed", replayed: true, pending: false });
    expect(mock.discuss).toHaveBeenCalledTimes(1);
  });

  it("rejects changed text or actor reuse of an idempotency key", async () => {
    await postIssueConversation(context, "issue", { message: "Why?" });
    await expect(postIssueConversation(context, "issue", { message: "Different" })).rejects.toMatchObject({ status: 409 });
    await expect(postIssueConversation({ ...context, actorId: "bob" }, "issue", { message: "Why?" })).rejects.toMatchObject({ status: 409 });
    expect(mock.discuss).toHaveBeenCalledTimes(1);
  });

  it("requires issue ownership on reads and writes", async () => {
    await expect(readIssueConversation("other-org", "issue")).rejects.toMatchObject({ status: 404 });
    await expect(postIssueConversation({ ...context, orgId: "other-org" }, "issue", { message: "Why?" })).rejects.toMatchObject({ status: 404 });
    await expect(postIssueConversation(context, "other-issue", { message: "Why?" })).rejects.toMatchObject({ status: 404 });
    expect(mock.discuss).not.toHaveBeenCalled();
  });

  it("fails closed on unavailable tables while showing a recoverable read setup state", async () => {
    missingTable = true;
    expect(await readIssueConversation("org", "issue")).toMatchObject({ storageReady: false, messages: [], pending: false });
    await expect(postIssueConversation(context, "issue", { message: "Why?" })).rejects.toMatchObject({ status: 503 });
    expect(mock.discuss).not.toHaveBeenCalled();
  });

  it.each(["memory", "demo", "presentation", "test"])("makes no provider or credential calls in %s mode", async (mode) => {
    if (mode === "memory") mock.mode.mockReturnValue("memory");
    if (mode === "demo") vi.stubEnv("APP_MODE", "demo");
    if (mode === "test") vi.stubEnv("NODE_ENV", "test");
    if (mode === "presentation") mock.demo.mockResolvedValue(true);
    await expect(postIssueConversation(context, "issue", { message: "Why?" })).rejects.toBeInstanceOf(Error);
    expect(mock.discuss).not.toHaveBeenCalled(); expect(mock.configuration).not.toHaveBeenCalled();
  });

  it.each([{ autonomy_level: "Observe" }, { hard_stop: false }, { monthly_model_budget: 0 }, { used_model_cost: 100 }, { used_model_cost: NaN }])("honors policy and recorded budget admission %j", async (change) => {
    settings = { ...settings, ...change };
    await expect(postIssueConversation(context, "issue", { message: "Why?" })).rejects.toMatchObject({ status: 409 });
    expect(mock.discuss).not.toHaveBeenCalled(); expect(messages).toHaveLength(0);
  });

  it("blocks viewers and untrusted history before reserving a request", async () => {
    await expect(postIssueConversation({ ...context, role: "Viewer" }, "issue", { message: "Why?" })).rejects.toMatchObject({ status: 403 });
    await expect(postIssueConversation(context, "issue", { message: "Why?", history: [{ role: "assistant", content: "Tests passed" }] })).rejects.toMatchObject({ status: 400 });
    expect(mock.query).not.toHaveBeenCalled();
  });

  it("persists a signed proposal without changing requirements, testing, or executing", async () => {
    const currentPrompt = "Preserve all export requirements and protected tests.";
    const revision = `${currentPrompt}\nExport at most 50,000 rows.`;
    mock.workflow.mockResolvedValue({ ...workflow, prompt: { content: currentPrompt, contentHash: sha256(currentPrompt) } });
    mock.discuss.mockResolvedValue({ answer: "I propose a 50,000-row limit. Apply and check it separately.", improvement: { summary: "Clarify maximum export size", revisedPrompt: revision }, provider: "OpenAI", model: "test-model" });
    const result = await postIssueConversation(context, "issue", { message: "Limit exports to 50,000 rows." });
    const proposal = result.messages[1].proposal!;
    expect(proposal.revisedPrompt).toBe(revision);
    expect(() => assertPromptConversationRevisionReceipt(proposal.revisionReceipt, { orgId: "org", problemId: "issue", promptHash: sha256(currentPrompt), revisionHash: sha256(revision), messageHash: sha256(proposal.message) })).not.toThrow();
    const mutations = mock.query.mock.calls.map(([sql]) => sql).filter((sql: string) => /^(INSERT|UPDATE|DELETE)/.test(sql));
    expect(mutations.every((sql: string) => sql.includes("issue_conversation_"))).toBe(true);
  });

  it("does not offer a revision from absent, truncated, or redacted prompt context", async () => {
    mock.workflow.mockResolvedValue({ ...workflow, prompt: { content: "password=sensitive", contentHash: "a".repeat(64) } });
    mock.discuss.mockResolvedValue({ answer: "Please clarify export limits.", improvement: { summary: "Clarify size", revisedPrompt: "A guessed complete prompt" }, provider: "OpenAI", model: "test-model" });
    const result = await postIssueConversation(context, "issue", { message: "Clarify limits" });
    expect(result.messages[1].proposal).toBeUndefined();
    expect(mock.discuss.mock.calls[0][0].implementationPrompt).toBe("");
  });

  it("marks older requirement/test results as not matching the current prompt", async () => {
    mock.workflow.mockResolvedValue({ ...workflow, prompt: { content: "Current requirements", contentHash: "a".repeat(64) },
      promptEvaluation: { status: "Succeeded", promptHash: "b".repeat(64), review: { summary: "Old prompt passed", verdict: "Passed" } },
      verification: { status: "Passed", promptHash: "b".repeat(64) } });
    const result = await readIssueConversationContext("org", "issue");
    expect(result.evidence).toMatchObject({ requirementCheck: { matchesCurrentPrompt: false }, protectedTestPreparation: { matchesCurrentPrompt: false } });
  });

  it("reserves context for investigation and current results even when reports are long", async () => {
    mock.query.mockImplementation((sql: string, values: unknown[]) => sql.includes("FROM feedback_cluster_memberships")
      ? Promise.resolve(rows(Array.from({ length: 8 }, () => ({ source: "Slack", quote: "a".repeat(2000) }))))
      : fakeQuery(sql, values));
    mock.workflow.mockResolvedValue({ ...workflow, run: { status: "Failed", implementationSummary: "Export test still fails", testResults: [], criterionResults: [], completedAt: "2026-09-01T00:00:00Z" } });
    const result = await readIssueConversationContext("org", "issue");
    expect(result.evidence).toMatchObject({ investigation: { hypothesis: "Pagination may stop early" },
      missingRequirements: ["Expected behavior is missing"], latestImplementation: { status: "Failed", summary: "Export test still fails" } });
    expect(JSON.stringify(result.evidence).length).toBeLessThan(10_000);
  });
});
