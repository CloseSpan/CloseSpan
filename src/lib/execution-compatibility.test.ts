import { describe, expect, it } from "vitest";
import {
  executionCompatibilityReadiness,
  runtimeConstraint,
  runtimeVersionSatisfies,
} from "./execution-compatibility";

const genericProfile = {
  config: {
    schemaVersion: 2 as const,
    language: "python",
    packageManager: "uv",
    runtimeVersion: "python >=3.12",
  },
  detectionEvidence: {
    compatibilityRequirements: {
      schemaVersion: 1,
      sourceSha: "a".repeat(40),
      dependencyFingerprint: "b".repeat(64),
      ecosystem: "python",
      runtimeFamily: "python",
      runtimeConstraint: ">=3.12",
      packageManager: "uv",
      toolchains: [],
      capabilities: [],
      validationKind: "managed_environment",
    },
  },
};

describe("execution compatibility", () => {
  it("keeps manifest runtime constraints separate from the runtime family", () => {
    expect(runtimeConstraint("node", "node >=22.13.0")).toBe(">=22.13.0");
    expect(runtimeConstraint("python", "python >=3.12,<3.14")).toBe(">=3.12,<3.14");
  });

  it("fails closed when a managed runtime does not satisfy the manifest range", () => {
    expect(runtimeVersionSatisfies("node 22.13.1", "node >=22.13.0 <23")).toBe(true);
    expect(runtimeVersionSatisfies("node 22.12.0", "node >=22.13.0 <23")).toBe(false);
    expect(runtimeVersionSatisfies("python 3.13.2", "python >=3.12,<3.14")).toBe(true);
    expect(runtimeVersionSatisfies("python latest", "python >=3.12")).toBe(false);
  });

  it("waits for a validated managed environment", () => {
    expect(executionCompatibilityReadiness({ profile: genericProfile as never })).toMatchObject({
      status: "awaiting_environment",
      summary: "Preparing a compatible environment",
    });
  });

  it("accepts a digest-pinned managed environment", () => {
    expect(executionCompatibilityReadiness({
      profile: {
        ...genericProfile,
        detectionEvidence: {
          ...genericProfile.detectionEvidence,
          managedEnvironment: {
            artifactId: "environment-1",
            registryDigestRef: `registry.example/python@sha256:${"c".repeat(64)}`,
          },
        },
      } as never,
    })).toMatchObject({ status: "compatible" });
  });

  it("requires a successful real runner probe", () => {
    const runnerProfile = {
      config: {
        schemaVersion: 3,
        language: "swift",
        packageManager: "xcode",
        runtimeVersion: "xcode 16",
        executor: { kind: "tenki_github_actions", platform: "macos" },
      },
      detectionEvidence: {
        compatibilityRequirements: {
          schemaVersion: 1,
          sourceSha: "a".repeat(40),
          dependencyFingerprint: "b".repeat(64),
          ecosystem: "ios",
          runtimeFamily: "ios",
          runtimeConstraint: null,
          packageManager: "xcode",
          toolchains: [{ name: "Xcode", constraint: "16" }],
          capabilities: ["ios-simulator"],
          validationKind: "runner_probe",
        },
      },
    };
    expect(executionCompatibilityReadiness({ profile: runnerProfile as never })).toMatchObject({
      status: "validating",
    });
    expect(executionCompatibilityReadiness({
      profile: runnerProfile as never,
      probe: { status: "Completed", telemetry: { exitCode: 0 } } as never,
    })).toMatchObject({ status: "compatible" });
  });
});
