import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecResult } from "@tenkicloud/sandbox";
import type { AgentImplementationReport } from "./agent-run-verification";
import type { AgentRunExecutionContext } from "./engineering-workflow-repository";
import {
  verifyAgentRunWithTenki,
} from "./tenki-agent-verification";
import { hashExecutionProfileConfig } from "./execution-profile";

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
        testLevel: "integration",
        criterionIds: ["AC-1"],
      }],
      regressionScenarios: [],
      negativeScenarios: [],
      qualityExpectations: [],
      requiredTestLevels: ["integration"],
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

function setup(failedCommand?: string) {
  const session = {
    id: "tenki-session-1",
    inboundEnabled: false,
    outboundEnabled: false,
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    exec: vi.fn().mockImplementation(async (command: string, options?: { args?: string[] }) => {
      if (command === "sha256sum") {
        return execution(command, {
          stdout: new TextEncoder().encode(`${context.promptHash}  ${context.promptArtifactPath}`),
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
          ? new TextEncoder().encode(`${approvedCommand} passed`)
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
    expect(session.exec).toHaveBeenCalledWith("bash", expect.objectContaining({
      args: ["-c", "npm test"],
      cwd: "/home/tenki/repo/packages/app",
    }));
    expect(verified.status).toBe("Tests passed");
    expect(verified.tests.every((test) => test.status === "passed")).toBe(true);
    expect(verified.independentVerification).toMatchObject({
      provider: "Tenki Sandbox",
      status: "passed",
      durationMs: 600,
    });
    expect(verified.criteria[0]?.evidence).toContain("tenki-session-1");
    expect(session.close).toHaveBeenCalledOnce();
    expect(client.close).toHaveBeenCalledOnce();
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
