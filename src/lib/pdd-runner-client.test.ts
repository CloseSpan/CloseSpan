import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchPddVerification,
  evaluatePromptWithPdd,
  probePddRunner,
} from "./pdd-runner-client";

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
        executionProfileSchemaVersions: [1, 2, 3],
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
        executionProfileSchemaVersions: [1, 2, 3],
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

  it("surfaces an actionable verification rejection from the runner", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      error: "The execution profile does not permit the generated test path",
    }), { status: 400, headers: { "content-type": "application/json" } }));

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
    })).rejects.toThrow("The execution profile does not permit the generated test path");
  });
});

describe("evaluatePromptWithPdd", () => {
  beforeEach(() => {
    vi.stubEnv("PDD_RUNNER_URL", "https://pdd.example");
    vi.stubEnv("PDD_RUNNER_SHARED_SECRET", "shared-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("submits asynchronously and polls for the final Prompt Testing verdict", async () => {
    let calls = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      calls += 1;
      const payload = JSON.parse(String(init?.body)) as {
        requestId: string;
        promptHash: string;
        evaluationMode?: string;
        budgetUsd?: number;
      };
      if (calls === 1) {
        expect(payload.evaluationMode).toBe("pdd_cloud_with_local_fallback");
        expect(payload.budgetUsd).toBe(5);
        return new Response(JSON.stringify({
          schemaVersion: 1,
          accepted: true,
          requestId: payload.requestId,
          promptHash: payload.promptHash,
          status: "Queued",
        }), { status: 202, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        schemaVersion: 1,
        requestId: payload.requestId,
        promptHash: payload.promptHash,
        verdict: "Needs revision",
        changes: ["Describe the corrected user-visible outcome."],
        pddVersion: "0.0.309",
        executionMode: "cloud",
        model: "pdd-cloud",
        costUsd: 0.02,
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    await expect(evaluatePromptWithPdd({
      promptHash: "a".repeat(64),
      userStory: "As a user, I want complete exports, so that I can analyze my data.",
      implementationPrompt: "Correct large CSV exports and prove the observable outcome.",
      pddVersion: "0.0.309",
      evaluationMode: "pdd_cloud_with_local_fallback",
    })).resolves.toMatchObject({
      verdict: "Needs revision",
      executionMode: "cloud",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://pdd.example/prompt-evaluations/status");
  });

  it("surfaces the runner's actionable failure instead of a generic HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      error: "Prompt Testing could not derive a test contract from the user story",
    }), { status: 502, headers: { "content-type": "application/json" } }));

    await expect(evaluatePromptWithPdd({
      promptHash: "b".repeat(64),
      userStory: "As a user, I want complete exports, so that I can analyze my data.",
      implementationPrompt: "Correct large CSV exports.",
      pddVersion: "0.0.309",
      evaluationMode: "pdd_local",
      localRuntime: {
        provider: "openai",
        model: "gpt-5.6-sol",
        apiKey: "workspace-openai-secret",
      },
    })).rejects.toThrow("Prompt Testing could not derive a test contract from the user story");
  });

  it("sends the workspace runtime only for a signed local evaluation", async () => {
    let calls = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      calls += 1;
      const payload = JSON.parse(String(init?.body)) as {
        requestId: string;
        promptHash: string;
        localRuntime?: { provider: string; model: string; apiKey: string };
      };
      if (calls === 1) {
        expect(payload.localRuntime).toEqual({
          provider: "openai",
          model: "gpt-5.6-sol",
          apiKey: "workspace-openai-secret",
        });
        expect((payload as { budgetUsd?: number }).budgetUsd).toBe(5);
        expect((init?.headers as Record<string, string>)["x-closespan-signature"])
          .toMatch(/^[a-f0-9]{64}$/);
        return new Response(JSON.stringify({
          schemaVersion: 1,
          accepted: true,
          requestId: payload.requestId,
          promptHash: payload.promptHash,
          status: "Queued",
        }), { status: 202, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        schemaVersion: 1,
        requestId: payload.requestId,
        promptHash: payload.promptHash,
        verdict: "Passed",
        changes: [],
        pddVersion: "0.0.309",
        executionMode: "local",
        model: "openai/gpt-5.6-sol",
        costUsd: 0.01,
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    await expect(evaluatePromptWithPdd({
      promptHash: "c".repeat(64),
      userStory: "As a user, I want reliable context, so that the workflow completes.",
      implementationPrompt: "Correct and verify the context workflow.",
      pddVersion: "0.0.309",
      evaluationMode: "pdd_local",
      localRuntime: {
        provider: "openai",
        model: "gpt-5.6-sol",
        apiKey: "workspace-openai-secret",
      },
    })).resolves.toMatchObject({ executionMode: "local" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the lower default budget for cloud-only prompt evaluation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as {
        requestId: string;
        promptHash: string;
        budgetUsd: number;
      };
      expect(payload.budgetUsd).toBe(0.25);
      return new Response(JSON.stringify({
        schemaVersion: 1,
        requestId: payload.requestId,
        promptHash: payload.promptHash,
        verdict: "Passed",
        changes: [],
        pddVersion: "0.0.309",
        executionMode: "cloud",
        model: "pdd-cloud",
        costUsd: 0.01,
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    await evaluatePromptWithPdd({
      promptHash: "e".repeat(64),
      userStory: "As a user, I want reliable context, so that the workflow completes.",
      implementationPrompt: "Correct and verify the context workflow.",
      pddVersion: "0.0.309",
      evaluationMode: "pdd_cloud",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("refuses to send workspace credentials over a non-local HTTP runner", async () => {
    vi.stubEnv("PDD_RUNNER_URL", "http://pdd.example");

    await expect(evaluatePromptWithPdd({
      promptHash: "d".repeat(64),
      userStory: "As a user, I want reliable context, so that the workflow completes.",
      implementationPrompt: "Correct and verify the context workflow.",
      pddVersion: "0.0.309",
      evaluationMode: "pdd_local",
      localRuntime: {
        provider: "openai",
        model: "gpt-5.6-sol",
        apiKey: "workspace-openai-secret",
      },
    })).rejects.toThrow("requires an HTTPS runner connection");
  });
});
