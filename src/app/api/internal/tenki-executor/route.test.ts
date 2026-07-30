import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workflow = vi.hoisted(() => ({
  claim: vi.fn(),
  context: vi.fn(),
}));
const executor = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock("@/lib/engineering-workflow-repository", () => ({
  claimQueuedAgentRun: workflow.claim,
  getAgentRunExecutionContext: workflow.context,
}));

vi.mock("@/lib/tenki-coding-executor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenki-coding-executor")>();
  return { ...actual, executeTenkiCodingJob: executor.run };
});

import { NextRequest } from "next/server";
import { POST } from "./route";

const secret = "tenki-executor-test-secret";
const runId = "11111111-1111-4111-8111-111111111111";
const callbackUrl = `https://www.closespan.com/api/internal/agent-runs/${runId}`;
const job = {
  schemaVersion: 1,
  orgId: "org-1",
  runId,
  repository: "owner/repo",
  baseSha: "a".repeat(40),
  promptHash: "b".repeat(64),
  promptContent: "approved prompt",
  promptArtifactPath: ".prompt/tickets/CS-142-export.prompt.md",
  repositoryArchiveUrl: "https://example.com/repository.tar.gz",
  requiredCommands: ["npm test"],
  permittedPaths: ["src/**", "tests/**"],
  acceptanceCriteria: [{ id: "AC-1", scenarioIds: ["TEST-1"] }],
  testScenarios: [{ id: "TEST-1", testLevel: "integration", criterionIds: ["AC-1"] }],
  callbackUrl,
  expiresAt: "2099-07-30T08:00:00.000Z",
  capabilities: ["repository:read", "repository:write", "tests:execute", "pull_requests:write:draft"],
};
const context = {
  orgId: job.orgId,
  runId: job.runId,
  repository: job.repository,
  baseSha: job.baseSha,
  promptHash: job.promptHash,
  promptContent: job.promptContent,
  promptArtifactPath: job.promptArtifactPath,
  expiresAt: job.expiresAt,
  allowedCapabilities: job.capabilities,
  promptSnapshot: { ticket: { requiredCommands: job.requiredCommands, permittedPaths: job.permittedPaths } },
};

function request(signature = createHmac("sha256", secret).update(JSON.stringify(job)).digest("hex")) {
  return new NextRequest("http://localhost/api/internal/tenki-executor", {
    method: "POST",
    headers: { "content-type": "application/json", "x-closespan-signature": signature },
    body: JSON.stringify(job),
  });
}

describe("Tenki executor internal boundary", () => {
  beforeEach(() => {
    vi.stubEnv("AGENT_EXECUTOR_SHARED_SECRET", secret);
    workflow.context.mockReset().mockResolvedValue(context);
    workflow.claim.mockReset().mockResolvedValue("claimed");
    executor.run.mockReset().mockImplementation(async (_job, events) => {
      await events.started("tenki-session-1");
      return { schemaVersion: 1, status: "Tests passed" };
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  });

  it("claims one queued run and reports Tenki start and completion callbacks", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(workflow.claim).toHaveBeenCalledWith(job.orgId, job.runId);
    expect(executor.run).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2);
    const started = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    const completed = JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body));
    expect(started).toMatchObject({ event: "started", sandboxId: "tenki-session-1", provider: "Tenki Sandbox" });
    expect(completed).toMatchObject({ event: "completed", report: { status: "Tests passed" } });
  });

  it("rejects unsigned jobs before reading workflow state", async () => {
    const response = await POST(request("0".repeat(64)));
    expect(response.status).toBe(401);
    expect(workflow.context).not.toHaveBeenCalled();
  });

  it("acknowledges duplicate queue delivery without starting another session", async () => {
    workflow.claim.mockResolvedValue("terminal");
    const response = await POST(request());
    await expect(response.json()).resolves.toMatchObject({ duplicate: true });
    expect(executor.run).not.toHaveBeenCalled();
  });

  it("asks the queue to retry while the original delivery is still active", async () => {
    workflow.claim.mockResolvedValue("active");
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(executor.run).not.toHaveBeenCalled();
  });
});
