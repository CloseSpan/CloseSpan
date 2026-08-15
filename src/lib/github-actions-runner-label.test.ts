import { describe, expect, it } from "vitest";
import type { ExecutionProfileExecutor } from "./execution-profile";
import { githubActionsRunnerLabel } from "./github-actions-runner-label";

type GithubActionsExecutor = Extract<
  ExecutionProfileExecutor,
  { kind: "tenki_github_actions" }
>;

const macosExecutor: GithubActionsExecutor = {
  kind: "tenki_github_actions",
  platform: "macos",
  architecture: "arm64",
  runnerLabel: "tenki-macos-15-small",
  workflowPath: ".github/workflows/closespan-agent-runner.yml",
  workflowSha256: null,
  xcode: null,
  androidEmulator: null,
};

describe("GitHub Actions runner label resolution", () => {
  it("does not pass a macOS capacity selector directly to runs-on", () => {
    expect(githubActionsRunnerLabel(macosExecutor)).toBe("macos-15");
  });

  it("routes an Xcode 26 profile to the compatible hosted macOS image", () => {
    expect(githubActionsRunnerLabel({
      ...macosExecutor,
      xcode: {
        version: "26.1",
        containerKind: "project",
        containerPath: "App.xcodeproj",
        scheme: "App",
        configuration: "Debug",
        destination: "platform=iOS Simulator,name=iPhone 16",
        sdk: "iphonesimulator",
        signingPolicy: "simulator_only",
      },
    })).toBe("macos-26");
  });

  it("preserves an explicitly onboarded macOS custom label", () => {
    expect(githubActionsRunnerLabel({
      ...macosExecutor,
      runnerLabel: "tenki-macos-xcode-16",
    })).toBe("tenki-macos-xcode-16");
  });

  it("preserves documented Linux Tenki runner labels", () => {
    expect(githubActionsRunnerLabel({
      ...macosExecutor,
      platform: "linux",
      architecture: "x64",
      runnerLabel: "tenki-standard-medium-4c-8g",
    })).toBe("tenki-standard-medium-4c-8g");
  });
});
