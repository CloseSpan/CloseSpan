import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestContext } from "./request-security";
const mock = vi.hoisted(() => ({ query: vi.fn(), mode: vi.fn(), demo: vi.fn(), connection: vi.fn(), provider: vi.fn(), verify: vi.fn(), evidence: vi.fn(), history: vi.fn(), workflow: vi.fn(), current: vi.fn() }));
vi.mock("./db", () => ({ databasePool: () => ({ query: mock.query }), transaction: (work: (client: unknown) => unknown) => work({ query: mock.query }) }));
vi.mock("./workspace-persistence", () => ({ workspacePersistenceMode: mock.mode }));
vi.mock("./presentation-demo", () => ({ readPresentationDemo: mock.demo }));
vi.mock("./retell-repository", () => ({ loadRetellConnection: mock.connection }));
vi.mock("./issue-voice-provider", async (original) => ({ ...await original<object>(), voiceProviderRequest: mock.provider, verifyIssueVoiceAgent: mock.verify }));
vi.mock("./issue-conversation-repository", () => ({ readIssueConversationContext: mock.evidence, readIssueConversation: mock.history }));
vi.mock("./engineering-workflow-repository", () => ({ getEngineeringWorkflow: mock.workflow }));
vi.mock("./issue-workspace-context", () => ({ readIssueWorkspaceContext: mock.current }));
import { authorizeVoiceSession, endIssueVoice, issueVoiceAvailability, issueVoiceCredentials, prepareVoiceEvidence, signVoiceTicket, startIssueVoice, verifyVoiceTicket } from "./issue-voice-repository";

const context: RequestContext = { orgId: "org", actorId: "actor", actorName: "Tester", actorEmail: "tester@example.com", organizationName: "Workspace", role: "Contributor", idempotencyKey: "voice-test-123", traceId: "trace" };
const ticket = { orgId: "org", actorId: "actor", problemId: "issue", callId: "call_local", sessionId: "59a3119e-c3d3-4228-aa91-6d0ae4f60c08", expiresAt: Date.now() + 600000 };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("APP_MODE", "production");
  vi.stubEnv("CLOSESPAN_RETELL_AGENT_ID", "agent_service"); vi.stubEnv("CLOSESPAN_RETELL_API_KEY", "server-only-key");
  vi.stubEnv("CLOSESPAN_RETELL_ALLOWED_ORG_IDS", "org"); vi.stubEnv("CLOSESPAN_RETELL_TEST_ORG_ID", "");
  vi.stubEnv("CLOSESPAN_RETELL_SIGNING_KEY", "test-signing-key-with-at-least-32-characters");
  mock.mode.mockReturnValue("postgres"); mock.demo.mockResolvedValue(false);
  mock.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM idempotency_keys")) return { rows: [], rowCount: 0 };
    if (sql.includes("count(*) AS total")) return { rows: [{ total: "0", actor: "0", active: "0", actor_active: "0" }], rowCount: 1 };
    return { rows: [{}], rowCount: 1 };
  });
  mock.evidence.mockResolvedValue({ evidence: { issue: { title: "Export", statement: "api_key=secret-value" } }, prompt: { content: "private full prompt" } });
  mock.history.mockResolvedValue({ messages: [], storageReady: true, pending: false });
  mock.workflow.mockResolvedValue({ run: null }); mock.current.mockResolvedValue({ verification: null });
  mock.provider.mockResolvedValue({ call_id: "call_local", access_token: "single-call-token", transport: "gateway", ice_servers: [] });
});
afterEach(() => vi.unstubAllEnvs());

