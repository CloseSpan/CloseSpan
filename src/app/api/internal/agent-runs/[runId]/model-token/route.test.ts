import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upgradeExecutionProfileConfigV2 } from "@/lib/execution-profile";
import { verifyAgentRunnerModelToken } from "@/lib/agent-runner-model-token";

const dependencies = vi.hoisted(() => ({
  context: vi.fn(),
  configuration: vi.fn(),
  verifyOidc: vi.fn(),
  assertIdentity: vi.fn(),
}));

vi.mock("@/lib/engineering-workflow-repository", () => ({
  getAgentRunExecutionContext: dependencies.context,
}));
vi.mock("@/lib/ai-config", () => ({
  getAiRuntimeConfiguration: dependencies.configuration,
}));
vi.mock("@/lib/github-actions-oidc", () => ({
  verifyGithubActionsOidcToken: dependencies.verifyOidc,
  assertGithubActionsRunIdentity: dependencies.assertIdentity,
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

const runId = "11111111-1111-4111-8111-111111111111";

function executionContext() {
  return {
    orgId: "org-1",
    runId,
    repository: "owner/repo",
    baseSha: "d".repeat(40),
    promptHash: "a".repeat(64),
    executionProfileHash: "b".repeat(64),
    executionProfileSnapshot: {
      config: {
        ...upgradeExecutionProfileConfigV2({ schemaVersion: 1 }),
        schemaVersion: 3,
        executor: {
          kind: "tenki_github_actions",
          platform: "linux",
          architecture: "x64",
          runnerLabel: "tenki-standard-large-8c-16g",
          workflowPath: ".github/workflows/closespan-agent-runner.yml",
          workflowSha256: "c".repeat(64),
          xcode: null,
          androidEmulator: null,
        },
      },
    },
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("runner model-token exchange", () => {
  beforeEach(() => {
    dependencies.context.mockReset().mockResolvedValue(executionContext());
    dependencies.configuration.mockReset().mockResolvedValue({
      provider: "openai",
      providerLabel: "OpenAI",
      model: "gpt-5.6-sol",
      configured: true,
      credentialStored: false,
      vaultConfigured: true,
      keyHint: "Environment secret",
      keySource: "environment",
      connectionStatus: "Environment",
      updatedAt: null,
      apiKey: "server-openai-key",
      baseUrl: "https://api.openai.com/v1",
      timeoutMs: 120_000,
      maxOutputTokens: 3_000,
    });
    dependencies.verifyOidc.mockReset().mockResolvedValue({ actor: "closespan[bot]" });
    dependencies.assertIdentity.mockReset();
    vi.stubEnv("AGENT_EXECUTOR_SHARED_SECRET", "s".repeat(64));
    vi.stubEnv("CLOSESPAN_INTERNAL_BASE_URL", "https://app.closespan.com/");
  });

  it("exchanges GitHub OIDC for a run-scoped credential without returning the OpenAI key", async () => {
    const response = await POST(
      new NextRequest(`https://app.closespan.com/api/internal/agent-runs/${runId}/model-token`, {
        method: "POST",
        headers: {
          authorization: "Bearer github-oidc-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ orgId: "org-1" }),
      }),
      { params: Promise.resolve({ runId }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, string>;
    expect(body).toMatchObject({
      model: "gpt-5.6-sol",
      responsesApiEndpoint: `https://app.closespan.com/api/internal/agent-runs/${runId}/responses`,
    });
    expect(JSON.stringify(body)).not.toContain("server-openai-key");
    await expect(verifyAgentRunnerModelToken(body.token)).resolves.toMatchObject({
      sub: runId,
      orgId: "org-1",
      repository: "owner/repo",
    });
    expect(dependencies.configuration).toHaveBeenCalledWith("org-1");
    expect(dependencies.assertIdentity).toHaveBeenCalledWith(expect.objectContaining({
      repository: "owner/repo",
      runId,
      workflowPath: ".github/workflows/closespan-agent-runner.yml",
      expectedSha: "d".repeat(40),
    }));
  });

  it("rejects a workspace without usable OpenAI configuration", async () => {
    dependencies.configuration.mockResolvedValue({
      provider: "openai",
      configured: false,
      apiKey: null,
    });
    const response = await POST(
      new NextRequest(`https://app.closespan.com/api/internal/agent-runs/${runId}/model-token`, {
        method: "POST",
        headers: {
          authorization: "Bearer github-oidc-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ orgId: "org-1" }),
      }),
      { params: Promise.resolve({ runId }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("OPENAI_API_KEY"),
    });
  });
});
