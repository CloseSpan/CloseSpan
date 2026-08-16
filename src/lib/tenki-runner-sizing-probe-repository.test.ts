import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeExecutionProfileConfig, type ExecutionProfileVersion } from "./execution-profile";
import {
  completeTenkiRunnerSizingProbe,
  listTenkiRunnerSizingProbes,
  markTenkiRunnerSizingProbeDispatched,
  markTenkiRunnerSizingProbeRunning,
  queueTenkiRunnerSizingProbe,
  resetMemoryTenkiRunnerSizingProbes,
} from "./tenki-runner-sizing-probe-repository";
import { queueAndDispatchTenkiRunnerSizingProbe } from "./tenki-runner-sizing-probe";

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

function iosProfile(workflowHash: string): ExecutionProfileVersion {
  return {
    ...profile(),
    id: "22222222-2222-4222-8222-222222222222",
    repository: "samshanmukh/zup",
    workspaceRoot: "ZupNative",
    config: sanitizeExecutionProfileConfig({
      schemaVersion: 3,
      language: "swift",
      packageManager: "xcode",
      workingDirectory: "ZupNative",
      buildCommands: ["xcodebuild build"],
      permittedPaths: ["ZupNative/**"],
      cpuCores: 4,
      memoryMb: 14_336,
      executor: {
        kind: "tenki_github_actions",
        platform: "macos",
        architecture: "arm64",
        runnerLabel: "tenki-macos-15-small",
        workflowPath: ".github/workflows/closespan-agent-runner.yml",
        workflowSha256: "a".repeat(64),
        xcode: {
          version: "26.1",
          containerKind: "project",
          containerPath: "Zup.xcodeproj",
          scheme: "Zup",
          configuration: "Debug",
          destination: "platform=iOS Simulator,name=iPhone 16",
          sdk: "iphonesimulator",
          signingPolicy: "simulator_only",
        },
        androidEmulator: null,
      },
    }),
    detectionEvidence: {
      sourceSha: "c".repeat(40),
      runnerProbeWorkflowSha256: workflowHash,
    },
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

  it("requeues a completed probe whose compatibility or workload command failed", async () => {
    const input = {
      orgId: "org_demo",
      profile: profile(),
      sourceSha: "c".repeat(40),
      workflowPath: ".github/workflows/closespan-runner-sizing.yml",
      workflowSha256: "d".repeat(64),
      runnerLabel: "tenki-standard-large-8c-16g",
      workloadClass: "application" as const,
      workloadReasons: ["Application build"],
      probeCommands: ["npm run build"],
      workingDirectory: ".",
    };
    const queued = await queueTenkiRunnerSizingProbe(input);
    await completeTenkiRunnerSizingProbe({
      orgId: "org_demo",
      probeId: queued.id,
      githubWorkflowRunId: 92,
      telemetry: {
        durationMs: 250,
        cpuSaturationRatio: 0.1,
        memoryPressureRatio: 0.1,
        peakMemoryMb: 256,
        memoryLimitMb: 16_384,
        exitCode: 1,
        signal: null,
        oomKilled: false,
        timedOut: false,
        sampledAt: new Date().toISOString(),
        samples: 1,
      },
    });

    await expect(queueTenkiRunnerSizingProbe(input)).resolves.toMatchObject({
      id: queued.id,
      status: "Queued",
      telemetry: null,
      githubWorkflowRunId: null,
      completedAt: null,
    });
  });

  it("maps a macOS capacity selector to an Xcode-compatible runner for sizing", async () => {
    const sizingWorkflow = "name: CloseSpan runner sizing probe\n";
    const workflowHash = createHash("sha256").update(sizingWorkflow).digest("hex");
    const createWorkflowDispatch = vi.fn().mockResolvedValue({ data: {} });
    const github = {
      rest: {
        repos: {
          getContent: vi.fn().mockResolvedValue({
            data: {
              type: "file",
              encoding: "base64",
              content: Buffer.from(sizingWorkflow).toString("base64"),
            },
          }),
        },
        git: {
          getRef: vi.fn().mockRejectedValue(Object.assign(new Error("not found"), { status: 404 })),
          createRef: vi.fn().mockResolvedValue({ data: {} }),
        },
        actions: { createWorkflowDispatch },
      },
    };

    const result = await queueAndDispatchTenkiRunnerSizingProbe({
      orgId: "org_demo",
      installationId: "installation-1",
      profile: iosProfile(workflowHash),
      sourceSha: "c".repeat(40),
      workflowSha256: workflowHash,
      workloadClass: "ios_simulator",
      workloadReasons: ["iOS Simulator build"],
      callbackBaseUrl: "https://closespan.example",
    }, { createClient: async () => github as never });

    expect(result.status).toBe("Dispatched");
    expect(result.runnerLabel).toBe("tenki-macos-15-small");
    expect(createWorkflowDispatch).toHaveBeenCalledWith(expect.objectContaining({
      inputs: expect.objectContaining({
        closespan_runner_label: "macos-26",
      }),
    }));
  });

  it("keeps an inventory-selected custom runner after a successful sizing probe", async () => {
    const custom = iosProfile("d".repeat(64));
    if (custom.config.schemaVersion !== 3) throw new Error("Expected a mobile execution profile");
    custom.config = sanitizeExecutionProfileConfig({
      ...custom.config,
      executor: {
        ...custom.config.executor,
        runnerLabel: "tenki-macos-xcode-26",
      },
    });
    const queued = await queueTenkiRunnerSizingProbe({
      orgId: "org_demo",
      profile: custom,
      sourceSha: "c".repeat(40),
      workflowPath: ".github/workflows/closespan-runner-sizing.yml",
      workflowSha256: "d".repeat(64),
      runnerLabel: "tenki-macos-xcode-26",
      workloadClass: "ios_simulator",
      workloadReasons: ["iOS Simulator build"],
      probeCommands: ["xcodebuild build"],
      workingDirectory: "ZupNative",
    });
    const completed = await completeTenkiRunnerSizingProbe({
      orgId: "org_demo",
      probeId: queued.id,
      githubWorkflowRunId: 93,
      telemetry: {
        durationMs: 60_000,
        cpuSaturationRatio: 0.45,
        memoryPressureRatio: 0.5,
        peakMemoryMb: 7_168,
        memoryLimitMb: 14_336,
        exitCode: 0,
        signal: null,
        oomKilled: false,
        timedOut: false,
        sampledAt: new Date().toISOString(),
        samples: 60,
      },
    });

    expect(completed).toMatchObject({
      status: "Completed",
      runnerLabel: "tenki-macos-xcode-26",
      recommendedRunnerLabel: "tenki-macos-xcode-26",
    });
  });

  it("records the next compatible inventory runner after resource pressure", async () => {
    const custom = iosProfile("d".repeat(64));
    const queued = await queueTenkiRunnerSizingProbe({
      orgId: "org_demo",
      profile: custom,
      sourceSha: "c".repeat(40),
      workflowPath: ".github/workflows/closespan-runner-sizing.yml",
      workflowSha256: "d".repeat(64),
      runnerLabel: "tenki-macos-xcode-26-small",
      workloadClass: "ios_simulator",
      workloadReasons: ["iOS Simulator build"],
      probeCommands: ["xcodebuild build"],
      workingDirectory: "ZupNative",
    });

    const completed = await completeTenkiRunnerSizingProbe({
      orgId: "org_demo",
      probeId: queued.id,
      githubWorkflowRunId: 94,
      recommendedRunnerLabel: "tenki-macos-xcode-26-large",
      recommendationReasons: ["The smaller compatible runner reached its memory limit"],
      telemetry: {
        durationMs: 60_000,
        cpuSaturationRatio: 0.8,
        memoryPressureRatio: 0.98,
        peakMemoryMb: 14_000,
        memoryLimitMb: 14_336,
        exitCode: 137,
        signal: "SIGKILL",
        oomKilled: true,
        timedOut: false,
        sampledAt: new Date().toISOString(),
        samples: 60,
      },
    });

    expect(completed).toMatchObject({
      status: "Completed",
      runnerLabel: "tenki-macos-xcode-26-small",
      recommendedRunnerLabel: "tenki-macos-xcode-26-large",
      recommendationReasons: ["The smaller compatible runner reached its memory limit"],
    });
  });
});
