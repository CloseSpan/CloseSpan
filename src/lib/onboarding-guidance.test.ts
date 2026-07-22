import { describe, expect, it } from "vitest";
import {
  deriveOnboardingPhase,
  resolvedConnectorFailure,
} from "./onboarding-guidance";

describe("deriveOnboardingPhase", () => {
  it("uses live intake readiness instead of a stale persisted connect phase", () => {
    expect(
      deriveOnboardingPhase({
        persistedPhase: "connect",
        hasProductBrief: true,
        feedbackConnected: true,
        feedbackCount: 0,
      }),
    ).toBe("verify");
  });

  it("preserves an explicit continue-for-now decision", () => {
    expect(
      deriveOnboardingPhase({
        persistedPhase: "complete",
        hasProductBrief: true,
        feedbackConnected: false,
        feedbackCount: 0,
      }),
    ).toBe("complete");
  });
});

describe("resolvedConnectorFailure", () => {
  const messages = [
    {
      role: "assistant" as const,
      content: "GitHub failed to connect. Try OAuth again.",
      at: "2026-07-20T17:00:00.000Z",
    },
  ];

  it("detects when live connector truth supersedes stale chat", () => {
    expect(
      resolvedConnectorFailure({
        provider: "GitHub",
        connected: true,
        messages,
      }),
    ).toBe(true);
  });

  it("does not hide failure guidance while the connector is disconnected", () => {
    expect(
      resolvedConnectorFailure({
        provider: "GitHub",
        connected: false,
        messages,
      }),
    ).toBe(false);
  });
});
