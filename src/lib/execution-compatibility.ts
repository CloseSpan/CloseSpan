import {
  executionProfileExecutor,
  type ExecutionProfileConfig,
  type ExecutionProfileVersion,
} from "./execution-profile";
import type { TenkiRunnerSizingProbe } from "./tenki-runner-sizing-probe-repository";

export const compatibilityValidationKinds = [
  "managed_environment",
  "runner_probe",
] as const;

export type CompatibilityValidationKind =
  (typeof compatibilityValidationKinds)[number];

export interface ToolchainRequirement {
  name: string;
  constraint: string;
}

/**
 * Immutable requirements captured from repository-owned manifests at an exact
 * commit. The requirements travel with the detected execution-profile version
 * so later activation and execution never guess from the deployment host.
 */
export interface ExecutionCompatibilityRequirements {
  schemaVersion: 1;
  sourceSha: string;
  dependencyFingerprint: string;
  ecosystem: string;
  runtimeFamily: string | null;
  runtimeConstraint: string | null;
  packageManager: string | null;
  toolchains: ToolchainRequirement[];
  capabilities: string[];
  validationKind: CompatibilityValidationKind;
}

export type ExecutionCompatibilityStatus =
  | "compatible"
  | "validating"
  | "awaiting_environment"
  | "incompatible";

export interface ExecutionCompatibilityReadiness {
  status: ExecutionCompatibilityStatus;
  summary: string;
  detail: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function executionCompatibilityRequirements(
  evidence: Record<string, unknown> | null | undefined,
): ExecutionCompatibilityRequirements | null {
  if (!evidence) return null;
  const value = record(evidence.compatibilityRequirements);
  if (!value || value.schemaVersion !== 1) return null;
  const validationKind = value.validationKind;
  if (!compatibilityValidationKinds.includes(validationKind as CompatibilityValidationKind)) {
    return null;
  }
  if (
    typeof value.sourceSha !== "string"
    || typeof value.dependencyFingerprint !== "string"
    || typeof value.ecosystem !== "string"
  ) return null;
  const toolchains = Array.isArray(value.toolchains)
    ? value.toolchains.flatMap((item) => {
        const tool = record(item);
        return tool && typeof tool.name === "string" && typeof tool.constraint === "string"
          ? [{ name: tool.name, constraint: tool.constraint }]
          : [];
      })
    : [];
  return {
    schemaVersion: 1,
    sourceSha: value.sourceSha,
    dependencyFingerprint: value.dependencyFingerprint,
    ecosystem: value.ecosystem,
    runtimeFamily: typeof value.runtimeFamily === "string" ? value.runtimeFamily : null,
    runtimeConstraint: typeof value.runtimeConstraint === "string" ? value.runtimeConstraint : null,
    packageManager: typeof value.packageManager === "string" ? value.packageManager : null,
    toolchains,
    capabilities: Array.isArray(value.capabilities)
      ? value.capabilities.filter((item): item is string => typeof item === "string")
      : [],
    validationKind: validationKind as CompatibilityValidationKind,
  };
}

function managedEnvironmentEvidence(evidence: Record<string, unknown>): boolean {
  const managed = record(evidence.managedEnvironment);
  const digestRef = managed && typeof managed.registryDigestRef === "string"
    ? managed.registryDigestRef.trim()
    : "";
  return Boolean(
    managed
    && typeof managed.artifactId === "string"
    && (
      /@sha256:[a-f0-9]{64}$/i.test(digestRef)
      || /@[a-f0-9-]{36}$/i.test(digestRef)
    ),
  );
}

function requirementLabel(requirements: ExecutionCompatibilityRequirements | null): string {
  if (!requirements) return "the detected repository toolchain";
  const exact = requirements.toolchains
    .map((tool) => `${tool.name} ${tool.constraint}`)
    .join(", ");
  return exact || [requirements.runtimeFamily, requirements.runtimeConstraint]
    .filter(Boolean)
    .join(" ") || requirements.ecosystem;
}

function runtimeRequirementLabel(
  requirements: ExecutionCompatibilityRequirements | null,
): string {
  if (!requirements) return "the detected repository runtime";
  return [requirements.runtimeFamily, requirements.runtimeConstraint]
    .filter(Boolean)
    .join(" ") || requirements.ecosystem;
}

export function executionCompatibilityReadiness(input: {
  profile: Pick<ExecutionProfileVersion, "config" | "detectionEvidence">;
  probe?: TenkiRunnerSizingProbe | null;
  active?: boolean;
}): ExecutionCompatibilityReadiness {
  const requirements = executionCompatibilityRequirements(input.profile.detectionEvidence);
  const executor = executionProfileExecutor(input.profile.config);
  const label = requirementLabel(requirements);

  // Active immutable versions were already admitted by the activation gate.
  // This also keeps older profiles readable while detector v8 rolls out.
  if (input.active) {
    return {
      status: "compatible",
      summary: "Compatibility verified",
      detail: `${label} is bound to the active execution profile.`,
    };
  }

  if (executor.kind === "tenki_github_actions") {
    const probe = input.probe;
    if (!probe || ["Queued", "Dispatched", "Running"].includes(probe.status)) {
      return {
        status: "validating",
        summary: "Validating toolchain compatibility",
        detail: `CloseSpan is checking ${label} on the selected ${executor.platform} runner in the background.`,
      };
    }
    if (probe.status === "Completed" && probe.telemetry?.exitCode === 0) {
      return {
        status: "compatible",
        summary: "Compatibility verified",
        detail: `${label} and the repository commands passed on the selected ${executor.platform} runner.`,
      };
    }
    const message = probe.failureMessage
      ?? (probe.telemetry?.timedOut
        ? "The compatibility preflight timed out."
        : "The repository commands did not pass on the selected runner.");
    return {
      status: "incompatible",
      summary: "Compatibility needs attention",
      detail: message,
    };
  }

  if (managedEnvironmentEvidence(input.profile.detectionEvidence)) {
    const runtimeLabel = runtimeRequirementLabel(requirements);
    return {
      status: "compatible",
      summary: "Compatibility verified",
      detail: `${runtimeLabel} matched an independently validated, digest-pinned managed environment.`,
    };
  }
  return {
    status: "awaiting_environment",
    summary: "Preparing a compatible environment",
    detail: `CloseSpan is waiting for a validated managed environment that satisfies ${label}.`,
  };
}

export function runtimeConstraint(runtimeFamily: string | null, runtime: string | null): string | null {
  const value = runtime?.trim() ?? "";
  if (!value) return null;
  if (!runtimeFamily) return value;
  const withoutFamily = value.replace(new RegExp(`^${runtimeFamily}\\s*`, "i"), "").trim();
  return withoutFamily || null;
}

type VersionTuple = readonly [number, number, number];

function versionTuple(value: string): VersionTuple | null {
  const match = /(?:^|[^0-9])(\d{1,4})(?:\.(\d{1,4}))?(?:\.(\d{1,4}))?(?:[^0-9]|$)/.exec(value);
  return match
    ? [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)]
    : null;
}

