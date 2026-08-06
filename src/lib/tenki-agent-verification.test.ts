import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ExecResult,
  ProcessRunHandle,
  ProcessRunResult,
} from "@tenkicloud/sandbox";
import type { AgentImplementationReport } from "./agent-run-verification";
import type { AgentRunExecutionContext } from "./engineering-workflow-repository";
import {
  verifyAgentRunWithTenki,
} from "./tenki-agent-verification";
import {
  TENKI_BROWSER_PREFLIGHT_COMMAND,
  hashExecutionProfileConfig,
  type ExecutionProfileConfigV2,
} from "./execution-profile";

function execution(
  command: string,
  overrides: Partial<ExecResult> = {},
): ExecResult {
  return {
    sessionId: "tenki-session-1",
    command,
    args: [],
    status: "SUCCEEDED",
    exitCode: 0,
    durationMs: 25,
    outputs: [],
    stdout: new Uint8Array(),
    stderr: new Uint8Array(),
    ...overrides,
  };
}

function runHandle(
  value: ProcessRunResult,
  pending = false,
): ProcessRunHandle {
  let finish!: (result: ProcessRunResult) => void;
  const completion = pending
    ? new Promise<ProcessRunResult>((resolve) => { finish = resolve; })
    : Promise.resolve(value);
  return {
    pid: Promise.resolve(42),
    stdout: new ReadableStream<Uint8Array>(),
    stderr: new ReadableStream<Uint8Array>(),
    stdin: new WritableStream<Uint8Array>(),
    signal: vi.fn(async () => {
      if (pending) finish({ ...value, exitCode: 143, signal: "TERM" });
    }),
    kill: vi.fn(async () => {
      if (pending) finish({ ...value, exitCode: 137, signal: "KILL" });
    }),
    then: completion.then.bind(completion),
  };
}

function originalCommandArgv(argv: string[]): string[] {
  return argv[3] === "tenki-host-command-supervisor"
    ? argv.slice(5)
    : argv;
}

const profileConfig = {
  schemaVersion: 1 as const,
  language: "typescript",
  framework: "nextjs",
  packageManager: "npm",
  runtimeVersion: "22",
  workingDirectory: "packages/app",
  installCommands: ["npm ci"],
  buildCommands: ["npm run build"],
  testCommands: ["npm test"],
  typecheckCommands: ["npm run typecheck"],
  permittedPaths: ["packages/app/**"],
  tenkiImage: null,
  tenkiSnapshotId: "snapshot-profile-1",
  cpuCores: 4,
  memoryMb: 8192,
  allowInbound: false,
  allowOutbound: false,
  maxDurationMs: 120_000,
  idleTimeoutMinutes: 4,
};
const profileHash = hashExecutionProfileConfig(profileConfig);

const runtimeProfileConfig: ExecutionProfileConfigV2 = {
  ...profileConfig,
  schemaVersion: 2,
  installCommands: [
    ...profileConfig.installCommands,
    TENKI_BROWSER_PREFLIGHT_COMMAND,
  ],
  testCommands: ["npm test", "npm run pdd:live"],
  automaticInstall: true,
  automaticBuild: true,
  publicEnvironment: [{ name: "PUBLIC_MODE", value: "verification" }],
  secretBindings: [
    {
      envName: "INSTALL_TOKEN",
      secretId: "44444444-4444-4444-8444-444444444441",
      secretVersion: 1,
      exposure: "setup",
    },
    {
      envName: "APP_SECRET",
      secretId: "44444444-4444-4444-8444-444444444442",
      secretVersion: 2,
      exposure: "runtime",
    },
    {
      envName: "TEST_SECRET",
      secretId: "44444444-4444-4444-8444-444444444443",
      secretVersion: 3,
      exposure: "test",
    },
  ],
  startCommand: "npm run start -- --hostname 0.0.0.0 --port 3000",
  applicationPort: 3000,
  healthCheckPath: "/health",
  healthCheckTimeoutMs: 30_000,
  previewEnabled: false,
  previewTtlMs: 120_000,
  runtimeTools: { http: true, browser: true, logs: true },
  allowInbound: false,
};

