import { beforeEach, describe, expect, it } from "vitest";
import {
  boundedPddEstimate,
  readPddPromptTimingSummary,
  recordPddPromptEvaluationTiming,
  resetMemoryPddPromptTimings,
} from "./pdd-prompt-timing-repository";

describe("PDD prompt timing estimates", () => {
  beforeEach(() => {
    process.env.PERSISTENCE_MODE = "memory";
    resetMemoryPddPromptTimings();
  });

  it("uses a conservative default before a workspace has observed tests", async () => {
    await expect(readPddPromptTimingSummary("org_demo")).resolves.toEqual({
      estimatedDurationMs: 45_000,
      averageDurationMs: null,
      sampleCount: 0,
    });
  });

  it("averages successful workspace tests without learning from failures", async () => {
    await recordPddPromptEvaluationTiming({
      orgId: "org_demo",
      problemId: "prob_1",
      status: "Succeeded",
      durationMs: 20_000,
    });
    await recordPddPromptEvaluationTiming({
      orgId: "org_demo",
      problemId: "prob_1",
      status: "Failed",
      durationMs: 1_000,
    });
    await recordPddPromptEvaluationTiming({
      orgId: "org_demo",
      problemId: "prob_2",
      status: "Succeeded",
      durationMs: 40_000,
    });

    await expect(readPddPromptTimingSummary("org_demo")).resolves.toEqual({
      estimatedDurationMs: 30_000,
      averageDurationMs: 30_000,
      sampleCount: 2,
    });
  });

  it("keeps estimates within the runner's useful progress window", () => {
    expect(boundedPddEstimate(500)).toBe(4_000);
    expect(boundedPddEstimate(500_000)).toBe(240_000);
  });
});
