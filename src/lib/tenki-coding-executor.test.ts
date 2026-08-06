import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProcessRunHandle, ProcessRunResult } from "@tenkicloud/sandbox";
import {
  RestrictedShell,
  RestrictedEditor,
  assertRuntimeSecretPublicationSafe,
  assertTenkiExecutionProfileBinding,
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
    expect(tenkiSandboxCreateOptions(parsed)).toMatchObject({
      cpuCores: 4,
      memoryMb: 8192,
      allowInbound: false,
      allowOutbound: false,
      maxDurationMs: 180_000,
      idleTimeoutMinutes: 3,
      image: profileConfig.tenkiImage,
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
    };
    const editor = new RestrictedEditor(session as never, parsed);
    await editor.writeApprovedTextFile("src/export.ts", "export const ok = true;\n");
    expect(session.writeFile).toHaveBeenCalledWith(
      "/home/tenki/repo/apps/web/src/export.ts",
      expect.any(Uint8Array),
    );
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