const context: AgentRunExecutionContext = {
  orgId: "org-1",
  problemId: "problem-1",
  runId: "11111111-1111-4111-8111-111111111111",
  approvalId: "approval-1",
  repository: "owner/repository",
  installationId: "123",
  baseBranch: "main",
  baseSha: "a".repeat(40),
  branchName: "closespan/problem-1-run",
  promptId: "22222222-2222-4222-8222-222222222222",
  promptHash: "b".repeat(64),
  promptContent: "approved prompt",
  promptArtifactPath: ".prompt/tickets/problem-1.prompt.md",
  expiresAt: "2026-07-30T00:00:00.000Z",
  allowedCapabilities: ["repository:read", "tests:execute"],
  executionProfileId: "33333333-3333-4333-8333-333333333333",
  executionProfileHash: profileHash,
  executionProfileSnapshot: {
    profileId: "33333333-3333-4333-8333-333333333333",
    version: 1,
    source: "confirmed",
    repository: "owner/repository",
    workspaceRoot: "packages/app",
    contentHash: profileHash,
    config: profileConfig,
  },
  promptSnapshot: {
    schemaVersion: 1,
    ticket: {
      userStory: "As an analyst, I want exports fixed so that reports are reliable.",
      currentBehavior: "Exports fail.",
      expectedBehavior: "Exports pass.",
      reproductionSteps: ["Run an export."],
      businessOutcome: "Reports remain reliable.",
      acceptanceCriteria: [{ id: "AC-1", statement: "The export passes.", measurable: true }],
      testScenarios: [{
        id: "TEST-1",
        title: "Export succeeds",
        given: "A valid export",
        when: "The export runs",
        then: "It succeeds",
        testLevel: "unit",
        criterionIds: ["AC-1"],
      }],
      regressionScenarios: [],
      negativeScenarios: [],
      qualityExpectations: [],
      requiredTestLevels: ["unit"],
      releaseVerification: "Verify after release.",
      nonGoals: [],
      permittedPaths: ["packages/app/src/**", "packages/app/tests/**"],
      requiredCommands: ["npm test", "npm run typecheck"],
      repository: "owner/repository",
      baseBranch: "main",
      baseSha: "a".repeat(40),
    },
    evidence: {
      problemId: "problem-1",
      title: "Export failure",
      statement: "Exports fail.",
      summary: "The issue is reproducible.",
      severity: "High",
      productArea: "Exports",
      team: "Data",
      assumptions: [],
      missingInformation: [],
      suspectedFiles: ["packages/app/src/export.ts"],
      redactedEvidence: [],
    },
  },
};

const report: AgentImplementationReport = {
  schemaVersion: 1,
  runId: context.runId,
  promptHash: context.promptHash,
  promptArtifactHash: context.promptHash,
  baseSha: context.baseSha,
  status: "Tests passed",
  summary: "Implemented the export fix.",
  changedFiles: [{
    path: "packages/app/src/export.ts",
    contentBase64: Buffer.from("export const fixed = true;\n").toString("base64"),
    reason: "Fix the export.",
  }],
  testFiles: ["packages/app/tests/export.test.ts"],
  tests: [
    { command: "npm test", status: "passed", output: "agent output" },
    { command: "npm run typecheck", status: "passed", output: "agent output" },
  ],
  criteria: [{
    criterionId: "AC-1",
    status: "Passed",
    evidence: "The integration test passed.",
    scenarioIds: ["TEST-1"],
  }],
  remainingRisks: [],
  assumptions: [],
  manualVerification: [],
  logs: [],
};

