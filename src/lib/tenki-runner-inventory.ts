import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import { createGithubInstallationClient } from "./github-app-auth";
import {
  assertGithubActionsRunnerLabel,
  type GithubActionsRunnerProvider,
} from "./github-actions-runner-label";
import {
  tenkiRunnerSize,
  type TenkiRunnerPlatform,
  type TenkiRunnerWorkloadAssessment,
} from "./tenki-runner-sizing";

export type { GithubActionsRunnerProvider } from "./github-actions-runner-label";
export type RunnerInventorySource =
  | "github_self_hosted"
  | "deployment_catalog"
  | "deployment_override"
  | "github_hosted_fallback";

export interface AvailableRunnerInventoryEntry {
  label: string;
  provider: GithubActionsRunnerProvider;
  source: RunnerInventorySource;
  platform: TenkiRunnerPlatform;
  architecture: "arm64" | "x64";
  cpuCores: number | null;
  memoryMb: number | null;
  xcodeMajors: number[];
  androidApiLevels: number[];
  nestedKvm: boolean;
  online: boolean;
}

export interface RunnerSelection {
  label: string;
  provider: GithubActionsRunnerProvider;
  source: RunnerInventorySource;
  platform: TenkiRunnerPlatform;
  architecture: "arm64" | "x64";
  cpuCores: number;
  memoryMb: number;
  capacityLabel: string;
  fallbackReason: string | null;
  compatibleCandidateCount: number;
  compatibleCandidates: Array<{
    label: string;
    cpuCores: number;
    memoryMb: number;
  }>;
}

const configuredRunnerSchema = z.object({
  label: z.string().trim().regex(/^[A-Za-z0-9_.-]{1,120}$/),
  orgId: z.string().trim().min(1).optional(),
  repository: z.string().trim().regex(/^[^/]+\/[^/]+$/).optional(),
  platform: z.enum(["linux", "macos"]),
  architecture: z.enum(["arm64", "x64"]),
  cpuCores: z.number().int().positive().max(128).optional(),
  memoryMb: z.number().int().positive().max(1_048_576).optional(),
  xcodeMajors: z.array(z.number().int().positive().max(99)).max(20).default([]),
  androidApiLevels: z.array(z.number().int().positive().max(99)).max(50).default([]),
  nestedKvm: z.boolean().default(false),
}).strict();

function inferredXcodeMajors(label: string): number[] {
  const match = /(?:^|-)(?:xcode|macos)-(?<major>[0-9]{1,2})(?:$|-)/i.exec(label);
  const major = Number(match?.groups?.major);
  return Number.isInteger(major) && major > 0 ? [major] : [];
}

function inferredPlatform(label: string): TenkiRunnerPlatform {
  return /macos|xcode/i.test(label) ? "macos" : "linux";
}

function inferredArchitecture(label: string, platform: TenkiRunnerPlatform): "arm64" | "x64" {
  if (/x64|x86_64|amd64/i.test(label)) return "x64";
  if (/arm64|aarch64/i.test(label)) return "arm64";
  return platform === "macos" ? "arm64" : "x64";
}

function inferredEntry(
  label: string,
  source: Exclude<RunnerInventorySource, "github_hosted_fallback">,
  online = true,
): AvailableRunnerInventoryEntry {
  const size = tenkiRunnerSize(label);
  const platform = size?.platform ?? inferredPlatform(label);
  return {
    label,
    provider: "tenki",
    source,
    platform,
    architecture: inferredArchitecture(label, platform),
    cpuCores: size?.cpuCores ?? null,
    memoryMb: size?.memoryMb ?? null,
    xcodeMajors: inferredXcodeMajors(label),
    androidApiLevels: [],
    nestedKvm: platform === "linux" && /^tenki-standard-/i.test(label),
    online,
  };
}

