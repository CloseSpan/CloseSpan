import { describe, expect, it } from "vitest";
import { agentRunDispatchFailureCode } from "./agent-executor-client";

describe("agent run dispatch failures", () => {
  it("preserves stale approval bindings as a structured failure reason", () => {
    expect(agentRunDispatchFailureCode(
      "stale_base: repository branch moved after approval",
      "dispatch_failed",
    )).toBe("stale_base");
  });

  it("retains the caller fallback for unrelated dispatch failures", () => {
    expect(agentRunDispatchFailureCode(
      "GitHub Actions is unavailable",
      "autonomy_dispatch_failed",
    )).toBe("autonomy_dispatch_failed");
  });
});