function setup(
  failedCommand?: string,
  fileHashes: Record<string, string> = {},
  commandOutput = "passed",
  bootSource: {
    sourceSnapshotId?: string;
    sourceRegistryImageId?: string;
    sourceRegistryWorkspaceId?: string;
    sourceRegistryRef?: string;
  } = {},
) {
  const session = {
    id: "tenki-session-1",
    ...bootSource,
    inboundEnabled: false,
    outboundEnabled: false,
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockImplementation((argv: string[]) => {
      const originalArgv = originalCommandArgv(argv);
      const command = originalArgv[0] === "bash" && originalArgv[1] === "-c"
        ? originalArgv[2]
        : undefined;
      if (command) {
        const failed = failedCommand === command;
        return runHandle({
          exitCode: failed ? 1 : 0,
          stdout: failed
            ? new Uint8Array()
            : new TextEncoder().encode(`${command} ${commandOutput}`),
          stderr: failed
            ? new TextEncoder().encode("test failed")
            : new Uint8Array(),
        });
      }
      const source = originalArgv[0] === "node" && originalArgv[1] === "-e"
        ? originalArgv[2] ?? ""
        : "";
      if (source.includes("fs.appendFileSync")) {
        return runHandle({ exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() }, true);
      }
      if (source.includes("split('\\\\n')") || source.includes("split('\\n')")) {
        return runHandle({ exitCode: 0, stdout: new TextEncoder().encode("1"), stderr: new Uint8Array() });
      }
      return runHandle({ exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() });
    }),
    exposePort: vi.fn(),
    unexposePort: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    exec: vi.fn().mockImplementation(async (command: string, options?: { args?: string[] }) => {
      if (command === "sha256sum") {
        const file = options?.args?.[0] ?? context.promptArtifactPath;
        return execution(command, {
          stdout: new TextEncoder().encode(
            `${fileHashes[file] ?? context.promptHash}  ${file}`,
          ),
        });
      }
      const approvedCommand = command === "bash" ? options?.args?.[1] : undefined;
      if (failedCommand && approvedCommand === failedCommand) {
        return execution(command, {
          status: "FAILED",
          exitCode: 1,
          stderr: new TextEncoder().encode("test failed"),
        });
      }
      return execution(command, {
        stdout: command === "bash"
          ? new TextEncoder().encode(`${approvedCommand} ${commandOutput}`)
          : new Uint8Array(),
      });
    }),
  };
  const client = {
    createAndWait: vi.fn().mockResolvedValue(session),
    close: vi.fn(),
  };
  return { session, client };
}

