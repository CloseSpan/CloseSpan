import { beforeEach, describe, expect, it } from "vitest";
import { sanitizeExecutionProfileConfig, type ExecutionProfileVersion } from "./execution-profile";
import {
  completeTenkiRunnerSizingProbe,
  listTenkiRunnerSizingProbes,
  markTenkiRunnerSizingProbeDispatched,
  markTenkiRunnerSizingProbeRunning,
  queueTenkiRunnerSizingProbe,
  resetMemoryTenkiRunnerSizingProbes,
} from "./tenki-runner-sizing-probe-repository";

function profile(): ExecutionProfileVersion {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    orgId: "org_demo",
    repository: "acme/app",
    workspaceRoot: ".",
    version: 1,
    source: "detected",
    config: sanitizeExecutionProfileConfig({
      schemaVersion: 3,
      language: "kotlin",
      packageManager: "gradle",
      workingDirectory: ".",
      testCommands: ["./gradlew test"],
      permittedPaths: ["**/*"],
      cpuCores: 8,
      memoryMb: 16_384,
      executor: {
        kind: "tenki_github_actions",
        platform: "linux",
        architecture: "x64",
        runnerLabel: "tenki-standard-large-8c-16g",
        workflowPath: ".github/workflows/closespan-agent-runner.yml",
        workflowSha256: "a".repeat(64),
        xcode: null,
        androidEmulator: {
          apiLevel: 35,
          target: "google_apis",
          architecture: "x86_64",
          deviceProfile: "pixel_8",
          gradleTask: ":app:connectedDebugAndroidTest",
        },
      },
    }),
    contentHash: "b".repeat(64),
    parentProfileId: null,
    detectionEvidence: {},
    createdBy: "system:test",
    createdAt: new Date().toISOString(),
  };
}

describe("Tenki runner sizing probe persistence", () => {
  beforeEach(() => resetMemoryTenkiRunnerSizingProbes());

  it("persists the dispatch lifecycle, telemetry, and next-tier recommendation", async () => {
    const queued = await queueTenkiRunnerSizingProbe({
      orgId: "org_demo",
      profile: profile(),
      sourceSha: "c".repeat(40),
      workflowPath: ".github/workflows/closespan-runner-sizing.yml",
      workflowSha256: "d".repeat(64),
      runnerLabel: "tenki-standard-large-8c-16g",
      workloadClass: "android_emulator",
      workloadReasons: ["Android Emulator requires nested KVM"],
      probeCommands: ["./gradlew test"],
      workingDirectory: ".",
    });
    expect(queued.status).toBe("Queued");
    await markTenkiRunnerSizingProbeDispatched({ orgId: "org_demo", probeId: queued.id });
    await markTenkiRunnerSizingProbeRunning({ orgId: "org_demo", probeId: queued.id, githubWorkflowRunId: 91 });
    const completed = await completeTenkiRunnerSizingProbe({
      orgId: "org_demo",
      probeId: queued.id,
      githubWorkflowRunId: 91,
      telemetry: {
        durationMs: 80_000,
        cpuSaturationRatio: 0.95,
        memoryPressureRatio: 0.92,
        peakMemoryMb: 15_073,
        memoryLimitMb: 16_384,
        exitCode: 0,
        signal: null,
        oomKilled: false,
        timedOut: false,
        sampledAt: new Date().toISOString(),
        samples: 80,
      },
    });
    expect(completed).toMatchObject({
      status: "Completed",
      recommendedRunnerLabel: "tenki-standard-large-plus-16c-32g",
      githubWorkflowRunId: 91,
    });
    await expect(listTenkiRunnerSizingProbes("org_demo")).resolves.toHaveLength(1);
  });
});
