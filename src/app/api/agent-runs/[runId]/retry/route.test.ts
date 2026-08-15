import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const repository = vi.hoisted(() => ({
  prepareRetry: vi.fn(),
  approveRun: vi.fn(),
  executionContext: vi.fn(),
  failRun: vi.fn(),
  rejectApproval: vi.fn(),
}));
const executor = vi.hoisted(() => ({
  assertConfigured: vi.fn(),
  dispatch: vi.fn(),
  failureCode: vi.fn(),
}));

vi.mock("@/lib/engineering-workflow-repository", () => ({
  prepareImplementationRunRetry: repository.prepareRetry,
  approveImplementationRun: repository.approveRun,
  getAgentRunExecutionContext: repository.executionContext,
  failAgentRun: repository.failRun,
  rejectImplementationApproval: repository.rejectApproval,
}));
vi.mock("@/lib/agent-executor-client", () => ({
  assertAgentExecutorConfigured: executor.assertConfigured,
  dispatchAgentRun: executor.dispatch,
  agentRunDispatchFailureCode: executor.failureCode,
}));

import { POST } from "./route";

const runId = "11111111-1111-4111-8111-111111111111";
const retryRunId = "22222222-2222-4222-8222-222222222222";
const context = { params: Promise.resolve({ runId }) };

function request(role = "Admin") {
  return new NextRequest(`http://localhost/api/agent-runs/${runId}/retry`, {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "idempotency-key": `retry_${crypto.randomUUID().replaceAll("-", "")}`,
      "x-test-auth": "user",
      "x-test-user-org-id": "org-1",
      "x-test-user-role": role,
    },
  });
}

describe("agent run direct retry API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repository.prepareRetry.mockResolvedValue({
      approval: { id: "approval-2", status: "Pending" },
    });
    repository.approveRun.mockResolvedValue({
      run: { id: retryRunId, status: "Queued" },
    });
    repository.executionContext.mockResolvedValue({ runId: retryRunId });
    repository.failRun.mockResolvedValue(undefined);
    repository.rejectApproval.mockResolvedValue(undefined);
    executor.dispatch.mockResolvedValue(undefined);
    executor.failureCode.mockReturnValue("dispatch_failed");
  });

  it("creates a fresh authorization and dispatches a new run", async () => {
    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    expect(repository.prepareRetry).toHaveBeenCalledWith(
      "org-1",
      runId,
      expect.objectContaining({ role: "Admin" }),
    );
    expect(repository.approveRun).toHaveBeenCalledWith(
      "org-1",
      "approval-2",
      expect.objectContaining({ role: "Admin" }),
    );
    expect(executor.dispatch).toHaveBeenCalledWith({ runId: retryRunId });
    await expect(response.json()).resolves.toMatchObject({
      workflow: { run: { id: retryRunId, status: "Queued" } },
    });
  });

  it("rejects contributors before creating a retry authorization", async () => {
    const response = await POST(request("Contributor"), context);

    expect(response.status).toBe(403);
    expect(repository.prepareRetry).not.toHaveBeenCalled();
  });

  it("releases the fresh authorization if approval cannot start the run", async () => {
    repository.approveRun.mockRejectedValueOnce(
      new Error("The selected execution profile is no longer active"),
    );

    const response = await POST(request(), context);

    expect(response.status).toBe(409);
    expect(repository.rejectApproval).toHaveBeenCalledWith(
      "org-1",
      "approval-2",
      expect.objectContaining({ role: "Admin" }),
    );
    expect(executor.dispatch).not.toHaveBeenCalled();
  });
});
