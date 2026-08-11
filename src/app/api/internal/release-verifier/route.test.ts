import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hashReleaseVerificationPlan } from "@/lib/release-verification-plan";

const lifecycle = vi.hoisted(() => ({
  claim: vi.fn(),
  complete: vi.fn(),
  getJob: vi.fn(),
}));
const verifier = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/lib/release-lifecycle-repository", () => ({
  claimPostReleaseVerificationExecution: lifecycle.claim,
  completePostReleaseVerification: lifecycle.complete,
  getReleaseVerifierJob: lifecycle.getJob,
}));
vi.mock("@/lib/tenki-release-verifier", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/tenki-release-verifier")>();
  return { ...original, executeTenkiReleaseVerification: verifier.execute };
});

import { POST } from "./route";

const executorSecret = "release-executor-secret-for-tests";
const callbackSecret = "release-callback-secret-for-tests";
const dispatch = {
  schemaVersion: 1,
  jobId: "11111111-1111-4111-8111-111111111111",
  orgId: "org-1",
};
const plan = {
  schemaVersion: 1 as const,
  kind: "ui" as const,
  viewports: [{ name: "desktop", width: 1440, height: 900 }],
  journeys: [{ id: "home", name: "Home", path: "/", actions: [], assertions: [], captureScreenshot: true }],
  failOnConsoleError: true,
  failOnPageError: true,
  accessibility: { requireImageAlt: true, requireControlNames: true, requireInputLabels: true },
  maxLayoutDifferenceRatio: 0.08,
};
const fullJob = {
  ...dispatch,
  problemId: "problem-1",
  agentRunId: "22222222-2222-4222-8222-222222222222",
  repository: "acme/app",
  environment: "production",
  deploymentSha: "b".repeat(40),
  approvedHeadSha: "a".repeat(40),
  baseUrl: "https://app.example.com",
  verificationInstructions: "Verify production.",
  plan,
  baseline: {
    schemaVersion: 1,
    planHash: hashReleaseVerificationPlan(plan),
    headSha: "a".repeat(40),
    capturedAt: "2026-08-10T20:00:00.000Z",
    captures: [],
  },
  callbackUrl: `https://closespan.example/api/internal/release-verifications/${dispatch.jobId}`,
  expiresAt: "2099-08-10T21:00:00.000Z",
};

function request(signature = "") {
  const body = JSON.stringify(dispatch);
  return new NextRequest("http://localhost/api/internal/release-verifier", {
    method: "POST",
    headers: { "content-type": "application/json", "x-closespan-signature": signature },
    body,
  });
}

describe("release verifier executor boundary", () => {
  beforeEach(() => {
    vi.stubEnv("RELEASE_VERIFIER_EXECUTOR_SHARED_SECRET", executorSecret);
    vi.stubEnv("RELEASE_VERIFIER_SHARED_SECRET", callbackSecret);
    lifecycle.claim.mockReset().mockResolvedValue("claimed");
    lifecycle.complete.mockReset().mockResolvedValue(undefined);
    lifecycle.getJob.mockReset().mockResolvedValue(fullJob);
    verifier.execute.mockReset().mockResolvedValue({
      status: "Passed",
      evidence: "Production backend and frontend matched.",
      result: {
        schemaVersion: 2,
        backend: { required: true, status: "Passed", checks: [] },
        frontend: { required: true, status: "Passed", checks: [], captures: [] },
        captures: [],
        checks: [],
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("rejects an unsigned dispatch before claiming a durable job", async () => {
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(lifecycle.claim).not.toHaveBeenCalled();
  });

  it("executes a signed claimed job and submits the verifier evidence", async () => {
    const body = JSON.stringify(dispatch);
    const signature = createHmac("sha256", executorSecret).update(body).digest("hex");
    const response = await POST(request(signature));
    expect(response.status).toBe(200);
    expect(verifier.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: fullJob.jobId,
        plan: expect.objectContaining({ schemaVersion: 2, kind: "combined" }),
      }),
      expect.objectContaining({ storageState: undefined, syntheticBearerToken: undefined }),
    );
    expect(fetch).toHaveBeenCalledWith(fullJob.callbackUrl, expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ authorization: `Bearer ${callbackSecret}` }),
    }));
  });

  it("treats a repeated delivery for a terminal job as an idempotent success", async () => {
    lifecycle.claim.mockResolvedValueOnce("terminal");
    const body = JSON.stringify(dispatch);
    const signature = createHmac("sha256", executorSecret).update(body).digest("hex");
    const response = await POST(request(signature));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ duplicate: true });
    expect(verifier.execute).not.toHaveBeenCalled();
  });

  it("delivers the synthetic bearer only through the Tenki execution environment", async () => {
    vi.stubEnv("RELEASE_VERIFIER_SYNTHETIC_BEARER_TOKEN", "synthetic-test-token");
    const body = JSON.stringify(dispatch);
    const signature = createHmac("sha256", executorSecret).update(body).digest("hex");
    const response = await POST(request(signature));
    expect(response.status).toBe(200);
    expect(verifier.execute).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ syntheticBearerToken: "synthetic-test-token" }),
    );
    expect(lifecycle.getJob.mock.calls.flat().join(" ")).not.toContain("synthetic-test-token");
  });
});
