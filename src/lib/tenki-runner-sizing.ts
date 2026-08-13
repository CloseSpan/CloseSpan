import { z } from "zod";
import type {
  DetectedRepositoryProfileSuggestion,
} from "./repository-profile-detection";

export type TenkiRunnerPlatform = "linux" | "macos";

export interface TenkiRunnerSize {
  label: string;
  platform: TenkiRunnerPlatform;
  cpuCores: number;
  memoryMb: number;
  tier: number;
}

export const TENKI_RUNNER_SIZES = [
  { label: "tenki-standard-small-2c-4g", platform: "linux", cpuCores: 2, memoryMb: 4_096, tier: 0 },
  { label: "tenki-standard-medium-4c-8g", platform: "linux", cpuCores: 4, memoryMb: 8_192, tier: 1 },
  { label: "tenki-standard-large-8c-16g", platform: "linux", cpuCores: 8, memoryMb: 16_384, tier: 2 },
  { label: "tenki-standard-large-plus-16c-32g", platform: "linux", cpuCores: 16, memoryMb: 32_768, tier: 3 },
  { label: "tenki-macos-15-mini", platform: "macos", cpuCores: 3, memoryMb: 7_168, tier: 0 },
  { label: "tenki-macos-15-small", platform: "macos", cpuCores: 4, memoryMb: 14_336, tier: 1 },
  { label: "tenki-macos-15-medium", platform: "macos", cpuCores: 6, memoryMb: 28_672, tier: 2 },
  { label: "tenki-macos-15-large", platform: "macos", cpuCores: 12, memoryMb: 57_344, tier: 3 },
] as const satisfies readonly TenkiRunnerSize[];

export type TenkiRunnerLabel = (typeof TENKI_RUNNER_SIZES)[number]["label"];
export type TenkiWorkloadClass =
  | "lightweight"
  | "application"
  | "build_heavy"
  | "android_emulator"
  | "ios_simulator";

export interface TenkiRunnerWorkloadAssessment {
  workloadClass: TenkiWorkloadClass;
  platform: TenkiRunnerPlatform;
  baselineRunnerLabel: TenkiRunnerLabel;
  reasons: string[];
}

export const tenkiRunnerTelemetrySchema = z.object({
  durationMs: z.number().int().nonnegative().max(86_400_000),
  cpuSaturationRatio: z.number().min(0).max(10),
  memoryPressureRatio: z.number().min(0).max(10),
  peakMemoryMb: z.number().nonnegative().max(1_048_576),
  memoryLimitMb: z.number().positive().max(1_048_576),
  exitCode: z.number().int().min(-1).max(255),
  signal: z.string().trim().max(40).nullable(),
  oomKilled: z.boolean(),
  timedOut: z.boolean(),
  sampledAt: z.string().datetime(),
  samples: z.number().int().nonnegative().max(1_000_000),
}).strict();

export type TenkiRunnerTelemetry = z.infer<typeof tenkiRunnerTelemetrySchema>;

export interface TenkiRunnerRecommendation {
  currentRunnerLabel: TenkiRunnerLabel;
  recommendedRunnerLabel: TenkiRunnerLabel;
  shouldEscalate: boolean;
  reasons: string[];
}

export function tenkiRunnerSize(label: string): TenkiRunnerSize | null {
  return TENKI_RUNNER_SIZES.find((size) => size.label === label) ?? null;
}

export function assertTenkiRunnerLabel(
  label: string,
  platform?: TenkiRunnerPlatform,
): asserts label is TenkiRunnerLabel {
  const size = tenkiRunnerSize(label);
  if (!size || (platform && size.platform !== platform)) {
    throw new Error(
      platform
        ? `Select a documented Tenki ${platform} runner size`
        : "Select a documented Tenki runner size",
    );
  }
}

export function tenkiRunnerSizesForPlatform(
  platform: TenkiRunnerPlatform,
): TenkiRunnerSize[] {
  return TENKI_RUNNER_SIZES.filter((size) => size.platform === platform);
}

function baselineForTier(platform: TenkiRunnerPlatform, tier: number): TenkiRunnerLabel {
  const sizes = tenkiRunnerSizesForPlatform(platform);
  return sizes[Math.min(Math.max(tier, 0), sizes.length - 1)].label as TenkiRunnerLabel;
}

