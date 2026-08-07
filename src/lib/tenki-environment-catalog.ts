import { createHash } from "node:crypto";
import type { ExecutionProfileConfig } from "./execution-profile";

export const managedTenkiEnvironmentScopes = [
  "managed_toolchain",
  "repository_private",
] as const;

export const managedTenkiEnvironmentStatuses = [
  "draft",
  "building",
  "ready",
  "active",
  "failed",
  "deprecated",
  "deleting",
  "deleted",
] as const;

export type ManagedTenkiEnvironmentScope =
  (typeof managedTenkiEnvironmentScopes)[number];
export type ManagedTenkiEnvironmentStatus =
  (typeof managedTenkiEnvironmentStatuses)[number];

export interface ManagedTenkiEnvironmentArtifact {
  id: string;
  scopeType: ManagedTenkiEnvironmentScope;
  orgId: string | null;
  repository: string;
  workspaceRoot: string;
  catalogKey: string;
  runtimeFamily: string;
  runtimeVersion: string | null;
  packageManager: string | null;
  capabilities: string[];
  dependencyFingerprint: string | null;
  sourceSha: string | null;
  version: number;
  tenkiWorkspaceId: string | null;
  templateId: string | null;
  builderSessionId: string | null;
  templateSpecHash: string | null;
  buildId: string | null;
  snapshotId: string | null;
  registryImageId: string | null;
  registryDigestRef: string | null;
  status: ManagedTenkiEnvironmentStatus;
  approved: boolean;
  expiresAt: string | null;
  validationSessionId: string | null;
  lastVerifiedAt: string | null;
  lastUsedAt: string | null;
}

export interface ManagedTenkiEnvironmentRequest {
  orgId: string;
  repository: string;
  workspaceRoot: string;
  runtimeFamily: string | null;
  runtimeVersion: string | null;
  packageManager: string | null;
  requiredCapabilities?: readonly string[];
  dependencyFingerprint?: string | null;
}

const IMMUTABLE_SHA_REGISTRY_REF =
  /^[a-z0-9][a-z0-9._/-]{1,399}@sha256:[a-f0-9]{64}$/i;
const IMMUTABLE_SNAPSHOT_REGISTRY_REF =
  /^[a-z0-9][a-z0-9._/-]{1,399}@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function isImmutableTenkiRegistryRef(value: string): boolean {
  const normalized = value.trim();
  return IMMUTABLE_SHA_REGISTRY_REF.test(normalized)
    || IMMUTABLE_SNAPSHOT_REGISTRY_REF.test(normalized);
}

export function isManagedTenkiArtifactRegistryRef(
  artifact: Pick<
    ManagedTenkiEnvironmentArtifact,
    "scopeType" | "snapshotId" | "registryDigestRef"
  >,
): boolean {
  const value = artifact.registryDigestRef?.trim() ?? "";
  if (IMMUTABLE_SHA_REGISTRY_REF.test(value)) return true;
  const snapshotVersion = IMMUTABLE_SNAPSHOT_REGISTRY_REF.exec(value)?.[1];
  return artifact.scopeType === "repository_private"
    && Boolean(snapshotVersion)
    && snapshotVersion === artifact.snapshotId;
}

export function assertImmutableTenkiRegistryRef(value: string): void {
  if (!isImmutableTenkiRegistryRef(value)) {
    throw new Error(
      "Tenki catalog images must use an immutable digest-addressed registry reference",
    );
  }
}

/**
 * Strict mode follows the catalog feature by default so production cannot
 * accidentally enable managed selection while leaving execution fail-open.
 * An explicit false is retained only for the one-time catalog bootstrap.
 */
export function strictManagedTenkiCatalogMode(): boolean {
  const explicit = process.env.TENKI_STRICT_CATALOG_ENABLED
    ?.trim()
    .toLowerCase();
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  return process.env.TENKI_MANAGED_CATALOG_ENABLED
    ?.trim()
    .toLowerCase() === "true";
}

function runtimeMajor(value: string | null): number | null {
  if (!value) return null;
  const match = /(?:^|\s|[<>=~^])v?(\d{1,3})(?:\D|$)/i.exec(value);
  return match ? Number(match[1]) : null;
}

function normalized(value: string | null): string | null {
  const result = value?.trim().toLowerCase() ?? "";
  return result || null;
}

export function runtimeFamilyForExecutionProfile(
  profile: Pick<ExecutionProfileConfig, "language" | "runtimeVersion">,
): string | null {
  const runtime = normalized(profile.runtimeVersion);
  if (runtime?.includes("deno")) return "deno";
  const language = normalized(profile.language);
  if (language === "javascript" || language === "typescript") return "node";
  if (language === "python") return "python";
  if (language === "java" || language === "kotlin") return "jvm";
  return language;
}

