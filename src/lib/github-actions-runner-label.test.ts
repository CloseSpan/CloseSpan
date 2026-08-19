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
  it("preserves a documented Tenki macOS 15 label for runs-on", () => {
    expect(githubActionsRunnerLabel(macosExecutor)).toBe("tenki-macos-15-small");
  });

  it("preserves a documented Tenki macOS 26 label for runs-on", () => {
    expect(githubActionsRunnerLabel({
      ...macosExecutor,
      runnerLabel: "tenki-macos-26-small",
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
    })).toBe("tenki-macos-26-small");
  });

  it("preserves an explicitly onboarded macOS custom label", () => {
    expect(githubActionsRunnerLabel({
      ...macosExecutor,
      runnerLabel: "tenki-macos-xcode-16",
    })).toBe("tenki-macos-xcode-16");
  });

  it("preserves an inventory-selected Xcode 26 Tenki label", () => {
    expect(githubActionsRunnerLabel({
      ...macosExecutor,
      runnerLabel: "tenki-macos-xcode-26",
      xcode: {
        version: "26.1",
        containerKind: "project",
        containerPath: "App.xcodeproj",
        scheme: "App",
        configuration: "Debug",
        destination: "generic/platform=iOS Simulator",
        sdk: "iphonesimulator",
        signingPolicy: "simulator_only",
      },
    })).toBe("tenki-macos-xcode-26");
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