describe("Tenki independent agent verification", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("TENKI_VERIFICATION_REQUIRED", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("replays approved commands in a disposable network-isolated sandbox", async () => {
    const { session, client } = setup();
    const times = [1_000, 1_600];
    const verified = await verifyAgentRunWithTenki(context, report, {
      apiKey: "tk_test",
      now: () => times.shift()!,
      createClient: () => client,
      repositoryArchive: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    });

    expect(client.createAndWait).toHaveBeenCalledWith(expect.objectContaining({
      cpuCores: 4,
      memoryMb: 8192,
      allowInbound: false,
      allowOutbound: false,
      maxDurationMs: 120_000,
      idleTimeoutMinutes: 4,
      snapshotId: "snapshot-profile-1",
      metadata: expect.objectContaining({ runId: context.runId }),
    }));
    expect(session.writeFile).toHaveBeenCalledWith(
      "/home/tenki/repo/packages/app/src/export.ts",
      new TextEncoder().encode("export const fixed = true;\n"),
    );
    const npmTestRun = session.run.mock.calls.find(
      ([argv]) => argv.slice(-3).join("\0") === ["bash", "-c", "npm test"].join("\0"),
    );
    expect(npmTestRun?.[1]).toMatchObject({
      cwd: "/home/tenki/repo/packages/app",
    });
    expect(verified.status).toBe("Tests passed");
    expect(verified.tests.every((test) => test.status === "passed")).toBe(true);
    expect(verified.independentVerification).toMatchObject({
      provider: "Tenki Sandbox",
      sourceSnapshotId: null,
      status: "passed",
      durationMs: 600,
    });
    expect(verified.criteria[0]?.evidence).toContain("tenki-session-1");
    expect(session.close).toHaveBeenCalledOnce();
    expect(client.close).toHaveBeenCalledOnce();
  });

  it("rejects a verification VM that did not boot from the bound snapshot", async () => {
    const { session, client } = setup(
      undefined,
      {},
      "passed",
      { sourceSnapshotId: "snapshot-other" },
    );

    await expect(verifyAgentRunWithTenki(context, report, {
      apiKey: "tk_test",
      createClient: () => client,
      repositoryArchive: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    })).rejects.toMatchObject({
      code: "sandbox_failed",
      message: expect.stringContaining("boot source does not match"),
    });
    expect(session.mkdir).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledOnce();
    expect(client.close).toHaveBeenCalledOnce();
  });

  it("attests exact private-image provenance and records every observed source field", async () => {
    const sourceSnapshotId = "d578a017-eb4b-4a3f-b7d5-1753f9261fc1";
    const sourceRegistryRef = `vbev25/closespan-agent@${sourceSnapshotId}`;
    const imageProfile = {
      ...profileConfig,
      tenkiImage: sourceRegistryRef,
      tenkiSnapshotId: null,
    };
    const imageProfileHash = hashExecutionProfileConfig(imageProfile);
    const imageContext: AgentRunExecutionContext = {
      ...context,
      executionProfileHash: imageProfileHash,
      executionProfileSnapshot: {
        ...context.executionProfileSnapshot,
        contentHash: imageProfileHash,
        config: imageProfile,
      },
    };
    const bootSource = {
      sourceSnapshotId,
      sourceRegistryImageId: "019fd5e4-314b-7c3b-b9b3-df09364ee706",
      sourceRegistryWorkspaceId: "019fa584-01d1-71b8-a93b-6d052830a63d",
      sourceRegistryRef,
    };
    const { client } = setup(undefined, {}, "passed", bootSource);

    const verified = await verifyAgentRunWithTenki(imageContext, report, {
      apiKey: "tk_test",
      createClient: () => client,
      repositoryArchive: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    });

    expect(client.createAndWait).toHaveBeenCalledWith(expect.objectContaining({
      image: sourceRegistryRef,
    }));
    expect(verified.independentVerification).toMatchObject(bootSource);
  });

  it("blocks publication evidence when an independent command fails", async () => {
    const { client } = setup("npm test");
    const verified = await verifyAgentRunWithTenki(context, report, {
      apiKey: "tk_test",
      createClient: () => client,
      repositoryArchive: vi.fn().mockResolvedValue(new Uint8Array([1])),
    });

    expect(verified.status).toBe("Failed");
    expect(verified.tests).toEqual([
      expect.objectContaining({ command: "npm test", status: "failed" }),
      expect.objectContaining({ command: "npm run typecheck", status: "skipped" }),
    ]);
    expect(verified.criteria[0]?.status).toBe("Not verified");
    expect(verified.independentVerification?.status).toBe("failed");
  });

  it("re-hashes the exact approved PDD test inside the independent VM", async () => {
    const generatedTestContent = [
      'import test from "node:test";',
      'test("approved PDD contract", () => {});',
      "",
    ].join("\n");
    const generatedTest = {
      path: "packages/app/tests/export.pdd.test.ts",
      content: generatedTestContent,
      contentHash: createHash("sha256").update(generatedTestContent, "utf8").digest("hex"),
      command: "npm test",
    };
    const pddContext = { ...context, generatedTests: [generatedTest] };
    const pddReport: AgentImplementationReport = {
      ...report,
      changedFiles: [
        ...report.changedFiles,
        {
          path: generatedTest.path,
          contentBase64: Buffer.from(generatedTest.content, "utf8").toString("base64"),
          reason: "Immutable PDD acceptance contract.",
        },
      ],
      testFiles: [generatedTest.path],
    };
    const { session, client } = setup(undefined, {
      [generatedTest.path]: generatedTest.contentHash,
    });

    await verifyAgentRunWithTenki(pddContext, pddReport, {
      apiKey: "tk_test",
      createClient: () => client,
      repositoryArchive: vi.fn().mockResolvedValue(new Uint8Array([1])),
    });

    expect(session.writeFile).toHaveBeenCalledWith(
      `/home/tenki/repo/${generatedTest.path}`,
      new TextEncoder().encode(generatedTest.content),
    );
    expect(session.exec).toHaveBeenCalledWith("sha256sum", {
      args: [generatedTest.path],
      cwd: "/home/tenki/repo",
      timeoutMs: 10_000,
    });
  });

  it("keeps a v2 application live while replaying approved and PDD commands with phase-scoped environment", async () => {
    const generatedTestContent = 'test("live user story", async () => { await fetch(process.env.CLOSESPAN_APP_URL + "/health"); });\n';
    const generatedTest = {
      path: "packages/app/tests/export.pdd.test.ts",
      content: generatedTestContent,
      contentHash: createHash("sha256").update(generatedTestContent, "utf8").digest("hex"),
      command: "npm run pdd:live",
    };
    const runtimeHash = hashExecutionProfileConfig(runtimeProfileConfig);
    const runtimeContext: AgentRunExecutionContext = {
      ...context,
      promptSnapshot: {
        ...context.promptSnapshot,
        ticket: {
          ...context.promptSnapshot.ticket,
          testScenarios: context.promptSnapshot.ticket.testScenarios.map((scenario) => ({
            ...scenario,
            testLevel: "end-to-end" as const,
          })),
          requiredTestLevels: ["end-to-end"],
        },
      },
      executionProfileHash: runtimeHash,
      executionProfileSnapshot: {
        ...context.executionProfileSnapshot,
        contentHash: runtimeHash,
        config: runtimeProfileConfig,
      },
      generatedTests: [generatedTest],
    };
    const runtimeReport: AgentImplementationReport = {
      ...report,
      runtimeEvidence: {
        configured: true,
        healthStatus: "passed",
        applicationPort: 3000,
        previewUrl: null,
        interactions: [{
          tool: "browser",
          target: "/exports",
          status: "browser interaction passed",
          evidence: "The coding agent inspected the rendered exports page.",
        }],
        logExcerpt: [],
        userStoryReplay: "passed",
        userStoryReplayMode: "live_application",
      },
      changedFiles: [
        ...report.changedFiles,
        {
          path: generatedTest.path,
          contentBase64: Buffer.from(generatedTest.content, "utf8").toString("base64"),
          reason: "Immutable PDD acceptance contract.",
        },
      ],
      testFiles: [generatedTest.path],
    };
    const { session, client } = setup(undefined, {
      [generatedTest.path]: generatedTest.contentHash,
    }, "passed test-secret-value");
    const runtime = {
      prepare: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue({
        state: "healthy",
        pid: 71,
        healthy: true,
        previewUrl: null,
      }),
      request: vi.fn().mockResolvedValue({ statusCode: 200, body: "ok" }),
      status: vi.fn().mockResolvedValue({
        state: "healthy",
        pid: 71,
        healthy: true,
        previewUrl: null,
      }),
      logs: vi.fn().mockReturnValue("application started with test-secret-value\nready"),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const createRuntimeEnvironment = vi.fn().mockReturnValue(runtime);

    const verified = await verifyAgentRunWithTenki(runtimeContext, runtimeReport, {
      apiKey: "tk_test",
      createClient: () => client,
      repositoryArchive: vi.fn().mockResolvedValue(new Uint8Array([1])),
      runtimeEnvironment: {
        setupEnv: { INSTALL_TOKEN: "install-secret-value" },
        runtimeEnv: { APP_SECRET: "runtime-secret-value" },
        testEnv: { TEST_SECRET: "test-secret-value" },
        redactionValues: [
          "install-secret-value",
          "runtime-secret-value",
          "test-secret-value",
        ],
      },
      createRuntimeEnvironment,
    });

    expect(createRuntimeEnvironment).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        install: {
          enabled: true,
          commands: ["npm ci", TENKI_BROWSER_PREFLIGHT_COMMAND],
        },
        build: { enabled: true, commands: ["npm run build"] },
        startCommand: runtimeProfileConfig.startCommand,
        port: 3000,
        healthPath: "/health",
        preview: { allowed: false, ttlMs: 120_000 },
      }),
      expect.objectContaining({
        setupEnv: {
          PUBLIC_MODE: "verification",
          INSTALL_TOKEN: "install-secret-value",
        },
        rerunEnv: {
          PUBLIC_MODE: "verification",
          CI: "true",
        },
        runtimeEnv: {
          PUBLIC_MODE: "verification",
          APP_SECRET: "runtime-secret-value",
          PORT: "3000",
        },
      }),
    );
    expect(runtime.prepare.mock.calls).toEqual([
      [{ runInstall: true, runBuild: false }],
      [{ runInstall: false, runBuild: true }],
    ]);
    const pddReplayRun = session.run.mock.calls.find(
      ([argv]) => argv.slice(-3).join("\0") === ["bash", "-c", "npm run pdd:live"].join("\0"),
    );
    expect(pddReplayRun?.[1]).toMatchObject({
      env: {
        PUBLIC_MODE: "verification",
        TEST_SECRET: "test-secret-value",
        CI: "true",
        CLOSESPAN_APP_URL: "http://127.0.0.1:4024",
      },
    });
    expect(verified.runtimeEvidence).toMatchObject({
      configured: true,
      healthStatus: "passed",
      applicationPort: 3000,
      previewUrl: null,
      userStoryReplay: "passed",
      interactions: expect.arrayContaining([
        expect.objectContaining({
          stage: "implementation",
          tool: "browser",
        }),
        expect.objectContaining({
          stage: "verification",
          tool: "http",
        }),
      ]),
    });
    expect(verified.tests.map((test) => test.command)).toEqual([
      "npm test",
      "npm run typecheck",
      "npm run pdd:live",
    ]);
    expect(JSON.stringify(verified)).not.toContain("test-secret-value");
    expect(JSON.stringify(verified)).toContain("[REDACTED_RUNTIME_SECRET]");
    expect(runtime.close).toHaveBeenCalledOnce();
    const firstReplayIndex = session.run.mock.calls.findIndex(
      ([argv]) => argv.at(-3) === "bash" && argv.at(-2) === "-c",
    );
    expect(runtime.start.mock.invocationCallOrder[0]).toBeLessThan(
      session.run.mock.invocationCallOrder[firstReplayIndex]!,
    );
    expect(session.run.mock.invocationCallOrder[firstReplayIndex]).toBeLessThan(
      runtime.close.mock.invocationCallOrder[0]!,
    );
    expect(runtime.close.mock.invocationCallOrder[0]).toBeLessThan(
      session.close.mock.invocationCallOrder[0]!,
    );
  });

  it("prepares automatic install and build for a v2 setup-only profile without starting an app", async () => {
    const setupOnlyProfile: ExecutionProfileConfigV2 = {
      ...runtimeProfileConfig,
      installCommands: [...profileConfig.installCommands],
      startCommand: null,
      applicationPort: null,
      healthCheckPath: null,
      previewEnabled: false,
      runtimeTools: { http: false, browser: false, logs: false },
      allowInbound: false,
    };
    const setupOnlyHash = hashExecutionProfileConfig(setupOnlyProfile);
    const setupOnlyContext: AgentRunExecutionContext = {
      ...context,
      executionProfileHash: setupOnlyHash,
      executionProfileSnapshot: {
        ...context.executionProfileSnapshot,
        contentHash: setupOnlyHash,
        config: setupOnlyProfile,
      },
    };
    const { session, client } = setup();
    const runtime = {
      prepare: vi.fn().mockResolvedValue(undefined),
      start: vi.fn(),
      request: vi.fn(),
      status: vi.fn(),
      logs: vi.fn().mockReturnValue("dependencies installed\napplication built"),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const createRuntimeEnvironment = vi.fn().mockReturnValue(runtime);

    const verified = await verifyAgentRunWithTenki(setupOnlyContext, report, {
      apiKey: "tk_test",
      createClient: () => client,
      repositoryArchive: vi.fn().mockResolvedValue(new Uint8Array([1])),
      runtimeEnvironment: {
        setupEnv: { INSTALL_TOKEN: "install-secret-value" },
        runtimeEnv: { APP_SECRET: "runtime-secret-value" },
        testEnv: { TEST_SECRET: "test-secret-value" },
        redactionValues: [
          "install-secret-value",
          "runtime-secret-value",
          "test-secret-value",
        ],
      },
      createRuntimeEnvironment,
    });

    expect(createRuntimeEnvironment).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        install: { enabled: true, commands: ["npm ci"] },
        build: { enabled: true, commands: ["npm run build"] },
        startCommand: null,
        port: null,
        healthPath: null,
      }),
      expect.objectContaining({
        setupEnv: {
          PUBLIC_MODE: "verification",
          INSTALL_TOKEN: "install-secret-value",
        },
        rerunEnv: {
          PUBLIC_MODE: "verification",
          CI: "true",
        },
        runtimeEnv: {
          PUBLIC_MODE: "verification",
          APP_SECRET: "runtime-secret-value",
        },
      }),
    );
    expect(runtime.prepare.mock.calls).toEqual([
      [{ runInstall: true, runBuild: false }],
      [{ runInstall: false, runBuild: true }],
    ]);
    expect(runtime.start).not.toHaveBeenCalled();
    expect(verified.status).toBe("Tests passed");
    expect(verified.runtimeEvidence).toMatchObject({
      configured: false,
      healthStatus: "not_configured",
      applicationPort: null,
      previewUrl: null,
      interactions: [expect.objectContaining({
        stage: "verification",
        tool: "setup",
        status: "passed",
      })],
    });
    const firstReplay = session.run.mock.calls.findIndex(
      ([argv]) => argv.slice(-3).join("\0") === ["bash", "-c", "npm test"].join("\0"),
    );
    expect(runtime.prepare.mock.invocationCallOrder[0]).toBeLessThan(
      session.run.mock.invocationCallOrder[firstReplay]!,
    );
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("records a redacted failed health check and skips live replay when the app cannot start", async () => {
    const runtimeHash = hashExecutionProfileConfig(runtimeProfileConfig);
    const runtimeContext: AgentRunExecutionContext = {
      ...context,
      executionProfileHash: runtimeHash,
      executionProfileSnapshot: {
        ...context.executionProfileSnapshot,
        contentHash: runtimeHash,
        config: runtimeProfileConfig,
      },
    };
    const { client } = setup();
    const runtime = {
      prepare: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockRejectedValue(new Error("boot exposed runtime-secret-value")),
      request: vi.fn(),
      status: vi.fn(),
      logs: vi.fn().mockReturnValue("failed with runtime-secret-value"),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const verified = await verifyAgentRunWithTenki(runtimeContext, report, {
      apiKey: "tk_test",
      createClient: () => client,
      repositoryArchive: vi.fn().mockResolvedValue(new Uint8Array([1])),
      runtimeEnvironment: {
        setupEnv: { INSTALL_TOKEN: "install-secret-value" },
        runtimeEnv: { APP_SECRET: "runtime-secret-value" },
        testEnv: { TEST_SECRET: "test-secret-value" },
        redactionValues: ["runtime-secret-value"],
      },
      createRuntimeEnvironment: vi.fn().mockReturnValue(runtime),
    });

    expect(verified.status).toBe("Failed");
    expect(verified.tests.every((test) => test.status === "skipped")).toBe(true);
    expect(verified.runtimeEvidence).toMatchObject({
      configured: true,
      healthStatus: "failed",
      userStoryReplay: "not_required",
    });
    expect(JSON.stringify(verified)).not.toContain("runtime-secret-value");
    expect(JSON.stringify(verified)).toContain("[REDACTED_RUNTIME_SECRET]");
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("fails before creating a VM when resolved secret phases do not match the immutable profile", async () => {
    const runtimeHash = hashExecutionProfileConfig(runtimeProfileConfig);
    const runtimeContext: AgentRunExecutionContext = {
      ...context,
      executionProfileHash: runtimeHash,
      executionProfileSnapshot: {
        ...context.executionProfileSnapshot,
        contentHash: runtimeHash,
        config: runtimeProfileConfig,
      },
    };
    const { client } = setup();

    await expect(verifyAgentRunWithTenki(runtimeContext, report, {
      apiKey: "tk_test",
      createClient: () => client,
      repositoryArchive: vi.fn().mockResolvedValue(new Uint8Array([1])),
      runtimeEnvironment: {
        setupEnv: { INSTALL_TOKEN: "install-secret-value" },
        runtimeEnv: { APP_SECRET: "runtime-secret-value" },
        testEnv: {},
        redactionValues: [],
      },
    })).rejects.toMatchObject({ code: "sandbox_failed" });
    expect(client.createAndWait).not.toHaveBeenCalled();
  });

  it("fails before creating a VM when the PDD test differs from the approved artifact", async () => {
    const generatedTestContent = 'test("approved", () => {});\n';
    const generatedTest = {
      path: "packages/app/tests/export.pdd.test.ts",
      content: generatedTestContent,
      contentHash: createHash("sha256").update(generatedTestContent, "utf8").digest("hex"),
      command: "npm test",
    };
    const { client } = setup();

    await expect(verifyAgentRunWithTenki(
      { ...context, generatedTests: [generatedTest] },
      {
        ...report,
        changedFiles: [
          ...report.changedFiles,
          {
            path: generatedTest.path,
            contentBase64: Buffer.from('test("tampered", () => {});\n').toString("base64"),
            reason: "Tampered artifact.",
          },
        ],
        testFiles: [generatedTest.path],
      },
      {
        apiKey: "tk_test",
        createClient: () => client,
        repositoryArchive: vi.fn().mockResolvedValue(new Uint8Array([1])),
      },
    )).rejects.toMatchObject({ code: "sandbox_failed" });
    expect(client.createAndWait).not.toHaveBeenCalled();
  });

  it("skips transparently when optional verification is not configured", async () => {
    await expect(verifyAgentRunWithTenki(context, report, { apiKey: "" }))
      .resolves.toBe(report);
  });

  it("fails closed when production requires Tenki but the key is absent", async () => {
    vi.stubEnv("TENKI_VERIFICATION_REQUIRED", "true");
    await expect(verifyAgentRunWithTenki(context, report, { apiKey: "" }))
      .rejects.toMatchObject({ code: "not_configured" });
  });

  it("fails closed when sandbox cleanup cannot be confirmed", async () => {
    const { session, client } = setup();
    session.close.mockRejectedValue(new Error("cleanup failed"));
    await expect(verifyAgentRunWithTenki(context, report, {
      apiKey: "tk_test",
      createClient: () => client,
      repositoryArchive: vi.fn().mockResolvedValue(new Uint8Array([1])),
    })).rejects.toMatchObject({ code: "cleanup_failed" });
  });

  it("fails closed when the persisted execution profile snapshot drifts", async () => {
    const { client } = setup();
    await expect(verifyAgentRunWithTenki({
      ...context,
      executionProfileHash: "f".repeat(64),
    }, report, {
      apiKey: "tk_test",
      createClient: () => client,
      repositoryArchive: vi.fn().mockResolvedValue(new Uint8Array([1])),
    })).rejects.toMatchObject({ code: "sandbox_failed" });
    expect(client.createAndWait).not.toHaveBeenCalled();
  });

  it("fails closed before creating a VM for an unconfirmed detected profile", async () => {
    const { client } = setup();
    await expect(verifyAgentRunWithTenki({
      ...context,
      executionProfileSnapshot: {
        ...context.executionProfileSnapshot,
        source: "detected",
      },
    }, report, {
      apiKey: "tk_test",
      createClient: () => client,
      repositoryArchive: vi.fn().mockResolvedValue(new Uint8Array([1])),
    })).rejects.toMatchObject({ code: "sandbox_failed" });
    expect(client.createAndWait).not.toHaveBeenCalled();
  });

  it("fails closed before creating a VM for a cross-repository profile", async () => {
    const { client } = setup();
    await expect(verifyAgentRunWithTenki({
      ...context,
      executionProfileSnapshot: {
        ...context.executionProfileSnapshot,
        repository: "owner/another-repository",
      },
    }, report, {
      apiKey: "tk_test",
      createClient: () => client,
      repositoryArchive: vi.fn().mockResolvedValue(new Uint8Array([1])),
    })).rejects.toMatchObject({ code: "sandbox_failed" });
    expect(client.createAndWait).not.toHaveBeenCalled();
  });

  it("fails closed if Tenki returns a network-enabled verification session", async () => {
    const { session, client } = setup();
    session.outboundEnabled = true;
    await expect(verifyAgentRunWithTenki(context, report, {
      apiKey: "tk_test",
      createClient: () => client,
      repositoryArchive: vi.fn().mockResolvedValue(new Uint8Array([1])),
    })).rejects.toMatchObject({ code: "sandbox_failed" });
    expect(session.close).toHaveBeenCalledOnce();
    expect(client.close).toHaveBeenCalledOnce();
  });
});
