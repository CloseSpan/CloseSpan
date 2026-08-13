import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateWorkspacePrompt } from "./workspace-prompt-evaluation";
import { getAiRuntimeConfiguration } from "./ai-config";
import { evaluatePromptWithPdd } from "./pdd-runner-client";
import { readPromptEvaluationMode } from "./workspace-settings-repository";

vi.mock("./ai-config", () => ({
  getAiRuntimeConfiguration: vi.fn(),
}));
vi.mock("./pdd-runner-client", () => ({
  evaluatePromptWithPdd: vi.fn(),
}));
vi.mock("./workspace-settings-repository", () => ({
  readPromptEvaluationMode: vi.fn(),
}));

const input = {
  orgId: "org-1",
  promptHash: "a".repeat(64),
  userStory: "As a user, I want reliable context, so that the workflow completes.",
  implementationPrompt: "Correct and verify the context workflow.",
  pddVersion: "0.0.309",
  acceptanceContract: "## Context\nStable contract",
};

const result = {
  schemaVersion: 1 as const,
  requestId: "66666666-6666-4666-8666-666666666666",
  promptHash: input.promptHash,
  verdict: "Passed" as const,
  changes: [],
  pddVersion: "0.0.309",
  executionMode: "local" as const,
  model: "openai/gpt-5.6-sol",
  costUsd: 0.01,
};

describe("evaluateWorkspacePrompt", () => {
  afterEach(() => vi.clearAllMocks());

  it("keeps workspace credentials out of Prompt Testing Cloud", async () => {
    vi.mocked(readPromptEvaluationMode).mockResolvedValue("pdd_cloud");
    vi.mocked(evaluatePromptWithPdd).mockResolvedValue({
      ...result,
      executionMode: "cloud",
      model: "pdd-cloud",
    });

    await evaluateWorkspacePrompt(input);

    expect(getAiRuntimeConfiguration).not.toHaveBeenCalled();
    expect(evaluatePromptWithPdd).toHaveBeenCalledWith(expect.objectContaining({
      evaluationMode: "pdd_cloud",
      localRuntime: undefined,
    }));
  });

  it("binds local Prompt Testing to the workspace provider and model", async () => {
    vi.mocked(readPromptEvaluationMode).mockResolvedValue("pdd_local");
    vi.mocked(getAiRuntimeConfiguration).mockResolvedValue({
      provider: "openai",
      providerLabel: "OpenAI",
      model: "gpt-5.6-sol",
      apiKey: "workspace-openai-secret",
      baseUrl: "https://api.openai.com/v1",
      configured: true,
      credentialStored: true,
      vaultConfigured: true,
      keyHint: "…cret",
      keySource: "database",
      connectionStatus: "Connected",
      updatedAt: null,
      timeoutMs: 120_000,
      maxOutputTokens: 3_000,
    });
    vi.mocked(evaluatePromptWithPdd).mockResolvedValue(result);

    await evaluateWorkspacePrompt(input);

    expect(evaluatePromptWithPdd).toHaveBeenCalledWith(expect.objectContaining({
      evaluationMode: "pdd_local",
      acceptanceContract: input.acceptanceContract,
      localRuntime: {
        provider: "openai",
        model: "gpt-5.6-sol",
        apiKey: "workspace-openai-secret",
      },
    }));
  });

  it("references the runner secret instead of serializing an environment key", async () => {
    vi.mocked(readPromptEvaluationMode).mockResolvedValue("pdd_local");
    vi.mocked(getAiRuntimeConfiguration).mockResolvedValue({
      provider: "openai",
      providerLabel: "OpenAI",
      model: "gpt-5.6-sol",
      apiKey: "environment-openai-secret",
      baseUrl: "https://api.openai.com/v1",
      configured: true,
      credentialStored: false,
      vaultConfigured: true,
      keyHint: "Environment secret",
      keySource: "environment",
      connectionStatus: "Environment",
      updatedAt: null,
      timeoutMs: 120_000,
      maxOutputTokens: 3_000,
    });
    vi.mocked(evaluatePromptWithPdd).mockResolvedValue(result);

    await evaluateWorkspacePrompt(input);

    expect(evaluatePromptWithPdd).toHaveBeenCalledWith(expect.objectContaining({
      evaluationMode: "pdd_local",
      localRuntime: {
        provider: "openai",
        model: "gpt-5.6-sol",
        credentialSource: "runner",
      },
    }));
    expect(evaluatePromptWithPdd).not.toHaveBeenCalledWith(expect.objectContaining({
      localRuntime: expect.objectContaining({ apiKey: expect.any(String) }),
    }));
  });

  it("fails before dispatch when local mode has no workspace credential", async () => {
    vi.mocked(readPromptEvaluationMode).mockResolvedValue("pdd_local");
    vi.mocked(getAiRuntimeConfiguration).mockResolvedValue({
      provider: "openai",
      providerLabel: "OpenAI",
      model: "gpt-5.6-sol",
      apiKey: null,
      baseUrl: "https://api.openai.com/v1",
      configured: false,
      credentialStored: false,
      vaultConfigured: true,
      keyHint: null,
      keySource: "none",
      connectionStatus: "Not configured",
      updatedAt: null,
      timeoutMs: 120_000,
      maxOutputTokens: 3_000,
    });

    await expect(evaluateWorkspacePrompt(input)).rejects.toThrow(
      "Configure an AI provider",
    );
    expect(evaluatePromptWithPdd).not.toHaveBeenCalled();
  });
});
