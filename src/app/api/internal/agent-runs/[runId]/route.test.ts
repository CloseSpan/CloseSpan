import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { upgradeExecutionProfileConfigV2 } from "@/lib/execution-profile";

const background = vi.hoisted(() => ({
  tasks: [] as Array<() => Promise<void>>,
}));
const workflow = vi.hoisted(() => ({
  complete: vi.fn(),
  fail: vi.fn(),
  context: vi.fn(),
  running: vi.fn(),
}));
const tenki = vi.hoisted(() => ({
  verify: vi.fn(),
}));
const github = vi.hoisted(() => ({
  publish: vi.fn(),
}));
const runtimeSecrets = vi.hoisted(() => ({ resolve: vi.fn() }));
const oidc = vi.hoisted(() => ({ verify: vi.fn(), assert: vi.fn() }));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: vi.fn((task: () => Promise<void>) => {
      background.tasks.push(task);
    }),
  };
});

vi.mock("@/lib/agent-run-verification", () => ({
  agentImplementationReportSchema: { parse: (value: unknown) => value },
  validateAgentImplementationReport: vi.fn(),
}));

vi.mock("@/lib/engineering-workflow-repository", () => ({
  completeAgentRun: workflow.complete,
  failAgentRun: workflow.fail,
  getAgentRunExecutionContext: workflow.context,
  markAgentRunRunning: workflow.running,
}));

vi.mock("@/lib/tenki-agent-verification", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenki-agent-verification")>();
  return { ...actual, verifyAgentRunWithTenki: tenki.verify };
});

vi.mock("@/lib/github-agent-publisher", () => ({
  publishAgentRun: github.publish,
}));
vi.mock("@/lib/runtime-secret-repository", () => ({
  resolveRuntimeSecretBindings: runtimeSecrets.resolve,
}));
vi.mock("@/lib/github-actions-oidc", () => ({
  verifyGithubActionsOidcToken: oidc.verify,
  assertGithubActionsRunIdentity: oidc.assert,
}));

import { NextRequest } from "next/server";
import { GET, POST } from "./route";

const runId = "11111111-1111-4111-8111-111111111111";
const secret = "test-callback-secret";
const context = {
  orgId: "org-1",
  runId,
  promptHash: "b".repeat(64),
  baseSha: "a".repeat(40),
  promptArtifactPath: ".prompt/tickets/problem.prompt.md",
  promptSnapshot: { ticket: {} },
};
const report = {
  status: "Tests passed",
  summary: "Implementation completed.",
};

function callbackRequest(payload: unknown): NextRequest {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  return new NextRequest(`http://localhost/api/internal/agent-runs/${runId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-closespan-signature": signature,
    },
    body,
  });
}

function oidcCallbackRequest(payload: { orgId: string } & Record<string, unknown>): NextRequest {
  const body = JSON.stringify(payload);
  return new NextRequest(`http://localhost/api/internal/agent-runs/${runId}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer github-oidc-token" },
    body,
  });
}

function runnerContext() {
  return {
    ...context,
    repository: "owner/repo",
    executionProfileId: "22222222-2222-4222-8222-222222222222",
    executionProfileHash: "c".repeat(64),
    promptContent: "Approved implementation prompt",
    expiresAt: "2026-08-13T00:00:00.000Z",
    allowedCapabilities: ["repository:read", "repository:write", "tests:execute"],
    generatedTests: [{ path: "tests/pdd.test.ts", content: "test content", contentHash: "d".repeat(64), command: "npm test" }],
    promptSnapshot: {
      ticket: {
        requiredCommands: ["npm test"],
        permittedPaths: ["src/**/*", "tests/**/*"],
        acceptanceCriteria: [{ id: "AC-1" }],
        testScenarios: [{ id: "TEST-1", testLevel: "integration", criterionIds: ["AC-1"] }],
        releaseVerification: "Run npm test",
      },
    },
    executionProfileSnapshot: {
      profileId: "22222222-2222-4222-8222-222222222222",
      version: 1,
      source: "confirmed",
      repository: "owner/repo",
      workspaceRoot: ".",
      contentHash: "c".repeat(64),
      config: {
        ...upgradeExecutionProfileConfigV2({ schemaVersion: 1 }),
        schemaVersion: 3,
        executor: {
          kind: "tenki_github_actions",
          platform: "linux",
          architecture: "x64",
          runnerLabel: "tenki-standard-large-8c-16g",
          workflowPath: ".github/workflows/closespan-agent-runner.yml",
          workflowSha256: "e".repeat(64),
          xcode: null,
          androidEmulator: null,
        },
      },
    },
  };
}