function compareVersion(left: VersionTuple, right: VersionTuple): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function comparatorSatisfied(available: VersionTuple, raw: string): boolean {
  const match = /^(>=|<=|>|<|=|\^|~|~=)?\s*v?(\d+(?:\.\d+){0,2})(?:\.x)?$/i.exec(raw.trim());
  if (!match) return false;
  const required = versionTuple(match[2]);
  if (!required) return false;
  const comparison = compareVersion(available, required);
  switch (match[1] ?? "=") {
    case ">=": return comparison >= 0;
    case "<=": return comparison <= 0;
    case ">": return comparison > 0;
    case "<": return comparison < 0;
    case "^": return comparison >= 0 && available[0] === required[0];
    case "~":
    case "~=": return comparison >= 0
      && available[0] === required[0]
      && available[1] === required[1];
    default: {
      const specifiedParts = match[2].split(".").length;
      return specifiedParts === 1
        ? available[0] === required[0]
        : specifiedParts === 2
          ? available[0] === required[0] && available[1] === required[1]
          : comparison === 0;
    }
  }
}

/**
 * A deliberately small, fail-closed range evaluator for manifest runtime
 * constraints. Unknown syntax never becomes an implicit compatibility pass.
 */
export function runtimeVersionSatisfies(
  availableRuntime: string | null,
  requestedRuntime: string | null,
): boolean {
  if (!requestedRuntime?.trim()) return true;
  const available = availableRuntime ? versionTuple(availableRuntime) : null;
  if (!available) return false;
  const normalizedRequest = requestedRuntime
    .replace(/^[a-z][a-z0-9._-]*\s+/i, "")
    .trim();
  if (!normalizedRequest || normalizedRequest === "*") return true;
  return normalizedRequest.split(/\s*\|\|\s*/).some((group) => {
    const comparators = group
      .replace(/\s+-\s+/g, ",")
      .split(/[\s,]+/)
      .filter(Boolean);
    return comparators.length > 0
      && comparators.every((comparator) => comparatorSatisfied(available, comparator));
  });
}

export function compatibilityRequirementFromProfileConfig(
  config: Pick<ExecutionProfileConfig, "language" | "packageManager" | "runtimeVersion">,
): Pick<ExecutionCompatibilityRequirements, "ecosystem" | "runtimeFamily" | "runtimeConstraint" | "packageManager"> {
  const language = config.language.toLowerCase();
  const runtimeFamily = language === "javascript" || language === "typescript"
    ? "node"
    : language === "java" || language === "kotlin"
      ? "jvm"
      : language;
  return {
    ecosystem: language,
    runtimeFamily,
    runtimeConstraint: runtimeConstraint(runtimeFamily, config.runtimeVersion),
    packageManager: config.packageManager,
  };
}
