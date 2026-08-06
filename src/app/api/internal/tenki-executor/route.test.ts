import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hashExecutionProfileConfig,
  upgradeExecutionProfileConfigV2,
} from "@/lib/execution-profile";

const workflow = vi.hoisted(() => ({
  claim: vi.fn(),
  context: vi.fn(),
}));
const executor = vi.hoisted(() => ({ run: vi.fn() }));
const runtimeSecrets = vi.hoisted(() => ({ resolve: vi.fn() }));

vi.mock("@/lib/engineering-workflow-repository", () => ({
  claimQueuedAgentRun: workflow.claim,
  getAgentRunExecutionContext: workflow.context,
}));

vi.mock("@/lib/tenki-coding-executor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenki-coding-executor")>();
  return { ...actual, executeTenkiCodingJob: executor.run };
});
vi.mock("@/lib/runtime-secret-repository", () => ({
  resolveRuntimeSecretBindings: runtimeSecrets.resolve,
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

const secret = "tenki-executor-test-secret";
const runId = "11111111-1111-4111-8111-111111111111";
const callbackUrl = `https://www.closespan.com/api/internal/agent-runs/${runId}`;
const profileConfig = {
  schemaVersion: 1 as const,
  language: "typescript",
  framework: "nextjs",
  packageManager: "npm",
  runtimeVersion: "22",
  workingDirectory: ".",
  installCommands: ["npm ci"],
  buildCommands: ["npm run build"],
  testCommands: ["npm test"],
  typecheckCommands: [],
  permittedPaths: ["src/**", "tests/**"],
  tenkiImage: null,
  tenkiSnapshotId: null,
  cpuCores: 2,
  memoryMb: 4096,
  allowInbound: false,
  allowOutbound: false,
  maxDurationMs: 240_000,
  idleTimeoutMinutes: 2,
};
const profileHash = hashExecutionProfileConfig(profileConfig);
const job = {
  schemaVersion: 2,
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
  executionProfileId: "33333333-3333-4333-8333-333333333333",
  executionProfileHash: profileHash,
  executionProfileSnapshot: {
    profileId: "33333333-3333-4333-8333-333333333333",
    version: 1,
    source: "confirmed",
    repository: "owner/repo",
    workspaceRoot: ".",
    contentHash: profileHash,
    config: profileConfig,
  },
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
  executionProfileId: job.executionProfileId,
  executionProfileHash: job.executionProfileHash,
  executionProfileSnapshot: job.executionProfileSnapshot,
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
    runtimeSecrets.resolve.mockReset().mockResolvedValue({
      setup: {},
      runtime: {},
      test: {},
      redactionValues: [],
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

  it("rejects a signed job when its execution profile drifted after approval", async () => {
    const payload = { ...job, executionProfileHash: "f".repeat(64) };
    const body = JSON.stringify(payload);
    const response = await POST(new NextRequest("http://localhost/api/internal/tenki-executor", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-closespan-signature": createHmac("sha256", secret).update(body).digest("hex"),
      },
      body,
    }));
    expect(response.status).toBe(409);
    expect(workflow.claim).not.toHaveBeenCalled();
    expect(executor.run).not.toHaveBeenCalled();
  });

  it("accepts an approval-bound execution profile snapshot regardless of JSON object key order", async () => {
    const reorderedConfig = {
      idleTimeoutMinutes: profileConfig.idleTimeoutMinutes,
      maxDurationMs: profileConfig.maxDurationMs,
      allowOutbound: profileConfig.allowOutbound,
      allowInbound: profileConfig.allowInbound,
      memoryMb: profileConfig.memoryMb,
      cpuCores: profileConfig.cpuCores,
      tenkiSnapshotId: profileConfig.tenkiSnapshotId,
      tenkiImage: profileConfig.tenkiImage,
      permittedPaths: profileConfig.permittedPaths,
      typecheckCommands: profileConfig.typecheckCommands,
      testCommands: profileConfig.testCommands,
      buildCommands: profileConfig.buildCommands,
      installCommands: profileConfig.installCommands,
      workingDirectory: profileConfig.workingDirectory,
      runtimeVersion: profileConfig.runtimeVersion,
      packageManager: profileConfig.packageManager,
      framework: profileConfig.framework,
      language: profileConfig.language,
      schemaVersion: profileConfig.schemaVersion,
    };
    workflow.context.mockResolvedValue({
      ...context,
      executionProfileSnapshot: {
        config: reorderedConfig,
        contentHash: job.executionProfileSnapshot.contentHash,
        workspaceRoot: job.executionProfileSnapshot.workspaceRoot,
        repository: job.executionProfileSnapshot.repository,
        source: job.executionProfileSnapshot.source,
        version: job.executionProfileSnapshot.version,
        profileId: job.executionProfileSnapshot.profileId,
      },
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(workflow.claim).toHaveBeenCalledWith(job.orgId, job.runId);
    expect(executor.run).toHaveBeenCalledOnce();
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

  it("accepts approval-bound generated tests regardless of JSON object key order", async () => {
    const generatedTest = {
      path: "tests/export.pdd.test.ts",
      content: "test('approved contract', () => {})",
      contentHash: "c".repeat(64),
      command: "npm test",
    };
    const payload = { ...job, generatedTests: [generatedTest] };
    workflow.context.mockResolvedValue({
      ...context,
      generatedTests: [{
        path: generatedTest.path,
        command: generatedTest.command,
        content: generatedTest.content,
        contentHash: generatedTest.contentHash,
      }],
    });
    const body = JSON.stringify(payload);
    const response = await POST(new NextRequest("http://localhost/api/internal/tenki-executor", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-closespan-signature": createHmac("sha256", secret).update(body).digest("hex"),
      },
      body,
    }));
    expect(response.status).toBe(200);
    expect(executor.run).toHaveBeenCalledOnce();
  });

  it("resolves exact secret versions only after claiming a v2 runtime job", async () => {
    const runtimeConfig = {
      ...upgradeExecutionProfileConfigV2(profileConfig),
      startCommand: "npm run start",
      applicationPort: 3000,
      healthCheckPath: "/health",
      runtimeTools: { http: true, browser: false, logs: true },
      secretBindings: [{
        envName: "DATABASE_URL",
        secretId: "44444444-4444-4444-8444-444444444444",
        secretVersion: 2,
        exposure: "runtime" as const,
      }],
    };
    const runtimeHash = hashExecutionProfileConfig(runtimeConfig);
    const payload = {
      ...job,
      executionProfileHash: runtimeHash,
      executionProfileSnapshot: {
        ...job.executionProfileSnapshot,
        contentHash: runtimeHash,
        config: runtimeConfig,
      },
    };
    workflow.context.mockResolvedValue({
      ...context,
      executionProfileHash: runtimeHash,
      executionProfileSnapshot: payload.executionProfileSnapshot,
    });
    runtimeSecrets.resolve.mockResolvedValue({
      setup: {},
      runtime: { DATABASE_URL: "postgres://runtime-secret" },
      test: {},
      redactionValues: ["postgres://runtime-secret"],
    });
    const body = JSON.stringify(payload);
    const response = await POST(new NextRequest("http://localhost/api/internal/tenki-executor", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-closespan-signature": createHmac("sha256", secret).update(body).digest("hex"),
      },
      body,
    }));

    expect(response.status).toBe(200);
    expect(workflow.claim).toHaveBeenCalledBefore(runtimeSecrets.resolve);
    expect(runtimeSecrets.resolve).toHaveBeenCalledWith({
      orgId: job.orgId,
      repository: job.repository,
      workspaceRoot: ".",
      bindings: runtimeConfig.secretBindings,
    });
    expect(executor.run).toHaveBeenCalledWith(
      expect.objectContaining({ executionProfileHash: runtimeHash }),
      expect.any(Object),
      { runtimeEnvironment: expect.objectContaining({ runtime: { DATABASE_URL: "postgres://runtime-secret" } }) },
    );
  });
});