export function configuredRunnerInventory(input: {
  orgId: string;
  repository: string;
  catalogJson?: string;
}): AvailableRunnerInventoryEntry[] {
  const raw = input.catalogJson ?? process.env.TENKI_RUNNER_CATALOG_JSON?.trim();
  const entries: AvailableRunnerInventoryEntry[] = [];
  if (raw) {
    const parsed = z.array(configuredRunnerSchema).max(500).parse(JSON.parse(raw));
    for (const entry of parsed) {
      if (entry.orgId && entry.orgId !== input.orgId) continue;
      if (entry.repository && entry.repository.toLowerCase() !== input.repository.toLowerCase()) continue;
      entries.push({
        label: entry.label,
        provider: "tenki",
        source: "deployment_catalog",
        platform: entry.platform,
        architecture: entry.architecture,
        cpuCores: entry.cpuCores ?? null,
        memoryMb: entry.memoryMb ?? null,
        xcodeMajors: entry.xcodeMajors,
        androidApiLevels: entry.androidApiLevels,
        nestedKvm: entry.nestedKvm,
        online: true,
      });
    }
  }

  for (const label of [
    process.env.TENKI_MACOS_RUNNER_LABEL?.trim(),
    process.env.TENKI_ANDROID_RUNNER_LABEL?.trim(),
  ]) {
    if (!label || entries.some((entry) => entry.label === label)) continue;
    assertGithubActionsRunnerLabel(label);
    entries.push(inferredEntry(label, "deployment_override"));
  }
  return entries;
}

interface GithubRunnerRecord {
  status?: string;
  labels?: Array<{ name?: string }>;
}

async function githubRunnerRecords(
  github: Octokit,
  repository: string,
): Promise<{ records: GithubRunnerRecord[]; discovered: boolean }> {
  const [owner, repo] = repository.split("/");
  const routes = [
    ["GET /repos/{owner}/{repo}/actions/runners", { owner, repo, per_page: 100 }] as const,
    ["GET /orgs/{org}/actions/runners", { org: owner, per_page: 100 }] as const,
  ];
  for (const [route, parameters] of routes) {
    try {
      const response = await github.request(route, parameters);
      const data = response.data as { runners?: GithubRunnerRecord[] };
      if (Array.isArray(data.runners)) {
        // The repository endpoint is authoritative because organization runner
        // groups can restrict which repositories may use a runner. Only consult
        // the broader organization inventory when repository discovery is not
        // available to the GitHub App installation.
        return { records: data.runners, discovered: true };
      }
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error
        ? Number(error.status)
        : 0;
      if (status !== 403 && status !== 404) throw error;
    }
  }
  return { records: [], discovered: false };
}

