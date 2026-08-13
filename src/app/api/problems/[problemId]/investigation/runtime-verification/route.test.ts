import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const runtime = vi.hoisted(() => ({
  context: vi.fn(),
  dispatch: vi.fn(),
  fail: vi.fn(),
  hash: vi.fn(),
  latest: vi.fn(),
  reconcile: vi.fn(),
  start: vi.fn(),
}));

vi.mock("@/lib/issue-runtime-verification-executor", () => ({
  dispatchIssueRuntimeVerification: runtime.dispatch,
  runtimeVerifierWorkflowHash: runtime.hash,
}));
vi.mock("@/lib/issue-runtime-verification", () => ({
  failIssueRuntimeVerification: runtime.fail,
  getIssueRuntimeVerificationContext: runtime.context,
  latestIssueRuntimeVerification: runtime.latest,
  reconcileIssueRuntimeVerificationFromGithub: runtime.reconcile,
  startIssueRuntimeVerification: runtime.start,
}));

import { GET, POST } from "./route";

const problemId = "problem-1";
const run = {
  orgId: "org-1",
  problemId,
  runId: "11111111-1111-4111-8111-111111111111",
};

function request() {
  return new NextRequest(
    `http://localhost/api/problems/${problemId}/investigation/runtime-verification`,
    {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "idempotency-key": "runtime_verification_test",
        "x-request-id": "runtime-verification-test",
        "x-test-auth": "user",
        "x-test-user-org-id": "org-1",
        "x-test-user-role": "Admin",
      },
    },
  );
}

describe("Product Problem runtime verification API", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.stubEnv("CLOSESPAN_INTERNAL_BASE_URL", "https://app.closespan.com/");
    runtime.hash.mockReset().mockResolvedValue("a".repeat(64));
    runtime.start.mockReset().mockResolvedValue(run);
    runtime.dispatch.mockReset().mockResolvedValue(undefined);
    runtime.fail.mockReset().mockResolvedValue(undefined);
    runtime.context.mockReset().mockResolvedValue({ orgId: "org-1", runId: run.runId });
    runtime.reconcile.mockReset().mockResolvedValue(undefined);
    runtime.latest.mockReset().mockResolvedValue({ id: run.runId, status: "Queued" });
  });

  it("reconciles an active verification with GitHub before returning status", async () => {
    runtime.latest
      .mockResolvedValueOnce({ id: run.runId, status: "Queued" })
      .mockResolvedValueOnce({ id: run.runId, status: "Failed", workflowRunId: 123 });
    const response = await GET(request(), {
      params: Promise.resolve({ problemId }),
    });
    expect(response.status).toBe(200);
    expect(runtime.context).toHaveBeenCalledWith("org-1", run.runId);
    expect(runtime.reconcile).toHaveBeenCalledWith(
      { orgId: "org-1", runId: run.runId },
      { id: run.runId, status: "Queued" },
    );
    await expect(response.json()).resolves.toMatchObject({
      run: { id: run.runId, status: "Failed", workflowRunId: 123 },
    });
  });

  it("pins, persists, and dispatches the verification before returning progress", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ problemId }),
    });
    expect(response.status).toBe(202);
    expect(runtime.start).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      problemId,
      workflowHash: "a".repeat(64),
    }));
    expect(runtime.dispatch).toHaveBeenCalledWith(run, "https://app.closespan.com");
    await expect(response.json()).resolves.toMatchObject({
      run: { id: run.runId, status: "Queued" },
    });
  });

  it("records a blocked outcome when GitHub dispatch fails", async () => {
    runtime.dispatch.mockRejectedValue(new Error("reviewed runtime workflow is missing"));
    const response = await POST(request(), {
      params: Promise.resolve({ problemId }),
    });
    expect(response.status).toBe(409);
    expect(runtime.fail).toHaveBeenCalledWith(
      "org-1",
      run.runId,
      "reviewed runtime workflow is missing",
    );
  });
});