describe("issue voice service", () => {
  it("reports availability without creating a call or reading any credential", async () => {
    expect((await issueVoiceAvailability(context, "issue")).available).toBe(true);
    expect(mock.provider).not.toHaveBeenCalled(); expect(mock.connection).not.toHaveBeenCalled();
    expect(mock.query).toHaveBeenCalledWith(expect.stringContaining("org_id=$1 AND id=$2"), ["org", "issue"]);
  });
  it.each(["Viewer", "Unknown"])("blocks %s roles", async (role) => {
    await expect(startIssueVoice({ ...context, role }, "issue")).rejects.toMatchObject({ status: 403 });
    expect(mock.provider).not.toHaveBeenCalled();
  });
  it("blocks demo and nonexistent/cross-workspace issues", async () => {
    mock.demo.mockResolvedValueOnce(true);
    await expect(startIssueVoice(context, "issue")).rejects.toMatchObject({ status: 403 });
    mock.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(startIssueVoice(context, "foreign")).rejects.toMatchObject({ status: 404 });
    expect(mock.provider).not.toHaveBeenCalled();
  });
  it("never uses a customer's import key in production, even with a local test flag", async () => {
    vi.stubEnv("CLOSESPAN_RETELL_API_KEY", ""); vi.stubEnv("CLOSESPAN_RETELL_TEST_ORG_ID", "org");
    await expect(issueVoiceCredentials("org")).rejects.toMatchObject({ status: 503 });
    expect(mock.connection).not.toHaveBeenCalled();
    vi.stubEnv("NODE_ENV", "development"); mock.connection.mockResolvedValue({ apiKey: "approved-local-key" });
    expect((await issueVoiceCredentials("org")).apiKey).toBe("approved-local-key");
    await expect(issueVoiceCredentials("other-org")).rejects.toMatchObject({ status: 503 });
  });
  it("creates only a web call from saved bounded context and returns a scoped ticket, never the key", async () => {
    const result = await startIssueVoice(context, "issue");
    expect(mock.verify).toHaveBeenCalledWith("server-only-key", "agent_service");
    expect(mock.provider).toHaveBeenCalledTimes(1);
    expect(mock.provider.mock.calls[0][1]).toBe("/v3/create-web-call");
    const body = JSON.stringify(mock.provider.mock.calls[0][2]);
    expect(body).not.toContain("secret-value"); expect(body).not.toContain("private full prompt");
    expect(JSON.stringify(result)).not.toContain("server-only-key");
    expect(verifyVoiceTicket(result.ticket, context, "issue").callId).toBe("call_local");
    expect(mock.query.mock.calls.some(([sql]) => sql.includes("pg_advisory_xact_lock"))).toBe(true);
  });
  it.each([
    { total: "40", actor: "0", active: "0", actor_active: "0" },
    { total: "2", actor: "0", active: "3", actor_active: "0" },
    { total: "10", actor: "10", active: "0", actor_active: "0" },
    { total: "1", actor: "1", active: "1", actor_active: "1" },
  ])("enforces persistent voice limits %j", async (counts) => {
    mock.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("count(*) AS total") ? [counts] : [{}], rowCount: sql.includes("FROM idempotency_keys") ? 0 : 1 }));
    await expect(startIssueVoice(context, "issue")).rejects.toMatchObject({ status: counts.actor_active === "1" ? 409 : 429 });
    expect(mock.provider).not.toHaveBeenCalled();
  });
  it("rejects replayed create requests without charging twice", async () => {
    mock.query.mockResolvedValue({ rows: [{}], rowCount: 1 });
    await expect(startIssueVoice(context, "issue")).rejects.toMatchObject({ status: 409 });
    expect(mock.provider).not.toHaveBeenCalled();
  });
  it("stops a created call when the provider omits its media token", async () => {
    mock.provider.mockResolvedValueOnce({ call_id: "call_malformed" }).mockResolvedValueOnce({});
    await expect(startIssueVoice(context, "issue")).rejects.toMatchObject({ status: 502 });
    expect(mock.provider).toHaveBeenLastCalledWith("server-only-key", "/v2/stop-call/call_malformed", {});
    expect(mock.query.mock.calls.some(([, values]) => values?.includes("Ended an issue voice session"))).toBe(true);
  });
  it("binds tickets to the issue, actor, organization, expiry and signature", () => {
    const token = signVoiceTicket(ticket);
    expect(() => verifyVoiceTicket(token, { ...context, actorId: "another" }, "issue")).toThrow();
    expect(() => verifyVoiceTicket(token, { ...context, orgId: "another" }, "issue")).toThrow();
    expect(() => verifyVoiceTicket(token, context, "another")).toThrow();
    expect(() => verifyVoiceTicket(token + "x", context, "issue")).toThrow();
    expect(() => verifyVoiceTicket(signVoiceTicket({ ...ticket, expiresAt: 1 }), context, "issue")).toThrow();
  });
  it("requires a saved reservation and scopes stop to the signed call", async () => {
    const token = signVoiceTicket(ticket);
    await endIssueVoice(context, "issue", token);
    expect(mock.provider).toHaveBeenCalledWith("server-only-key", "/v2/stop-call/call_local", {});
    mock.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(authorizeVoiceSession(context, "issue", token)).rejects.toThrow();
  });
  it("only exposes an existing current https preview, with no URL credentials", async () => {
    const workflow = { prompt: { contentHash: "hash" }, approval: { id: "approval", promptHash: "hash" }, run: { id: "run", approvalId: "approval", runtimeEvidence: { healthStatus: "passed", previewUrl: "https://preview.example" } } };
    mock.workflow.mockResolvedValue(workflow);
    expect((await prepareVoiceEvidence("org", "issue")).links).toHaveLength(2);
    workflow.run.runtimeEvidence.previewUrl = "https://user:password@preview.example";
    expect((await prepareVoiceEvidence("org", "issue")).links).toHaveLength(1);
    workflow.run.runtimeEvidence.previewUrl = "https://preview.example";
    workflow.approval.promptHash = "old";
    expect((await prepareVoiceEvidence("org", "issue")).links).toHaveLength(1);
  });
});
