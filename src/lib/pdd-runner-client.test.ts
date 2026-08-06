import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchPddVerification, probePddRunner } from "./pdd-runner-client";

vi.mock("./github-agent-publisher", () => ({
  createRepositoryArchiveUrl: vi.fn().mockResolvedValue("https://codeload.github.com/acme/app/tar.gz/abc"),
}));

describe("probePddRunner", () => {
  beforeEach(() => {
    vi.stubEnv("PDD_RUNNER_URL", "https://pdd.example");
    vi.stubEnv("PDD_RUNNER_SHARED_SECRET", "shared-secret");
    vi.stubEnv("CLOSESPAN_INTERNAL_BASE_URL", "https://closespan.example");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("attests health and the shared signing secret without creating a job", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "ok",
        pddVersion: "0.0.309",
        executionProfileSchemaVersions: [1, 2],
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 400 }));

    await expect(probePddRunner()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const signedRequest = fetchMock.mock.calls[1];
    expect(signedRequest?.[0]).toBe("https://pdd.example/verifications");
    expect((signedRequest?.[1]?.headers as Record<string, string>)["x-closespan-signature"])
      .toMatch(/^[a-f0-9]{64}$/);
  });

  it("reports a mismatched runner secret as unhealthy", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "ok",
        pddVersion: "0.0.309",
        executionProfileSchemaVersions: [1, 2],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(probePddRunner()).resolves.toBe(false);
  });

  it("retries a temporary unbound-route response but never an accepted job", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));

    await expect(dispatchPddVerification({
      orgId: "org-1",
      problemId: "problem-1",
      verificationId: "verification-1",
      repository: "acme/app",
      installationId: "installation-1",
      baseBranch: "main",
      baseSha: "a".repeat(40),
      promptId: "prompt-1",
      promptHash: "b".repeat(64),
      userStory: "As a user, I can retry safely.",
      pddPrompt: "Generate the acceptance test.",
      pddVersion: "0.0.309",
      budgetUsd: 0.25,
      permittedPaths: ["src/**"],
      requiredCommands: ["npm test"],
      suspectedFiles: ["src/app.ts"],
      executionProfileId: "profile-1",
      executionProfileHash: "c".repeat(64),
      executionProfileSnapshot: {} as never,
    })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
