import { afterEach, describe, expect, it, vi } from "vitest";
import {
  issueAgentRunnerModelToken,
  verifyAgentRunnerModelToken,
} from "./agent-runner-model-token";

const input = {
  runId: "11111111-1111-4111-8111-111111111111",
  orgId: "org-1",
  repository: "owner/repo",
  promptHash: "a".repeat(64),
  executionProfileHash: "b".repeat(64),
  provider: "openai" as const,
  model: "gpt-5.6-terra",
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("approval-bound runner model tokens", () => {
  it("issues a 70-minute token carrying the immutable run bindings", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T20:00:00.000Z"));
    vi.stubEnv("AGENT_EXECUTOR_SHARED_SECRET", "s".repeat(64));

    const issued = await issueAgentRunnerModelToken(input);
    const claims = await verifyAgentRunnerModelToken(issued.token);

    expect(issued.expiresAt).toBe("2026-08-11T21:10:00.000Z");
    expect(claims).toMatchObject({
      sub: input.runId,
      orgId: input.orgId,
      repository: input.repository,
      promptHash: input.promptHash,
      executionProfileHash: input.executionProfileHash,
      provider: "openai",
      model: input.model,
    });
  });

  it("cannot be verified after the server signing secret changes", async () => {
    vi.stubEnv("AGENT_EXECUTOR_SHARED_SECRET", "a".repeat(64));
    const issued = await issueAgentRunnerModelToken(input);

    vi.stubEnv("AGENT_EXECUTOR_SHARED_SECRET", "b".repeat(64));
    await expect(verifyAgentRunnerModelToken(issued.token)).rejects.toThrow();
  });

  it("refuses to issue tokens without a high-entropy server secret", async () => {
    vi.stubEnv("AGENT_EXECUTOR_SHARED_SECRET", "too-short");
    await expect(issueAgentRunnerModelToken(input)).rejects.toThrow(
      "AGENT_EXECUTOR_SHARED_SECRET",
    );
  });
});
