import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProcessRunHandle, ProcessRunResult } from "@tenkicloud/sandbox";
import {
  RestrictedShell,
  TENKI_RUNTIME_GIT_EXCLUDES,
  RestrictedEditor,
  assertRuntimeSecretPublicationSafe,
  assertTenkiExecutionProfileBinding,
  boundedAgentProgressOutput,
  executorImplementationModelSettings,
  resolveExecutorAiConfiguration,
  runtimeToolsForAgent,
  tenkiSandboxCreateOptions,
  tenkiAgentJobSchema,
  tenkiExecutorAllowsInspectionCommand,
  tenkiExecutorAllowsPath,
  tenkiRuntimeEnvironmentForProfile,
} from "./tenki-coding-executor";
import {
  hashExecutionProfileConfig,
  upgradeExecutionProfileConfigV2,
} from "./execution-profile";
import { createRuntimeSecretRedactor } from "./runtime-secret-redaction";

afterEach(() => vi.unstubAllEnvs());

describe("runtime secret publication boundary", () => {
  it("rejects transformed secret content and secret-derived paths", () => {
    const secret = "private-runtime-credential";
    const redactor = createRuntimeSecretRedactor([secret]);
    expect(() => assertRuntimeSecretPublicationSafe(
      `artifacts/${Buffer.from(secret).toString("hex")}.txt`,
      "safe content",
      redactor,
    )).toThrow("path derived from a resolved runtime secret");
    expect(() => assertRuntimeSecretPublicationSafe(
      "artifacts/result.txt",
      Buffer.from(secret).toString("hex"),
      redactor,
    )).toThrow("resolved runtime secret or encoded secret");
    expect(() => assertRuntimeSecretPublicationSafe(
      "artifacts/result.txt",
      "safe content",
      redactor,
    )).not.toThrow();
  });
});

function hostRunHandle(overrides: Partial<ProcessRunResult> = {}): ProcessRunHandle {
  const completion = Promise.resolve<ProcessRunResult>({
    exitCode: 0,
    stdout: new Uint8Array(),
    stderr: new Uint8Array(),
    ...overrides,
  });
  return {
    pid: Promise.resolve(1),
    stdout: new ReadableStream<Uint8Array>(),
    stderr: new ReadableStream<Uint8Array>(),
    stdin: new WritableStream<Uint8Array>(),
    signal: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined),
    then: completion.then.bind(completion),
  };
}

const policy = {
  promptArtifactPath: ".prompt/tickets/CS-142-export.prompt.md",
  permittedPaths: ["src/**", "tests/**"],
};
const profilePolicy = ["apps/web/src/**", "apps/web/tests/**"];