export function assessTenkiRunnerWorkload(
  detected: Pick<DetectedRepositoryProfileSuggestion,
    "platform" | "manifestPaths" | "commands" | "application" | "xcode" | "androidEmulator"
  >,
): TenkiRunnerWorkloadAssessment {
  if (detected.platform === "android") {
    const reasons = ["Android Emulator requires Linux x64 with nested KVM"];
    const buildText = [detected.commands.install, detected.commands.build, detected.commands.test]
      .filter(Boolean).join(" ").toLowerCase();
    const multiModule = detected.manifestPaths.filter((path) => /build\.gradle(?:\.kts)?$/.test(path)).length > 2;
    if (multiModule) reasons.push("Multiple Gradle modules increase compilation and daemon memory pressure");
    if (/connected|assemble|bundle/.test(buildText)) reasons.push("The detected workflow includes Android compilation or device tests");
    return {
      workloadClass: "android_emulator",
      platform: "linux",
      baselineRunnerLabel: baselineForTier("linux", multiModule ? 3 : 2),
      reasons,
    };
  }

  if (detected.platform === "ios") {
    const reasons = ["Xcode simulator builds require an Apple Silicon macOS runner"];
    const hasPods = detected.manifestPaths.some((path) => /(?:^|\/)Podfile(?:\.lock)?$/.test(path));
    const hasWorkspace = detected.xcode?.containerKind === "workspace";
    if (hasPods || hasWorkspace) reasons.push("Workspace dependencies increase Xcode build workload");
    return {
      workloadClass: "ios_simulator",
      platform: "macos",
      baselineRunnerLabel: baselineForTier("macos", hasPods || hasWorkspace ? 2 : 1),
      reasons,
    };
  }

  const commands = [detected.commands.install, detected.commands.build, detected.commands.test]
    .filter(Boolean).join(" ").toLowerCase();
  const manifestCount = detected.manifestPaths.length;
  const buildHeavy = manifestCount > 20 || /turbo|nx|bazel|webpack|next build|cargo build/.test(commands);
  if (buildHeavy) {
    return {
      workloadClass: "build_heavy",
      platform: "linux",
      baselineRunnerLabel: baselineForTier("linux", 2),
      reasons: ["Build tooling or repository breadth indicates parallel compilation work"],
    };
  }
  if (detected.application) {
    return {
      workloadClass: "application",
      platform: "linux",
      baselineRunnerLabel: baselineForTier("linux", 1),
      reasons: ["The repository includes a runnable application and validation commands"],
    };
  }
  return {
    workloadClass: "lightweight",
    platform: "linux",
    baselineRunnerLabel: baselineForTier("linux", 0),
    reasons: ["The detected validation path is a lightweight command workload"],
  };
}

export function recommendTenkiRunnerSize(input: {
  runnerLabel: string;
  telemetry: TenkiRunnerTelemetry;
}): TenkiRunnerRecommendation {
  assertTenkiRunnerLabel(input.runnerLabel);
  const current = tenkiRunnerSize(input.runnerLabel)!;
  const reasons: string[] = [];
  if (input.telemetry.exitCode === 137 || input.telemetry.oomKilled) {
    reasons.push("The probe was terminated by an out-of-memory condition");
  }
  if (input.telemetry.memoryPressureRatio >= 0.9) {
    reasons.push("Peak memory stayed above 90% of runner capacity");
  }
  if (input.telemetry.cpuSaturationRatio >= 0.9) {
    reasons.push("CPU utilization stayed above 90% of runner capacity");
  }
  const sizes = tenkiRunnerSizesForPlatform(current.platform);
  const next = sizes.find((size) => size.tier === current.tier + 1) ?? current;
  const shouldEscalate = reasons.length > 0 && next.label !== current.label;
  return {
    currentRunnerLabel: current.label as TenkiRunnerLabel,
    recommendedRunnerLabel: (shouldEscalate ? next.label : current.label) as TenkiRunnerLabel,
    shouldEscalate,
    reasons: reasons.length > 0
      ? reasons
      : ["The probe completed within the selected runner's CPU and memory capacity"],
  };
}