export async function discoverAvailableRunnerInventory(input: {
  orgId: string;
  installationId: string;
  repository: string;
}, dependencies: {
  createClient?: (installationId: string) => Promise<Octokit> | Octokit;
  catalogJson?: string;
} = {}): Promise<AvailableRunnerInventoryEntry[]> {
  const configured = configuredRunnerInventory({
    orgId: input.orgId,
    repository: input.repository,
    catalogJson: dependencies.catalogJson,
  });
  const github = dependencies.createClient
    ? await dependencies.createClient(input.installationId)
    : await createGithubInstallationClient(input.installationId);
  const { records } = await githubRunnerRecords(
    github,
    input.repository,
  );
  const discovered = new Map<string, AvailableRunnerInventoryEntry>();
  for (const record of records) {
    for (const label of record.labels ?? []) {
      const name = label.name?.trim();
      if (!name || !/^tenki-/i.test(name)) continue;
      const existing = discovered.get(name);
      const catalog = configured.find((entry) => entry.label === name);
      const inferred = inferredEntry(name, "github_self_hosted", record.status === "online");
      discovered.set(name, {
        ...(catalog ?? inferred),
        source: "github_self_hosted",
        online: Boolean(existing?.online || record.status === "online"),
      });
    }
  }
  // Tenki provisions ephemeral JIT runners only after a matching job is
  // queued. A healthy repository can therefore report zero idle runners from
  // GitHub. The reviewed, repository-scoped catalog remains authoritative for
  // which on-demand labels CloseSpan may select.
  for (const entry of configured) {
    if (!discovered.has(entry.label)) discovered.set(entry.label, entry);
  }
  return [...discovered.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function requiredXcodeMajor(version: string | undefined): number | null {
  const major = Number.parseInt(version?.split(".")[0] ?? "", 10);
  return Number.isInteger(major) && major > 0 ? major : null;
}

function compatibleTenkiCandidates(input: {
  platform: "ios" | "android";
  xcodeVersion?: string;
  androidApiLevel?: number;
  workload: TenkiRunnerWorkloadAssessment;
  inventory: AvailableRunnerInventoryEntry[];
}): AvailableRunnerInventoryEntry[] {
  const baseline = tenkiRunnerSize(input.workload.baselineRunnerLabel)!;
  const xcodeMajor = requiredXcodeMajor(input.xcodeVersion);
  return input.inventory.filter((candidate) => {
    if (candidate.provider !== "tenki" || !candidate.online) return false;
    if (candidate.platform !== input.workload.platform) return false;
    if (candidate.architecture !== (input.platform === "ios" ? "arm64" : "x64")) return false;
    if ((candidate.cpuCores ?? baseline.cpuCores) < baseline.cpuCores) return false;
    if ((candidate.memoryMb ?? baseline.memoryMb) < baseline.memoryMb) return false;
    if (input.platform === "ios") {
      return xcodeMajor !== null && candidate.xcodeMajors.includes(xcodeMajor);
    }
    if (!candidate.nestedKvm) return false;
    return candidate.androidApiLevels.length === 0
      || (input.androidApiLevel !== undefined && candidate.androidApiLevels.includes(input.androidApiLevel));
  }).sort((left, right) =>
    (left.cpuCores ?? baseline.cpuCores) - (right.cpuCores ?? baseline.cpuCores)
    || (left.memoryMb ?? baseline.memoryMb) - (right.memoryMb ?? baseline.memoryMb)
    || left.label.localeCompare(right.label));
}

export function selectCompatibleRunner(input: {
  platform: "ios" | "android";
  xcodeVersion?: string;
  androidApiLevel?: number;
  workload: TenkiRunnerWorkloadAssessment;
  inventory: AvailableRunnerInventoryEntry[];
  githubHostedFallbackEnabled?: boolean;
}): RunnerSelection {
  const baseline = tenkiRunnerSize(input.workload.baselineRunnerLabel)!;
  const candidates = compatibleTenkiCandidates(input);
  const selected = candidates[0];
  if (selected) {
    return {
      label: selected.label,
      provider: "tenki",
      source: selected.source,
      platform: selected.platform,
      architecture: selected.architecture,
      cpuCores: selected.cpuCores ?? baseline.cpuCores,
      memoryMb: selected.memoryMb ?? baseline.memoryMb,
      capacityLabel: baseline.label,
      fallbackReason: null,
      compatibleCandidateCount: candidates.length,
      compatibleCandidates: candidates.map((candidate) => ({
        label: candidate.label,
        cpuCores: candidate.cpuCores ?? baseline.cpuCores,
        memoryMb: candidate.memoryMb ?? baseline.memoryMb,
      })),
    };
  }
  const fallbackEnabled = input.githubHostedFallbackEnabled
    ?? process.env.GITHUB_HOSTED_RUNNER_FALLBACK_ENABLED !== "false";
  if (!fallbackEnabled) {
    throw new Error(
      `No compatible Tenki ${input.workload.platform} runner is enabled for this repository`,
    );
  }
  const xcodeMajor = requiredXcodeMajor(input.xcodeVersion);
  if (input.platform === "ios" && !xcodeMajor) {
    throw new Error("Repository analysis did not determine the required Xcode version");
  }
  return {
    label: input.platform === "ios" ? `macos-${xcodeMajor}` : "ubuntu-24.04",
    provider: "github_hosted",
    source: "github_hosted_fallback",
    platform: input.workload.platform,
    architecture: input.platform === "ios" ? "arm64" : "x64",
    cpuCores: input.platform === "ios" ? 3 : baseline.cpuCores,
    memoryMb: input.platform === "ios" ? 7_168 : baseline.memoryMb,
    capacityLabel: baseline.label,
    fallbackReason: `No enabled Tenki runner matched ${input.platform === "ios"
      ? `Xcode ${xcodeMajor} on Apple Silicon`
      : `Android API ${input.androidApiLevel ?? "unknown"} with nested KVM`}`,
    compatibleCandidateCount: 0,
    compatibleCandidates: [],
  };
}
