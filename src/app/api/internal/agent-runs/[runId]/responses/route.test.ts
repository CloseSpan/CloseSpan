import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueAgentRunnerModelToken } from "@/lib/agent-runner-model-token";

const dependencies = vi.hoisted(() => ({
  context: vi.fn(),
  configuration: vi.fn(),
}));

vi.mock("@/lib/engineering-workflow-repository", () => ({
  getAgentRunExecutionContext: dependencies.context,
}));
vi.mock("@/lib/ai-config", () => ({
  getAiRuntimeConfiguration: dependencies.configuration,
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

const runId = "11111111-1111-4111-8111-111111111111";
const binding = {
  runId,
  orgId: "org-1",
  repository: "owner/repo",
  promptHash: "a".repeat(64),
  executionProfileHash: "b".repeat(64),
  provider: "openai" as const,
  model: "gpt-5.6-sol",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("approval-bound runner Responses proxy", () => {
  beforeEach(() => {
    vi.stubEnv("AGENT_EXECUTOR_SHARED_SECRET", "s".repeat(64));
    vi.stubEnv("AGENT_RUNNER_MAX_OUTPUT_TOKENS", "12000");
    dependencies.context.mockReset().mockResolvedValue({
      orgId: binding.orgId,
      repository: binding.repository,
      promptHash: binding.promptHash,
      executionProfileHash: binding.executionProfileHash,
    });
    dependencies.configuration.mockReset().mockResolvedValue({
      provider: "openai",
      model: binding.model,
      configured: true,
      apiKey: "server-openai-key",
      baseUrl: "https://api.openai.com/v1/",
      timeoutMs: 120_000,
    });
  });

  it("uses the server key upstream while enforcing the signed model and output ceiling", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ id: "resp_1", output: [] }),
      { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_1" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const issued = await issueAgentRunnerModelToken(binding);

    const response = await POST(
      new NextRequest(`https://app.closespan.com/api/internal/agent-runs/${runId}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${issued.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "attacker-selected-model",
          input: "Implement the approved prompt",
          store: true,
          background: true,
          max_output_tokens: 50_000,
        }),
      }),
      { params: Promise.resolve({ runId }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: "resp_1" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.headers).toMatchObject({ authorization: "Bearer server-openai-key" });
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: binding.model,
      store: false,
      background: false,
      max_output_tokens: 12_000,
    });
  });

  it("rejects a token bound to a different run before calling OpenAI", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const issued = await issueAgentRunnerModelToken({ ...binding, runId: "different-run" });

    const response = await POST(
      new NextRequest(`https://app.closespan.com/api/internal/agent-runs/${runId}/responses`, {
        method: "POST",
        headers: { authorization: `Bearer ${issued.token}`, "content-type": "application/json" },
        body: JSON.stringify({ input: "test" }),
      }),
      { params: Promise.resolve({ runId }) },
    );

    expect(response.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
