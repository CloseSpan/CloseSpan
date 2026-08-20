import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  complete: vi.fn(),
  fail: vi.fn(),
  context: vi.fn(),
  running: vi.fn(),
}));
const oidc = vi.hoisted(() => ({ verify: vi.fn(), assert: vi.fn() }));

vi.mock("@/lib/issue-runtime-verification", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/issue-runtime-verification")>();
  return {
    ...actual,
    completeIssueRuntimeVerification: runtime.complete,
    failIssueRuntimeVerification: runtime.fail,
    getIssueRuntimeVerificationContext: runtime.context,
    markIssueRuntimeVerificationRunning: runtime.running,
  };
});
vi.mock("@/lib/github-actions-oidc", () => ({
  verifyGithubActionsOidcToken: oidc.verify,
  assertGithubActionsRunIdentity: oidc.assert,
}));
vi.mock("@/lib/issue-runtime-verification-executor", () => ({
  TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH: ".github/workflows/closespan-runtime-verifier.yml",
  buildIssueRuntimeVerificationJob: vi.fn(() => ({
    schemaVersion: 1,
    kind: "issue_runtime_verification",
    runId,
    verificationPrompt: "Exercise the reported path.",
  })),
}));

import { NextRequest } from "next/server";
import { GET, POST } from "./route";

const runId = "11111111-1111-4111-8111-111111111111";
const baseSha = "a".repeat(40);
const context = {
  orgId: "org-1",
  runId,
  repository: "owner/repo",
  baseSha,
};

function request(method: "GET" | "POST", body?: unknown) {
  return new NextRequest(
    `https://app.closespan.com/api/internal/issue-runtime-verifications/${runId}?orgId=org-1`,
    {
      method,
      headers: {
        authorization: "Bearer github-oidc-token",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
}

describe("current-issue runtime verifier callbacks", () => {
  beforeEach(() => {
    runtime.complete.mockReset().mockResolvedValue(undefined);
    runtime.fail.mockReset().mockResolvedValue(undefined);
    runtime.context.mockReset().mockResolvedValue(context);
    runtime.running.mockReset().mockResolvedValue(undefined);
    oidc.verify.mockReset().mockResolvedValue({ run_id: "314" });
    oidc.assert.mockReset();
  });

  it("returns a secret-free job only after validating the workflow identity", async () => {
    const response = await GET(request("GET"), {
      params: Promise.resolve({ runId }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      kind: "issue_runtime_verification",
      runId,
    });
    expect(oidc.assert).toHaveBeenCalledWith(expect.objectContaining({
      repository: "owner/repo",
      workflowPath: ".github/workflows/closespan-runtime-verifier.yml",
    }));
  });

  it("records only an attested report whose workflow run matches the OIDC token", async () => {
    const report = {
      schemaVersion: 1,
      runId,
      baseSha,
      verificationMethod: "Runtime execution",
      runtimeRequiredReason: "The reported generated output depends on live simulator behavior.",
      outcome: "Confirmed current",
      summary: "The reported Post Context failure was reproduced in the iOS simulator.",
      expectedBehavior: "The generated result incorporates the supplied Post Context.",
      actualBehavior: "The generated result ignored the supplied Post Context.",
      reproductionSteps: ["Launch the app and enter Post Context before generating."],
      commands: [{ command: "xcodebuild test", status: "failed", output: "Assertion failed", durationMs: 1200 }],
      observations: ["The user-visible output omitted the supplied context."],
      artifacts: [{ name: "Simulator screenshot", path: ".closespan-run/artifacts/post-context.png", kind: "screenshot" }],
      environment: {
        platform: "macos",
        runnerLabel: "tenki-macos-15-medium",
        xcodeVersion: "Xcode 16.4",
        simulator: "iPhone 16",
        workflowRunId: 314,
      },
    };
    const response = await POST(request("POST", {
      event: "completed",
      orgId: "org-1",
      report,
    }), { params: Promise.resolve({ runId }) });

    expect(response.status).toBe(200);
    expect(oidc.assert).toHaveBeenLastCalledWith(expect.objectContaining({
      reportedWorkflowRunId: 314,
    }));
    expect(runtime.complete).toHaveBeenCalledWith(context, report);
  });

  it("rejects a callback when GitHub workflow identity validation fails", async () => {
    oidc.assert.mockImplementation(() => {
      throw new Error("workflow identity mismatch");
    });
    const response = await POST(request("POST", {
      event: "started",
      orgId: "org-1",
    }), { params: Promise.resolve({ runId }) });
    expect(response.status).toBe(409);
    expect(runtime.running).not.toHaveBeenCalled();
  });
});