describe("agent-run completion callback", () => {
  beforeEach(() => {
    vi.stubEnv("AGENT_EXECUTOR_SHARED_SECRET", secret);
    background.tasks = [];
    workflow.complete.mockReset().mockResolvedValue({});
    workflow.fail.mockReset().mockResolvedValue(undefined);
    workflow.context.mockReset().mockResolvedValue(context);
    workflow.running.mockReset().mockResolvedValue(undefined);
    tenki.verify.mockReset().mockResolvedValue({
      ...report,
      independentVerification: {
        provider: "Tenki Sandbox",
        sessionId: "tenki-1",
        status: "passed",
        completedAt: "2026-07-29T00:00:00.000Z",
        durationMs: 500,
      },
    });
    github.publish.mockReset().mockResolvedValue({
      promptCommitSha: "prompt-sha",
      implementationCommitSha: "implementation-sha",
      pullRequestNumber: 2,
      pullRequestUrl: "https://github.com/owner/repo/pull/2",
    });
    runtimeSecrets.resolve.mockReset().mockResolvedValue({
      setup: {},
      runtime: {},
      test: {},
      redactionValues: [],
    });
    oidc.verify.mockReset().mockResolvedValue({
      actor: "closespan[bot]",
      event_name: "workflow_dispatch",
      repository: "owner/repo",
      ref: `refs/heads/closespan/runs/${runId}`,
      workflow_ref: `owner/repo/.github/workflows/closespan-agent-runner.yml@refs/heads/closespan/runs/${runId}`,
      run_id: "123",
    });
    oidc.assert.mockReset();
  });

  it("acknowledges the executor promptly and verifies automatically before publication", async () => {
    const response = await POST(
      callbackRequest({ event: "completed", orgId: "org-1", report }),
      { params: Promise.resolve({ runId }) },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: "independent_verification_queued",
    });
    expect(workflow.complete).toHaveBeenCalledOnce();
    expect(github.publish).not.toHaveBeenCalled();
    expect(background.tasks).toHaveLength(1);

    await background.tasks[0]!();

    expect(tenki.verify).toHaveBeenCalledWith(context, report, {});
    expect(github.publish).toHaveBeenCalledOnce();
    expect(workflow.complete).toHaveBeenCalledTimes(2);
    expect(workflow.fail).not.toHaveBeenCalled();
  });

  it("accepts a GitHub OIDC identity from the approval-bound Tenki runner workflow", async () => {
    workflow.context.mockResolvedValue({
      ...context,
      repository: "owner/repo",
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
    });
    const response = await POST(
      oidcCallbackRequest({ event: "started", orgId: "org-1", sandboxId: "github-actions:123" }),
      { params: Promise.resolve({ runId }) },
    );

    expect(response.status).toBe(200);
    expect(workflow.running).toHaveBeenCalledWith("org-1", runId, "github-actions:123");
    expect(oidc.assert).toHaveBeenCalledWith(expect.objectContaining({
      repository: "owner/repo",
      runId,
      workflowPath: ".github/workflows/closespan-agent-runner.yml",
      expectedSha: context.baseSha,
    }));
  });

  it("returns a secret-free approval-bound job to the OIDC-authenticated runner", async () => {
    vi.unstubAllEnvs();
    workflow.context.mockResolvedValue(runnerContext());
    const response = await GET(
      new NextRequest(`http://localhost/api/internal/agent-runs/${runId}?orgId=org-1`, {
        headers: { authorization: "Bearer github-oidc-token" },
      }),
      { params: Promise.resolve({ runId }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      schemaVersion: 1,
      runId,
      repository: "owner/repo",
      promptContent: "Approved implementation prompt",
      generatedTests: [{
        path: "tests/pdd.test.ts",
        content: "test content",
        contentHash: "d".repeat(64),
        command: "npm test",
      }],
      requiredCommands: ["npm test"],
      runner: { label: "tenki-standard-large-8c-16g", platform: "linux" },
    });
    expect(oidc.assert).toHaveBeenCalledWith(expect.objectContaining({
      repository: "owner/repo",
      runId,
      workflowPath: ".github/workflows/closespan-agent-runner.yml",
      expectedSha: context.baseSha,
    }));
  });

  it("keeps the completed GitHub report bound to the approved commit and workflow run", async () => {
    workflow.context.mockResolvedValue(runnerContext());
    const githubReport = {
      ...report,
      independentVerification: {
        provider: "Tenki GitHub Actions",
        workflowRunId: 123,
        runnerLabel: "tenki-standard-large-8c-16g",
        platform: "linux",
        implementationJobId: "implementation:123:1",
        verificationJobId: "verification:123:1",
        status: "passed",
        completedAt: "2026-08-14T00:00:00.000Z",
        durationMs: 1_000,
      },
    };

    const response = await POST(
      oidcCallbackRequest({ event: "completed", orgId: "org-1", report: githubReport }),
      { params: Promise.resolve({ runId }) },
    );

    expect(response.status).toBe(202);
    expect(oidc.assert).toHaveBeenCalledTimes(2);
    expect(oidc.assert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      expectedSha: context.baseSha,
    }));
    expect(oidc.assert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      expectedSha: context.baseSha,
      reportedWorkflowRunId: 123,
    }));
  });

  it("does not publish when independent verification fails", async () => {
    tenki.verify.mockResolvedValue({
      ...report,
      status: "Failed",
      independentVerification: {
        provider: "Tenki Sandbox",
        sessionId: "tenki-1",
        status: "failed",
        completedAt: "2026-07-29T00:00:00.000Z",
        durationMs: 500,
      },
    });
    await POST(
      callbackRequest({ event: "completed", orgId: "org-1", report }),
      { params: Promise.resolve({ runId }) },
    );

    await background.tasks[0]!();

    expect(github.publish).not.toHaveBeenCalled();
    expect(workflow.complete).toHaveBeenCalledTimes(2);
    expect(workflow.fail).not.toHaveBeenCalled();
  });

  it("resolves the same immutable secret versions for independent verification", async () => {
    const runtimeConfig = {
      ...upgradeExecutionProfileConfigV2({ schemaVersion: 1 }),
      secretBindings: [{
        envName: "DATABASE_URL",
        secretId: "22222222-2222-4222-8222-222222222222",
        secretVersion: 4,
        exposure: "test" as const,
      }],
    };
    const runtimeContext = {
      ...context,
      repository: "owner/repo",
      executionProfileSnapshot: {
        profileId: "33333333-3333-4333-8333-333333333333",
        version: 2,
        source: "confirmed",
        repository: "owner/repo",
        workspaceRoot: ".",
        contentHash: "c".repeat(64),
        config: runtimeConfig,
      },
    };
    workflow.context.mockResolvedValue(runtimeContext);
    runtimeSecrets.resolve.mockResolvedValue({
      setup: {},
      runtime: {},
      test: { DATABASE_URL: "postgres://verification-secret" },
      redactionValues: ["postgres://verification-secret"],
    });
    await POST(
      callbackRequest({ event: "completed", orgId: "org-1", report }),
      { params: Promise.resolve({ runId }) },
    );

    await background.tasks[0]!();

    expect(runtimeSecrets.resolve).toHaveBeenCalledWith({
      orgId: "org-1",
      repository: "owner/repo",
      workspaceRoot: ".",
      bindings: runtimeConfig.secretBindings,
    });
    expect(tenki.verify).toHaveBeenCalledWith(
      runtimeContext,
      report,
      {
        runtimeEnvironment: {
          setupEnv: {},
          runtimeEnv: {},
          testEnv: { DATABASE_URL: "postgres://verification-secret" },
          redactionValues: ["postgres://verification-secret"],
        },
      },
    );
  });
});
