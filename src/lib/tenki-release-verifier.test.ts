import { afterEach, describe, expect, it, vi } from "vitest";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import {
  executeTenkiReleaseVerification,
  TENKI_RELEASE_VERIFIER_RUNNER_SOURCE,
} from "./tenki-release-verifier";
import {
  hashReleaseVerificationPlan,
  releaseVerificationPlanSchema,
} from "./release-verification-plan";

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
const backendCheck = {
  id: "application-health",
  name: "Application and database health",
  method: "GET" as const,
  path: "/api/health",
  statusCode: 200,
  durationMs: 42,
  passed: true,
  failures: [],
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

  it("keeps the generated Tenki runner syntactically valid", () => {
    const diagnostics = transpileModule(TENKI_RELEASE_VERIFIER_RUNNER_SOURCE, {
      compilerOptions: { allowJs: true, target: ScriptTarget.ES2022, module: ModuleKind.ESNext },
      reportDiagnostics: true,
    }).diagnostics ?? [];
    expect(diagnostics.filter((diagnostic) => diagnostic.category === 1)).toEqual([]);
  });

  it("runs in a fresh outbound-only VM and passes a matching approved layout", async () => {
    vi.stubEnv("TENKI_API_KEY", "tenki-test-key");
    vi.stubEnv("TENKI_RELEASE_VERIFIER_IMAGE", "registry.example/release-verifier@sha256:abc");
    vi.stubEnv("RELEASE_VERIFIER_ALLOWED_HOSTS", "app.example.com");
    const session = {
      inboundEnabled: false,
      outboundEnabled: true,
      writeFile: vi.fn<(path: string, content: string) => Promise<void>>().mockResolvedValue(undefined),
      exec: vi.fn(async () => ({ exitCode: 0, stderr: new Uint8Array() })),
      readFile: vi.fn(async () => new TextEncoder().encode(JSON.stringify({ backendChecks: [backendCheck], captures: [capture] }))),
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
    expect(result.result.backend.status).toBe("Passed");
    expect(result.result.frontend.status).toBe("Passed");
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
      readFile: vi.fn(async () => new TextEncoder().encode(JSON.stringify({ backendChecks: [backendCheck], captures: [shifted] }))),
      close: vi.fn(async () => undefined),
    };
    const result = await executeTenkiReleaseVerification(job, {
      createClient: () => ({ createAndWait: async () => session, close: vi.fn() }) as never,
    });
    expect(result.status).toBe("Failed");
    expect(result.evidence).toContain("approved-layout");
  });

  it("fails the combined decision when backend verification fails but frontend passes", async () => {
    vi.stubEnv("TENKI_API_KEY", "tenki-test-key");
    vi.stubEnv("TENKI_RELEASE_VERIFIER_IMAGE", "registry.example/release-verifier@sha256:abc");
    vi.stubEnv("RELEASE_VERIFIER_ALLOWED_HOSTS", "app.example.com");
    const failedBackend = {
      ...backendCheck,
      statusCode: 503,
      passed: false,
      failures: ["Expected HTTP 200 but received 503"],
    };
    const session = {
      inboundEnabled: false,
      outboundEnabled: true,
      writeFile: vi.fn(async () => undefined),
      exec: vi.fn(async () => ({ exitCode: 0, stderr: new Uint8Array() })),
      readFile: vi.fn(async () => new TextEncoder().encode(JSON.stringify({ backendChecks: [failedBackend], captures: [capture] }))),
      close: vi.fn(async () => undefined),
    };
    const result = await executeTenkiReleaseVerification(job, {
      createClient: () => ({ createAndWait: async () => session, close: vi.fn() }) as never,
    });
    expect(result.status).toBe("Failed");
    expect(result.result.backend.status).toBe("Failed");
    expect(result.result.frontend.status).toBe("Passed");
    expect(result.evidence).toContain("backend:application-health");
  });

  it("injects synthetic credentials into the process environment without writing them into the job file", async () => {
    vi.stubEnv("TENKI_API_KEY", "tenki-test-key");
    vi.stubEnv("TENKI_RELEASE_VERIFIER_IMAGE", "registry.example/release-verifier@sha256:abc");
    vi.stubEnv("RELEASE_VERIFIER_ALLOWED_HOSTS", "app.example.com");
    const syntheticPlan = releaseVerificationPlanSchema.parse(plan);
    syntheticPlan.backend.checks[0]!.authProfile = "production-synthetic";
    const syntheticJob = {
      ...job,
      plan: syntheticPlan,
      baseline: {
        ...job.baseline,
        planHash: hashReleaseVerificationPlan(syntheticPlan),
      },
    };
    const session = {
      inboundEnabled: false,
      outboundEnabled: true,
      writeFile: vi.fn<(path: string, content: string) => Promise<void>>().mockResolvedValue(undefined),
      exec: vi.fn(async () => ({ exitCode: 0, stderr: new Uint8Array() })),
      readFile: vi.fn(async () => new TextEncoder().encode(JSON.stringify({ backendChecks: [backendCheck], captures: [capture] }))),
      close: vi.fn(async () => undefined),
    };
    const result = await executeTenkiReleaseVerification(syntheticJob, {
      syntheticBearerToken: "synthetic-production-token",
      createClient: () => ({ createAndWait: async () => session, close: vi.fn() }) as never,
    });
    expect(result.status).toBe("Passed");
    expect(session.exec).toHaveBeenCalledWith("node", expect.objectContaining({
      env: expect.objectContaining({ CLOSESPAN_RELEASE_SYNTHETIC_BEARER: "synthetic-production-token" }),
    }));
    const serializedJob = String(session.writeFile.mock.calls.find(([path]) => String(path).endsWith("job.json"))?.[1]);
    expect(serializedJob).not.toContain("synthetic-production-token");
  });

  it("records a bounded backend timeout as an independent backend failure", async () => {
    vi.stubEnv("TENKI_API_KEY", "tenki-test-key");
    vi.stubEnv("TENKI_RELEASE_VERIFIER_IMAGE", "registry.example/release-verifier@sha256:abc");
    vi.stubEnv("RELEASE_VERIFIER_ALLOWED_HOSTS", "app.example.com");
    const timeout = {
      ...backendCheck,
      statusCode: null,
      durationMs: 5_001,
      passed: false,
      failures: ["Backend request timed out"],
    };
    const session = {
      inboundEnabled: false,
      outboundEnabled: true,
      writeFile: vi.fn(async () => undefined),
      exec: vi.fn(async () => ({ exitCode: 0, stderr: new Uint8Array() })),
      readFile: vi.fn(async () => new TextEncoder().encode(JSON.stringify({ backendChecks: [timeout], captures: [capture] }))),
      close: vi.fn(async () => undefined),
    };
    const result = await executeTenkiReleaseVerification(job, {
      createClient: () => ({ createAndWait: async () => session, close: vi.fn() }) as never,
    });
    expect(result.status).toBe("Failed");
    expect(result.result.backend.status).toBe("Failed");
    expect(result.evidence).toContain("Backend request timed out");
  });
});
