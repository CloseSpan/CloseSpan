import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveExecutorAiConfiguration,
  tenkiAgentJobSchema,
  tenkiExecutorAllowsInspectionCommand,
  tenkiExecutorAllowsPath,
} from "./tenki-coding-executor";

afterEach(() => vi.unstubAllEnvs());

const policy = {
  promptArtifactPath: ".prompt/tickets/CS-142-export.prompt.md",
  permittedPaths: ["src/**", "tests/**"],
};

describe("Tenki coding executor approval boundary", () => {
  it("uses an explicit OpenAI credential without leaking provider state", () => {
    expect(resolveExecutorAiConfiguration({
      openAiApiKey: "test-openai-key",
      aiModel: "test-model",
    })).toEqual({
      apiKey: "test-openai-key",
      baseUrl: undefined,
      model: "test-model",
      provider: "OpenAI",
    });
  });

  it("uses the configured OpenAI-compatible xAI provider when OpenAI is absent", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("XAI_API_KEY", "test-xai-key");
    vi.stubEnv("XAI_MODEL", "grok-test");
    vi.stubEnv("XAI_BASE_URL", "https://api.x.ai/v1/");
    expect(resolveExecutorAiConfiguration()).toEqual({
      apiKey: "test-xai-key",
      baseUrl: "https://api.x.ai/v1",
      model: "grok-test",
      provider: "xAI",
    });
  });

  it("rejects unsafe AI base URLs", () => {
    expect(() => resolveExecutorAiConfiguration({
      openAiApiKey: "test-openai-key",
      aiBaseUrl: "http://localhost:3000/v1",
    })).toThrow("credential-free HTTPS");
  });

  it("allows approved code and test paths while protecting prompts and workflows", () => {
    expect(tenkiExecutorAllowsPath(policy, "src/export.ts")).toBe(true);
    expect(tenkiExecutorAllowsPath(policy, "tests/export.test.ts")).toBe(true);
    expect(tenkiExecutorAllowsPath(policy, policy.promptArtifactPath)).toBe(false);
    expect(tenkiExecutorAllowsPath(policy, ".github/workflows/deploy.yml")).toBe(false);
    expect(tenkiExecutorAllowsPath(policy, "../outside.ts")).toBe(false);
    expect(tenkiExecutorAllowsPath(policy, "/etc/passwd")).toBe(false);
  });

  it("prevents the coding agent from editing a PDD-generated acceptance test", () => {
    expect(tenkiExecutorAllowsPath({
      ...policy,
      generatedTests: [{
        path: "tests/export.pdd.test.ts",
        content: "test('contract', () => {})",
        contentHash: "a".repeat(64),
        command: "npm test",
      }],
    }, "tests/export.pdd.test.ts")).toBe(false);
  });

  it("allows bounded repository inspection and rejects command composition or network tools", () => {
    expect(tenkiExecutorAllowsInspectionCommand("git status --short")).toBe(true);
    expect(tenkiExecutorAllowsInspectionCommand("rg -n export src")).toBe(true);
    expect(tenkiExecutorAllowsInspectionCommand("curl https://example.com")).toBe(false);
    expect(tenkiExecutorAllowsInspectionCommand("git status && rm -rf .")).toBe(false);
    expect(tenkiExecutorAllowsInspectionCommand("cat /etc/passwd")).toBe(false);
  });

  it("requires an immutable approval-bound job payload", () => {
    const result = tenkiAgentJobSchema.safeParse({
      schemaVersion: 1,
      orgId: "org-1",
      runId: "11111111-1111-4111-8111-111111111111",
      repository: "owner/repo",
      baseSha: "a".repeat(40),
      promptHash: "b".repeat(64),
      promptContent: "approved prompt",
      promptArtifactPath: policy.promptArtifactPath,
      repositoryArchiveUrl: "https://example.com/repository.tar.gz",
      requiredCommands: ["npm test"],
      permittedPaths: policy.permittedPaths,
      acceptanceCriteria: [{ id: "AC-1", scenarioIds: ["TEST-1"] }],
      testScenarios: [{ id: "TEST-1", testLevel: "integration", criterionIds: ["AC-1"] }],
      callbackUrl: "https://www.closespan.com/api/internal/agent-runs/11111111-1111-4111-8111-111111111111",
      expiresAt: "2026-07-30T08:00:00.000Z",
      capabilities: ["repository:read", "repository:write", "tests:execute", "pull_requests:write:draft"],
    });
    expect(result.success).toBe(true);
  });
});
