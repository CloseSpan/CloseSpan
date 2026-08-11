import { afterEach, describe, expect, it, vi } from "vitest";
import { executeTenkiReleaseVerification } from "./tenki-release-verifier";
import { hashReleaseVerificationPlan } from "./release-verification-plan";

const plan = {
  schemaVersion: 1 as const,
  kind: "ui" as const,
  viewports: [{ name: "desktop", width: 1440, height: 900 }],
  journeys: [{
    id: "problem-page",
    name: "Problem page",
    path: "/problems/1",
    actions: [],
    assertions: [{ type: "visible" as const, selector: "h1" }],
    captureScreenshot: true,
  }],
  failOnConsoleError: true,
  failOnPageError: true,
  accessibility: { requireImageAlt: true, requireControlNames: true, requireInputLabels: true },
  maxLayoutDifferenceRatio: 0.08,
};

const layout = [{ key: "h1:Problem:1", text: "Problem", x: 20, y: 20, width: 300, height: 40, visible: true }];
const capture = {
  key: "problem-page:desktop",
  journeyId: "problem-page",
  viewport: plan.viewports[0]!,
  url: "https://app.example.com/problems/1",
  title: "Problem",
  screenshotBase64: "cG5n",
  screenshotSha256: "a".repeat(64),
  layout,
  consoleErrors: [],
  pageErrors: [],
  accessibilityViolations: [],
  assertionFailures: [],
};
const job = {
  schemaVersion: 1 as const,
  jobId: "11111111-1111-4111-8111-111111111111",
  orgId: "org-1",
  problemId: "problem-1",
  agentRunId: "22222222-2222-4222-8222-222222222222",
  repository: "acme/app",
  environment: "production",
  deploymentSha: "b".repeat(40),
  approvedHeadSha: "b".repeat(40),
  baseUrl: "https://app.example.com",
  verificationInstructions: "Verify the production problem page.",
  plan,
  baseline: {
    schemaVersion: 1 as const,
    planHash: hashReleaseVerificationPlan(plan),
    headSha: "b".repeat(40),
    capturedAt: "2026-08-10T20:00:00.000Z",
    captures: [capture],
  },
  callbackUrl: "https://closespan.example/api/internal/release-verifications/1",
  expiresAt: "2099-08-10T21:00:00.000Z",
};

describe("Tenki production UI verifier", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("runs in a fresh outbound-only VM and passes a matching approved layout", async () => {
    vi.stubEnv("TENKI_API_KEY", "tenki-test-key");
    vi.stubEnv("TENKI_RELEASE_VERIFIER_IMAGE", "registry.example/release-verifier@sha256:abc");
    vi.stubEnv("RELEASE_VERIFIER_ALLOWED_HOSTS", "app.example.com");
    const session = {
      inboundEnabled: false,
      outboundEnabled: true,
      writeFile: vi.fn(async () => undefined),
      exec: vi.fn(async () => ({ exitCode: 0, stderr: new Uint8Array() })),
      readFile: vi.fn(async () => new TextEncoder().encode(JSON.stringify({ captures: [capture] }))),
      close: vi.fn(async () => undefined),
    };
    const client = {
      createAndWait: vi.fn(async () => session),
      close: vi.fn(),
    };
    const result = await executeTenkiReleaseVerification(job, {
      createClient: () => client as never,
    });
    expect(result.status).toBe("Passed");
    expect(client.createAndWait).toHaveBeenCalledWith(expect.objectContaining({
      allowInbound: false,
      allowOutbound: true,
    }));
    expect(session.close).toHaveBeenCalledOnce();
  });

  it("refuses a baseline captured from another commit before starting Tenki", async () => {
    vi.stubEnv("RELEASE_VERIFIER_ALLOWED_HOSTS", "app.example.com");
    await expect(executeTenkiReleaseVerification({
      ...job,
      baseline: { ...job.baseline, headSha: "d".repeat(40) },
    })).rejects.toThrow("not bound to the deployed commit");
  });

  it("fails when production moves beyond the approved layout tolerance", async () => {
    vi.stubEnv("TENKI_API_KEY", "tenki-test-key");
    vi.stubEnv("TENKI_RELEASE_VERIFIER_IMAGE", "registry.example/release-verifier@sha256:abc");
    vi.stubEnv("RELEASE_VERIFIER_ALLOWED_HOSTS", "app.example.com");
    const shifted = { ...capture, layout: [{ ...layout[0]!, x: 1000 }] };
    const session = {
      inboundEnabled: false,
      outboundEnabled: true,
      writeFile: vi.fn(async () => undefined),
      exec: vi.fn(async () => ({ exitCode: 0, stderr: new Uint8Array() })),
      readFile: vi.fn(async () => new TextEncoder().encode(JSON.stringify({ captures: [shifted] }))),
      close: vi.fn(async () => undefined),
    };
    const result = await executeTenkiReleaseVerification(job, {
      createClient: () => ({ createAndWait: async () => session, close: vi.fn() }) as never,
    });
    expect(result.status).toBe("Failed");
    expect(result.evidence).toContain("approved-layout");
  });
});
