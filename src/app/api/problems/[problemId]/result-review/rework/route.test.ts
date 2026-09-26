import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), context: vi.fn(), dispatch: vi.fn(), fail: vi.fn(), failUndispatched: vi.fn(), demo: vi.fn() }));
vi.mock("@/lib/issue-result-review-rework", () => ({ authorizeIssueResultRework: mocks.authorize, failUndispatchedIssueResultRework: mocks.failUndispatched }));
vi.mock("@/lib/engineering-workflow-repository", () => ({ getAgentRunExecutionContext: mocks.context, failAgentRun: mocks.fail }));
vi.mock("@/lib/agent-executor-client", () => ({ assertAgentExecutorConfigured: vi.fn(), dispatchAgentRun: mocks.dispatch, agentRunDispatchFailureCode: () => "dispatch_failed" }));
vi.mock("@/lib/presentation-demo", () => ({ readPresentationDemo: mocks.demo }));
import { POST } from "./route";

const params = { params: Promise.resolve({ problemId: "issue-a" }) };
function request(headers: Record<string, string> = {}, body = '{"reviewId":"review-a"}') {
  return new NextRequest("http://localhost/api/problems/issue-a/result-review/rework", { method: "POST", body,
    headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": "result_rework_test", ...headers } });
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.demo.mockResolvedValue(false); mocks.authorize.mockResolvedValue({ runId: "new-run", approvalId: "approval", replayed: false });
  mocks.context.mockResolvedValue({ orgId: "org-a", runId: "new-run" });
});

describe("explicit administrator result follow-up", () => {
  it("requires authentication and Admin separately from contributor feedback permission", async () => {
    expect((await POST(request({ "x-test-auth": "none" }), params)).status).toBe(401);
    expect((await POST(request({ "x-test-user-role": "Contributor" }), params)).status).toBe(403);
    expect(mocks.authorize).not.toHaveBeenCalled(); expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("blocks cross-tenant, cross-origin and demo execution", async () => {
    expect((await POST(request({ "x-org-id": "other" }), params)).status).toBe(403);
    expect((await POST(request({ origin: "https://attacker.test" }), params)).status).toBe(403);
    expect((await POST(request({ "idempotency-key": "" }), params)).status).toBe(400);
    mocks.demo.mockResolvedValue(true);
    expect((await POST(request(), params)).status).toBe(403);
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it("dispatches one newly authorized run and returns its durable IDs", async () => {
    const response = await POST(request({ "x-test-user-org-id": "org-a" }), params);
    expect(response.status).toBe(202); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ runId: "new-run", approvalId: "approval", replayed: false });
    expect(mocks.context).toHaveBeenCalledWith("org-a", "new-run"); expect(mocks.dispatch).toHaveBeenCalledOnce();
  });
  it("does not dispatch a replayed authorization again", async () => {
    mocks.authorize.mockResolvedValue({ runId: "new-run", approvalId: "approval", replayed: true });
    expect((await POST(request(), params)).status).toBe(202);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("records dispatch failure visibly without silently authorizing another run", async () => {
    mocks.dispatch.mockRejectedValue(new Error("executor unavailable"));
    const response = await POST(request(), params);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ warning: expect.stringContaining("could not start") });
    expect(mocks.fail).toHaveBeenCalledWith(expect.objectContaining({ runId: "new-run" }), "dispatch_failed", "executor unavailable");
  });
  it("records context-loading failures before dispatch rather than leaving an undispatchable queued run", async () => {
    mocks.context.mockRejectedValue(new Error("human authorization changed"));
    const response = await POST(request({ "x-test-user-org-id": "org-a" }), params);
    expect(response.status).toBe(202);
    expect(mocks.failUndispatched).toHaveBeenCalledWith("org-a", "issue-a", "new-run", "human authorization changed");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