function isSelectable(
  artifact: ManagedTenkiEnvironmentArtifact,
  now: number,
): boolean {
  return artifact.status === "active"
    && artifact.approved
    && Boolean(artifact.validationSessionId)
    && Boolean(artifact.lastVerifiedAt)
    && Boolean(artifact.snapshotId)
    && Boolean(artifact.registryImageId)
    && Boolean(
      artifact.registryDigestRef
      && isManagedTenkiArtifactRegistryRef(artifact),
    )
    && (!artifact.expiresAt || Date.parse(artifact.expiresAt) > now);
}

function matchScore(
  artifact: ManagedTenkiEnvironmentArtifact,
  request: ManagedTenkiEnvironmentRequest,
): number {
  if (normalized(artifact.runtimeFamily) !== normalized(request.runtimeFamily)) {
    return -1;
  }
  let score = 100;
  if (
    (request.requiredCapabilities ?? [])
      .some((capability) => !artifact.capabilities.includes(capability))
  ) return -1;
  if (artifact.scopeType === "repository_private") {
    if (
      artifact.orgId !== request.orgId
      || artifact.repository !== request.repository
      || artifact.workspaceRoot !== request.workspaceRoot
    ) return -1;
    if (
      !request.dependencyFingerprint
      || artifact.dependencyFingerprint !== request.dependencyFingerprint
    ) return -1;
    score += 1_000;
  }
  const artifactManager = normalized(artifact.packageManager);
  const requestManager = normalized(request.packageManager);
  if (artifactManager && requestManager) {
    if (artifactManager !== requestManager) return -1;
    score += 30;
  }
  const artifactMajor = runtimeMajor(artifact.runtimeVersion);
  const requestMajor = runtimeMajor(request.runtimeVersion);
  if (artifactMajor !== null && requestMajor !== null) {
    if (artifactMajor !== requestMajor) return -1;
    score += 50;
  } else if (artifact.runtimeVersion) {
    score += 5;
  }
  return score + Math.min(artifact.version, 10_000) / 100_000;
}

export function selectManagedTenkiEnvironment(
  artifacts: readonly ManagedTenkiEnvironmentArtifact[],
  request: ManagedTenkiEnvironmentRequest,
  now = Date.now(),
): ManagedTenkiEnvironmentArtifact | null {
  return artifacts
    .filter((artifact) => isSelectable(artifact, now))
    .map((artifact) => ({ artifact, score: matchScore(artifact, request) }))
    .filter(({ score }) => score >= 0)
    .sort((left, right) => right.score - left.score
      || right.artifact.version - left.artifact.version
      || left.artifact.catalogKey.localeCompare(right.artifact.catalogKey))[0]
    ?.artifact ?? null;
}

export function dependencyCacheKey(input: {
  orgId: string;
  repository: string;
  workspaceRoot: string;
  runtimeFamily: string;
  packageManager: string;
  environmentDigestRef: string;
  dependencyFingerprint: string;
}): string {
  assertImmutableTenkiRegistryRef(input.environmentDigestRef);
  return createHash("sha256").update(JSON.stringify([
    input.orgId,
    input.repository,
    input.workspaceRoot,
    input.runtimeFamily,
    input.packageManager,
    input.environmentDigestRef,
    input.dependencyFingerprint,
  ])).digest("hex");
}

export const TENKI_DEPENDENCY_CACHE_MOUNT = "/home/tenki/.cache/closespan";

export function dependencyCacheEnvironment(): Record<string, string> {
  return {
    XDG_CACHE_HOME: `${TENKI_DEPENDENCY_CACHE_MOUNT}/xdg`,
    npm_config_cache: `${TENKI_DEPENDENCY_CACHE_MOUNT}/npm`,
    PIP_CACHE_DIR: `${TENKI_DEPENDENCY_CACHE_MOUNT}/pip`,
    CARGO_HOME: `${TENKI_DEPENDENCY_CACHE_MOUNT}/cargo`,
    GOMODCACHE: `${TENKI_DEPENDENCY_CACHE_MOUNT}/go/pkg/mod`,
    GOCACHE: `${TENKI_DEPENDENCY_CACHE_MOUNT}/go/build`,
    GRADLE_USER_HOME: `${TENKI_DEPENDENCY_CACHE_MOUNT}/gradle`,
    BUNDLE_PATH: `${TENKI_DEPENDENCY_CACHE_MOUNT}/bundle`,
    COMPOSER_CACHE_DIR: `${TENKI_DEPENDENCY_CACHE_MOUNT}/composer`,
    MIX_HOME: `${TENKI_DEPENDENCY_CACHE_MOUNT}/mix`,
    HEX_HOME: `${TENKI_DEPENDENCY_CACHE_MOUNT}/hex`,
  };
}
