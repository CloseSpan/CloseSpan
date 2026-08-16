import { describe, expect, it } from "vitest";
import { decideCompatibleRunnerProbeRetry } from "./tenki-runner-probe-retry";

const candidates = [
  { label: "tenki-macos-xcode-26-small", cpuCores: 4, memoryMb: 14_336 },
  { label: "tenki-macos-xcode-26-medium", cpuCores: 6, memoryMb: 21_504 },
  { label: "tenki-macos-xcode-26-large", cpuCores: 8, memoryMb: 28_672 },
];

describe("compatible runner probe retries", () => {
  it("advances after a generic command failure", () => {
    expect(decideCompatibleRunnerProbeRetry({
      currentRunnerLabel: candidates[0].label,
      compatibleCandidates: candidates,
      failureCode: "command_failed",
      failureMessage: "xcodebuild exited with status 65",
    })).toMatchObject({
      retry: true,
      exhausted: false,
      nextCandidate: candidates[1],
      attemptedCandidateNumber: 1,
      compatibleCandidateCount: 3,
    });
  });

  it("advances after an explicit toolchain validation failure", () => {
    const decision = decideCompatibleRunnerProbeRetry({
      currentRunnerLabel: candidates[1].label,
      compatibleCandidates: candidates,
      failureCode: "toolchain_incompatible",
      failureMessage: "Runner Xcode 16.4 does not satisfy approved Xcode 26.1",
    });

    expect(decision.nextCandidate).toEqual(candidates[2]);
    expect(decision.recommendationReasons.join(" ")).toContain("toolchain_incompatible");
    expect(decision.recommendationReasons.join(" ")).toContain("3/3");
  });

  it("stops after the finite compatible candidate set is exhausted", () => {
    expect(decideCompatibleRunnerProbeRetry({
      currentRunnerLabel: candidates[2].label,
      compatibleCandidates: candidates,
      failureCode: "probe_failed",
      failureMessage: "The environment probe did not complete",
    })).toMatchObject({
      retry: false,
      exhausted: true,
      nextCandidate: null,
      attemptedCandidateNumber: 3,
      compatibleCandidateCount: 3,
    });
  });

  it("fails closed when the current runner is outside the approved candidate set", () => {
    const decision = decideCompatibleRunnerProbeRetry({
      currentRunnerLabel: "unapproved-runner",
      compatibleCandidates: candidates,
      failureCode: "probe_failed",
      failureMessage: "Unknown runner failed",
    });

    expect(decision).toMatchObject({ retry: false, exhausted: false, nextCandidate: null });
    expect(decision.recommendationReasons.at(-1)).toContain("refused");
  });

  it("bounds failure text stored in immutable evidence", () => {
    const decision = decideCompatibleRunnerProbeRetry({
      currentRunnerLabel: candidates[0].label,
      compatibleCandidates: candidates,
      failureCode: "probe_failed",
      failureMessage: "x".repeat(1_000),
    });

    expect(decision.recommendationReasons[0].length).toBeLessThan(500);
  });
});