const profileConfig = {
  schemaVersion: 1 as const,
  language: "typescript",
  framework: "nextjs",
  packageManager: "npm",
  runtimeVersion: "22",
  workingDirectory: "apps/web",
  installCommands: ["npm ci"],
  buildCommands: ["npm run build"],
  testCommands: ["npm test"],
  typecheckCommands: ["npm run typecheck"],
  permittedPaths: ["apps/web/**"],
  tenkiImage: "ghcr.io/closespan/node:22",
  tenkiSnapshotId: null,
  cpuCores: 4,
  memoryMb: 8192,
  allowInbound: false,
  allowOutbound: false,
  maxDurationMs: 180_000,
  idleTimeoutMinutes: 3,
};
const profileHash = hashExecutionProfileConfig(profileConfig);
const executionProfile = {
  executionProfileId: "33333333-3333-4333-8333-333333333333",
  executionProfileHash: profileHash,
  executionProfileSnapshot: {
    profileId: "33333333-3333-4333-8333-333333333333",
    version: 2,
    source: "confirmed" as const,
    repository: "owner/repo",
    workspaceRoot: "apps/web",
    contentHash: profileHash,
    config: profileConfig,
  },
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

  it("uses a dedicated bounded coding model and explicit OpenAI effort", () => {
    vi.stubEnv("AGENT_EXECUTOR_MODEL", "gpt-5.6-terra");
    vi.stubEnv("OPENAI_MODEL", "gpt-5.6-sol");
    expect(resolveExecutorAiConfiguration({
      openAiApiKey: "test-openai-key",
    }).model).toBe("gpt-5.6-terra");
    expect(executorImplementationModelSettings("OpenAI")).toEqual({
      toolChoice: "required",
      parallelToolCalls: false,
      store: false,
      reasoning: { effort: "medium" },
      text: { verbosity: "low" },
      maxTokens: 12_000,
    });
    expect(executorImplementationModelSettings("xAI")).toEqual({
      toolChoice: "required",
      parallelToolCalls: false,
      store: false,
    });
  });

  it("recovers only approved implementation progress from a bounded model loop", () => {
    const parsed = tenkiAgentJobSchema.parse({
      schemaVersion: 2,
      orgId: "org-1",
      runId: "11111111-1111-4111-8111-111111111111",
      repository: "owner/repo",
      baseSha: "a".repeat(40),
      promptHash: "b".repeat(64),
      promptContent: "approved prompt",
      promptArtifactPath: policy.promptArtifactPath,
      repositoryArchiveUrl: "https://example.com/repository.tar.gz",
      requiredCommands: ["npm test"],
      permittedPaths: profilePolicy,
      generatedTests: [{
        path: "apps/web/tests/acceptance.pdd.test.ts",
        content: "test('contract', () => {})",
        contentHash: "c".repeat(64),
        command: "npm test",
      }],
      acceptanceCriteria: [{ id: "AC-1", scenarioIds: ["TEST-1"] }],
      testScenarios: [{ id: "TEST-1", testLevel: "integration", criterionIds: ["AC-1"] }],
      callbackUrl: "https://www.closespan.com/api/internal/agent-runs/11111111-1111-4111-8111-111111111111",
      expiresAt: "2026-07-30T08:00:00.000Z",
      capabilities: ["repository:read", "repository:write", "tests:execute", "pull_requests:write:draft"],
      ...executionProfile,
    });
    expect(boundedAgentProgressOutput(parsed, [
      "apps/web/tests/acceptance.pdd.test.ts",
      "apps/web/src/export.ts",
    ], "OpenAI", "gpt-5.6-terra", 12)).toMatchObject({
      files: [{ path: "apps/web/src/export.ts" }],
      remainingRisks: [expect.stringContaining("12 tool call")],
    });
    expect(boundedAgentProgressOutput(parsed, [
      "apps/web/tests/acceptance.pdd.test.ts",
    ], "OpenAI", "gpt-5.6-terra", 12)).toBeNull();
  });

  it("keeps generated runtime dependencies and build artifacts out of publication diffs", () => {
    expect(TENKI_RUNTIME_GIT_EXCLUDES).toEqual(expect.arrayContaining([
      "node_modules/",
      ".next/",
      "dist/",
      "build/",
      ".venv/",
      "target/",
      ".closespan/",
    ]));
    expect(TENKI_RUNTIME_GIT_EXCLUDES).not.toContain("src/");
    expect(TENKI_RUNTIME_GIT_EXCLUDES).not.toContain("tests/");
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
    expect(tenkiExecutorAllowsInspectionCommand("git diff --check")).toBe(true);
    expect(tenkiExecutorAllowsInspectionCommand("find . -name AGENTS.md -print")).toBe(true);
    expect(tenkiExecutorAllowsInspectionCommand("curl https://example.com")).toBe(false);
    expect(tenkiExecutorAllowsInspectionCommand("git status && rm -rf .")).toBe(false);
    expect(tenkiExecutorAllowsInspectionCommand("pwd && ls -la")).toBe(false);
    expect(tenkiExecutorAllowsInspectionCommand("find .. -name AGENTS.md -print")).toBe(false);
    expect(tenkiExecutorAllowsInspectionCommand("cat /etc/passwd")).toBe(false);
  });

  it("requires an immutable profile-bound job payload", () => {
    const parsed = tenkiAgentJobSchema.parse({
      schemaVersion: 2,
      orgId: "org-1",
      runId: "11111111-1111-4111-8111-111111111111",
      repository: "owner/repo",
      baseSha: "a".repeat(40),
      promptHash: "b".repeat(64),
      promptContent: "approved prompt",
      promptArtifactPath: policy.promptArtifactPath,
      repositoryArchiveUrl: "https://example.com/repository.tar.gz",
      requiredCommands: ["npm test"],
      permittedPaths: profilePolicy,
      acceptanceCriteria: [{ id: "AC-1", scenarioIds: ["TEST-1"] }],
      testScenarios: [{ id: "TEST-1", testLevel: "integration", criterionIds: ["AC-1"] }],
      callbackUrl: "https://www.closespan.com/api/internal/agent-runs/11111111-1111-4111-8111-111111111111",
      expiresAt: "2026-07-30T08:00:00.000Z",
      capabilities: ["repository:read", "repository:write", "tests:execute", "pull_requests:write:draft"],
      ...executionProfile,
    });
    expect(() => assertTenkiExecutionProfileBinding(parsed)).not.toThrow();
  });

  it("rejects an unconfirmed detected profile even when its hash is valid", () => {
    const parsed = tenkiAgentJobSchema.parse({
      schemaVersion: 2,
      orgId: "org-1",
      runId: "11111111-1111-4111-8111-111111111111",
      repository: "owner/repo",
      baseSha: "a".repeat(40),
      promptHash: "b".repeat(64),
      promptContent: "approved prompt",
      promptArtifactPath: policy.promptArtifactPath,
      repositoryArchiveUrl: "https://example.com/repository.tar.gz",
      requiredCommands: ["npm test"],
      permittedPaths: profilePolicy,
      acceptanceCriteria: [{ id: "AC-1", scenarioIds: ["TEST-1"] }],
      testScenarios: [{ id: "TEST-1", testLevel: "integration", criterionIds: ["AC-1"] }],
      callbackUrl: "https://www.closespan.com/api/internal/agent-runs/11111111-1111-4111-8111-111111111111",
      expiresAt: "2026-07-30T08:00:00.000Z",
      capabilities: ["repository:read", "repository:write", "tests:execute", "pull_requests:write:draft"],
      ...executionProfile,
      executionProfileSnapshot: {
        ...executionProfile.executionProfileSnapshot,
        source: "detected",
      },
    });
    expect(() => assertTenkiExecutionProfileBinding(parsed))
      .toThrow("unconfirmed detected execution profile");
  });

  it("rejects a valid profile hash when the repository or ticket scope is broader", () => {
    const parsed = tenkiAgentJobSchema.parse({
      schemaVersion: 2,
      orgId: "org-1",
      runId: "11111111-1111-4111-8111-111111111111",
      repository: "owner/another-repo",
      baseSha: "a".repeat(40),
      promptHash: "b".repeat(64),
      promptContent: "approved prompt",
      promptArtifactPath: policy.promptArtifactPath,
      repositoryArchiveUrl: "https://example.com/repository.tar.gz",
      requiredCommands: ["npm test"],
      permittedPaths: profilePolicy,
      acceptanceCriteria: [{ id: "AC-1", scenarioIds: ["TEST-1"] }],
      testScenarios: [{ id: "TEST-1", testLevel: "integration", criterionIds: ["AC-1"] }],
      callbackUrl: "https://www.closespan.com/api/internal/agent-runs/11111111-1111-4111-8111-111111111111",
      expiresAt: "2026-07-30T08:00:00.000Z",
      capabilities: ["repository:read", "repository:write", "tests:execute", "pull_requests:write:draft"],
      ...executionProfile,
    });
    expect(() => assertTenkiExecutionProfileBinding(parsed))
      .toThrow("another repository");
    expect(() => assertTenkiExecutionProfileBinding({
      ...parsed,
      repository: "owner/repo",
      permittedPaths: ["apps/**"],
    })).toThrow("broader than the execution profile");
  });

  it("rejects profile hash drift and applies the bound Tenki resources", () => {
    const parsed = tenkiAgentJobSchema.parse({
      schemaVersion: 2,
      orgId: "org-1",
      runId: "11111111-1111-4111-8111-111111111111",
      repository: "owner/repo",
      baseSha: "a".repeat(40),
      promptHash: "b".repeat(64),
      promptContent: "approved prompt",
      promptArtifactPath: policy.promptArtifactPath,
      repositoryArchiveUrl: "https://example.com/repository.tar.gz",
      requiredCommands: ["npm test"],
      permittedPaths: profilePolicy,
      acceptanceCriteria: [{ id: "AC-1", scenarioIds: ["TEST-1"] }],
      testScenarios: [{ id: "TEST-1", testLevel: "integration", criterionIds: ["AC-1"] }],
      callbackUrl: "https://www.closespan.com/api/internal/agent-runs/11111111-1111-4111-8111-111111111111",
      expiresAt: "2026-07-30T08:00:00.000Z",
      capabilities: ["repository:read", "repository:write", "tests:execute", "pull_requests:write:draft"],
      ...executionProfile,
    });
    expect(tenkiSandboxCreateOptions(parsed, {
      registryDigestRef: profileConfig.tenkiImage,
      registryImageId: "image-1",
      workspaceId: "workspace-1",
      snapshotId: "11111111-1111-4111-8111-111111111111",
    })).toMatchObject({
      cpuCores: 4,
      memoryMb: 8192,
      allowInbound: false,
      allowOutbound: false,
      maxDurationMs: 180_000,
      idleTimeoutMinutes: 3,
      image: profileConfig.tenkiImage,
      workspaceId: "workspace-1",
    });
    if (parsed.schemaVersion !== 2) throw new Error("Expected a profile-bound job");
    expect(() => assertTenkiExecutionProfileBinding({
      ...parsed,
      executionProfileHash: "f".repeat(64),
    })).toThrow("immutable content hash");
  });

  it("honors the model-requested bounded shell output length", async () => {
    const run = vi.fn(() => hostRunHandle({
      stdout: new TextEncoder().encode("ok"),
    }));
    const shell = new RestrictedShell(
      { run } as never,
      { requiredCommands: ["npm test"] } as never,
    );
    const result = await shell.run({ commands: ["npm test"], maxOutputLength: 30_000 });
    expect(result.maxOutputLength).toBe(30_000);
    expect(result.output[0]?.stdout).toBe("ok");
  });

  it("injects test secrets only into approved validation commands and redacts their output", async () => {
    const run = vi.fn((argv: string[], options?: { env?: Record<string, string> }) => {
      void argv;
      void options;
      return hostRunHandle({
        stdout: new TextEncoder().encode("credential=test-secret-value"),
      });
    });
    const shell = new RestrictedShell(
      { run } as never,
      { requiredCommands: ["npm test"] } as never,
      {
        testEnvironment: { TEST_TOKEN: "test-secret-value" },
        redactionValues: ["test-secret-value"],
      },
    );

    const result = await shell.run({ commands: ["npm test"] });

    expect(run.mock.calls[0]?.[0]?.slice(-3)).toEqual(["bash", "-c", "npm test"]);
    expect(run.mock.calls[0]?.[1]).toMatchObject({
      env: { CI: "true", TEST_TOKEN: "test-secret-value" },
    });
    expect(result.output[0]?.stdout).toBe("credential=[REDACTED_RUNTIME_SECRET]");
    expect(shell.results[0]?.stdout).not.toContain("test-secret-value");
  });

  it("resolves editor paths from a monorepo working directory without widening scope", async () => {
    const parsed = tenkiAgentJobSchema.parse({
      schemaVersion: 2,
      orgId: "org-1",
      runId: "11111111-1111-4111-8111-111111111111",
      repository: "owner/repo",
      baseSha: "a".repeat(40),
      promptHash: "b".repeat(64),
      promptContent: "approved prompt",
      promptArtifactPath: policy.promptArtifactPath,
      repositoryArchiveUrl: "https://example.com/repository.tar.gz",
      requiredCommands: ["npm test"],
      permittedPaths: profilePolicy,
      acceptanceCriteria: [{ id: "AC-1", scenarioIds: ["TEST-1"] }],
      testScenarios: [{ id: "TEST-1", testLevel: "integration", criterionIds: ["AC-1"] }],
      callbackUrl: "https://www.closespan.com/api/internal/agent-runs/11111111-1111-4111-8111-111111111111",
      expiresAt: "2026-07-30T08:00:00.000Z",
      capabilities: ["repository:read", "repository:write", "tests:execute", "pull_requests:write:draft"],
      ...executionProfile,
    });
    const session = {
      exec: vi.fn().mockResolvedValue({ status: "SUCCEEDED", exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() }),
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn()
        .mockRejectedValueOnce(new Error("not found"))
        .mockResolvedValue(new TextEncoder().encode("export const ok = true;\n")),
    };
    const editor = new RestrictedEditor(session as never, parsed);
    await editor.writeApprovedTextFile("src/export.ts", "export const ok = true;\n");
    expect(editor.approvedMutationCount).toBe(1);
    expect(session.writeFile).toHaveBeenCalledWith(
      "/home/tenki/repo/apps/web/src/export.ts",
      expect.any(Uint8Array),
    );
    await editor.writeApprovedTextFile("src/export.ts", "export const ok = true;\n");
    expect(editor.approvedMutationCount).toBe(1);
    expect(session.writeFile).toHaveBeenCalledTimes(1);
    await expect(editor.writeApprovedTextFile("../outside.ts", "nope\n"))
      .rejects.toThrow("outside the approved paths");
  });

  it("rejects unbounded model-requested shell output", async () => {
    const shell = new RestrictedShell({ run: vi.fn() } as never, { requiredCommands: ["npm test"] } as never);
    await expect(shell.run({ commands: ["npm test"], maxOutputLength: 30_001 }))
      .rejects.toThrow("Shell output limit must be between 0 and 30000");
  });

  it("injects only the immutable secret bindings assigned to each execution phase", () => {
    const runtimeProfile = {
      ...upgradeExecutionProfileConfigV2(profileConfig),
      publicEnvironment: [{ name: "PUBLIC_MODE", value: "test" }],
      applicationPort: 3000,
      secretBindings: [
        { envName: "INSTALL_TOKEN", secretId: "11111111-1111-4111-8111-111111111111", secretVersion: 1, exposure: "setup" as const },
        { envName: "APP_TOKEN", secretId: "22222222-2222-4222-8222-222222222222", secretVersion: 2, exposure: "runtime" as const },
        { envName: "TEST_TOKEN", secretId: "33333333-3333-4333-8333-333333333333", secretVersion: 3, exposure: "test" as const },
      ],
    };
    expect(tenkiRuntimeEnvironmentForProfile(runtimeProfile, {
      setup: { INSTALL_TOKEN: "install-secret" },
      runtime: { APP_TOKEN: "app-secret" },
      test: { TEST_TOKEN: "test-secret" },
      redactionValues: ["install-secret", "app-secret", "test-secret"],
    })).toMatchObject({
      setup: { PUBLIC_MODE: "test", INSTALL_TOKEN: "install-secret", CI: "true" },
      runtime: { PUBLIC_MODE: "test", APP_TOKEN: "app-secret", PORT: "3000" },
      test: {
        PUBLIC_MODE: "test",
        TEST_TOKEN: "test-secret",
        CI: "true",
        CLOSESPAN_APP_URL: "http://127.0.0.1:3000",
      },
    });
    expect(() => tenkiRuntimeEnvironmentForProfile(runtimeProfile, {
      setup: { INSTALL_TOKEN: "install-secret" },
      runtime: { APP_TOKEN: "app-secret", EXTRA_TOKEN: "not-approved" },
      test: { TEST_TOKEN: "test-secret" },
      redactionValues: [],
    })).toThrow("exact runtime secret bindings");
  });

  it("withholds health-dependent tools after baseline runtime startup fails", () => {
    const configured = { http: true, browser: true, logs: true };

    expect(runtimeToolsForAgent(configured, false)).toEqual({
      http: false,
      browser: false,
      logs: true,
    });
    expect(runtimeToolsForAgent(configured, true)).toBe(configured);
  });
});
