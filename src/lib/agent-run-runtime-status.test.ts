import { describe, expect, it } from "vitest";
import {
  getRuntimeVerificationBadgeClass,
  getRuntimeVerificationLabel,
  getRuntimeVerificationState,
} from "./agent-run-runtime-status";

describe("agent run runtime verification status", () => {
  it.each(["Queued", "Running", "Tests passed"] as const)(
    "shows runtime pending while a %s run has not returned evidence",
    (runStatus) => {
      const state = getRuntimeVerificationState(runStatus, undefined);

      expect(state).toBe("pending");
      expect(getRuntimeVerificationLabel(state)).toBe("Runtime pending");
      expect(getRuntimeVerificationBadgeClass(state)).toBe("medium");
    },
  );

  it("shows not configured only after a terminal run returns no runtime evidence", () => {
    expect(getRuntimeVerificationState("No changes", undefined)).toBe("not-configured");
  });

  it("shows a configured runtime as pending before its result is available", () => {
    expect(getRuntimeVerificationState("Draft PR opened", {
      configured: true,
      healthStatus: "not_configured",
      userStoryReplay: "not_required",
    })).toBe("pending");
  });

  it("prioritizes failed runtime evidence over the run lifecycle", () => {
    const state = getRuntimeVerificationState("Running", {
      configured: true,
      healthStatus: "passed",
      userStoryReplay: "failed",
    });

    expect(state).toBe("failed");
    expect(getRuntimeVerificationLabel(state)).toBe("Runtime failed");
    expect(getRuntimeVerificationBadgeClass(state)).toBe("high");
  });

  it("shows successful health evidence as passed when replay did not fail", () => {
    const state = getRuntimeVerificationState("Draft PR opened", {
      configured: true,
      healthStatus: "passed",
      userStoryReplay: "passed",
    });

    expect(state).toBe("passed");
    expect(getRuntimeVerificationLabel(state)).toBe("Runtime passed");
    expect(getRuntimeVerificationBadgeClass(state)).toBe("success");
  });
});
