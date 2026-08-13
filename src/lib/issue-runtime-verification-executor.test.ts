import { afterEach, describe, expect, it } from "vitest";
import {
  runtimeVerificationRunnerLabel,
} from "./issue-runtime-verification-executor";
import type { ExecutionProfileExecutor } from "./execution-profile";

const executor: Extract<ExecutionProfileExecutor, { kind: "tenki_github_actions" }> = {
  kind: "tenki_github_actions",
  platform: "macos",
  architecture: "arm64",
  runnerLabel: "tenki-macos-15-small",
  workflowPath: ".github/workflows/closespan-runtime-verifier.yml",
  workflowSha256: null,
  xcode: null,
  androidEmulator: null,
};

afterEach(() => {
  delete process.env.RUNTIME_VERIFICATION_MACOS_RUNNER_LABEL;
});

describe("runtimeVerificationRunnerLabel", () => {
  it("uses the immutable profile label by default", () => {
    expect(runtimeVerificationRunnerLabel(executor)).toBe("tenki-macos-15-small");
  });

  it("uses an explicit macOS fallback label when configured", () => {
    process.env.RUNTIME_VERIFICATION_MACOS_RUNNER_LABEL = "macos-15";
    expect(runtimeVerificationRunnerLabel(executor)).toBe("macos-15");
  });

  it("selects a compatible GitHub macOS image for a newer Xcode requirement", () => {
    expect(runtimeVerificationRunnerLabel({
      ...executor,
      xcode: {
        version: "26.1",
        containerKind: "project",
        containerPath: "App.xcodeproj",
        scheme: "App",
        configuration: "Debug",
        sdk: "iphonesimulator",
        destination: "platform=iOS Simulator,name=iPhone 16",
        signingPolicy: "simulator_only",
      },
    })).toBe("macos-26");
  });

  it("rejects an unsafe override", () => {
    process.env.RUNTIME_VERIFICATION_MACOS_RUNNER_LABEL = "macos-15, self-hosted";
    expect(() => runtimeVerificationRunnerLabel(executor)).toThrow(
      "RUNTIME_VERIFICATION_MACOS_RUNNER_LABEL must be a valid GitHub Actions runner label",
    );
  });
});
