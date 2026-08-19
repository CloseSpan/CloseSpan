import { describe, expect, it } from "vitest";
import {
  assessTenkiRunnerWorkload,
  assertTenkiRunnerLabel,
  recommendTenkiRunnerSize,
} from "./tenki-runner-sizing";

function telemetry(overrides: Partial<Parameters<typeof recommendTenkiRunnerSize>[0]["telemetry"]> = {}) {
  return {
    durationMs: 12_000,
    cpuSaturationRatio: 0.5,
    memoryPressureRatio: 0.6,
    peakMemoryMb: 2_400,
    memoryLimitMb: 4_096,
    exitCode: 0,
    signal: null,
    oomKilled: false,
    timedOut: false,
    sampledAt: new Date().toISOString(),
    samples: 12,
    ...overrides,
  };
}

describe("Tenki runner sizing", () => {
  it("selects mobile baselines from the detected workload", () => {
    const ios = assessTenkiRunnerWorkload({
      platform: "ios",
      manifestPaths: ["Podfile", "App.xcworkspace/contents.xcworkspacedata"],
      commands: { install: null, build: "xcodebuild build", test: "xcodebuild test", typecheck: null },
      application: null,
      xcode: { version: "26.0", containerKind: "workspace", containerPath: "App.xcworkspace", scheme: "App", configuration: "Debug", destination: "platform=iOS Simulator" },
      androidEmulator: null,
    });
    const android = assessTenkiRunnerWorkload({
      platform: "android",
      manifestPaths: ["build.gradle.kts", "app/build.gradle.kts", "core/build.gradle.kts"],
      commands: { install: null, build: "./gradlew assembleDebug", test: "./gradlew connectedCheck", typecheck: null },
      application: null,
      xcode: null,
      androidEmulator: { apiLevel: 35, target: "google_apis", architecture: "x86_64", deviceProfile: "pixel_8", gradleTask: ":app:connectedDebugAndroidTest" },
    });
    expect(ios.baselineRunnerLabel).toBe("tenki-macos-15-medium");
    expect(android.baselineRunnerLabel).toBe("tenki-standard-large-plus-16c-32g");
  });

  it("recommends one larger tier after OOM or sustained pressure", () => {
    expect(recommendTenkiRunnerSize({
      runnerLabel: "tenki-standard-medium-4c-8g",
      telemetry: telemetry({ exitCode: 137, oomKilled: true, memoryPressureRatio: 0.98 }),
    })).toMatchObject({
      shouldEscalate: true,
      recommendedRunnerLabel: "tenki-standard-large-8c-16g",
    });
    expect(recommendTenkiRunnerSize({
      runnerLabel: "tenki-macos-15-small",
      telemetry: telemetry({ cpuSaturationRatio: 0.94 }),
    }).recommendedRunnerLabel).toBe("tenki-macos-15-medium");
    expect(recommendTenkiRunnerSize({
      runnerLabel: "tenki-macos-26-small",
      telemetry: telemetry({ cpuSaturationRatio: 0.94 }),
    }).recommendedRunnerLabel).toBe("tenki-macos-26-medium");
  });

  it("keeps a healthy runner and rejects undocumented labels", () => {
    expect(recommendTenkiRunnerSize({
      runnerLabel: "tenki-standard-small-2c-4g",
      telemetry: telemetry(),
    })).toMatchObject({ shouldEscalate: false, recommendedRunnerLabel: "tenki-standard-small-2c-4g" });
    expect(() => assertTenkiRunnerLabel("tenki-auto")).toThrow("documented Tenki runner size");
  });
});
