import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertImmutableTenkiRegistryRef,
  dependencyCacheEnvironment,
  dependencyCacheKey,
  isImmutableTenkiRegistryRef,
  isManagedTenkiArtifactRegistryRef,
  selectManagedTenkiEnvironment,
  strictManagedTenkiCatalogMode,
  type ManagedTenkiEnvironmentArtifact,
} from "./tenki-environment-catalog";

const digest = `sha256:${"a".repeat(64)}`;
const snapshotId = "81659164-c21c-46d3-954c-350e70b9af3d";

function artifact(
  overrides: Partial<ManagedTenkiEnvironmentArtifact> = {},
): ManagedTenkiEnvironmentArtifact {
  return {
    id: crypto.randomUUID(),
    scopeType: "managed_toolchain",
    orgId: null,
    repository: "",
    workspaceRoot: ".",
    catalogKey: "node-24",
    runtimeFamily: "node",
    runtimeVersion: "24",
    packageManager: "npm",
    capabilities: ["browser"],
    dependencyFingerprint: null,
    sourceSha: null,
    version: 1,
    tenkiWorkspaceId: "workspace-1",
    templateId: "template-1",
    builderSessionId: null,
    templateSpecHash: "b".repeat(64),
    buildId: "build-1",
    snapshotId: "snapshot-1",
    registryImageId: "image-1",
    registryDigestRef: `closespan/node-24@${digest}`,
    status: "active",
    approved: true,
    expiresAt: null,
    validationSessionId: "validation-1",
    lastVerifiedAt: new Date().toISOString(),
    lastUsedAt: null,
    ...overrides,
  };
}

describe("managed Tenki environment catalog", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults strict enforcement on with the managed catalog", () => {
    vi.stubEnv("TENKI_MANAGED_CATALOG_ENABLED", "true");
    vi.stubEnv("TENKI_STRICT_CATALOG_ENABLED", "");
    expect(strictManagedTenkiCatalogMode()).toBe(true);
    vi.stubEnv("TENKI_STRICT_CATALOG_ENABLED", "false");
    expect(strictManagedTenkiCatalogMode()).toBe(false);
  });

  it("prefers an exact private repository artifact over a global toolchain", () => {
    const global = artifact();
    const privateArtifact = artifact({
      id: crypto.randomUUID(),
      scopeType: "repository_private",
      orgId: "org-1",
      repository: "owner/repo",
      workspaceRoot: "apps/web",
      catalogKey: "owner-repo-web",
      version: 2,
      dependencyFingerprint: "lock-1",
      runtimeVersion: "24.2",
    });
    expect(selectManagedTenkiEnvironment([global, privateArtifact], {
      orgId: "org-1",
      repository: "owner/repo",
      workspaceRoot: "apps/web",
      runtimeFamily: "node",
      runtimeVersion: "node 24.2",
      packageManager: "npm",
      dependencyFingerprint: "lock-1",
    })?.id).toBe(privateArtifact.id);
  });

  it("rejects an environment below the repository's exact runtime constraint", () => {
    expect(selectManagedTenkiEnvironment([artifact({ runtimeVersion: "22.12" })], {
      orgId: "org-1",
      repository: "owner/repo",
      workspaceRoot: ".",
      runtimeFamily: "node",
      runtimeVersion: ">=22.13",
      packageManager: "npm",
    })).toBeNull();
  });

  it("rejects mutable, expired, unapproved, and mismatched artifacts", () => {
    expect(selectManagedTenkiEnvironment([
      artifact({ registryDigestRef: "closespan/node-24:latest" }),
      artifact({ approved: false }),
      artifact({ expiresAt: "2020-01-01T00:00:00.000Z" }),
      artifact({ runtimeFamily: "python" }),
    ], {
      orgId: "org-1",
      repository: "owner/repo",
      workspaceRoot: ".",
      runtimeFamily: "node",
      runtimeVersion: "24",
      packageManager: "npm",
    })).toBeNull();
    expect(() => assertImmutableTenkiRegistryRef("closespan/node:latest"))
      .toThrow("immutable digest-addressed");
  });

  it("accepts an exact snapshot-version ref only for its private repository artifact", () => {
    const snapshotRef = `closespan/private-node@${snapshotId}`;
    expect(isImmutableTenkiRegistryRef(snapshotRef)).toBe(true);
    expect(isManagedTenkiArtifactRegistryRef(artifact({
      scopeType: "repository_private",
      orgId: "org-1",
      repository: "owner/repo",
      snapshotId,
      registryDigestRef: snapshotRef,
    }))).toBe(true);
    expect(isManagedTenkiArtifactRegistryRef(artifact({
      scopeType: "repository_private",
      orgId: "org-1",
      repository: "owner/repo",
      snapshotId: crypto.randomUUID(),
      registryDigestRef: snapshotRef,
    }))).toBe(false);
    expect(isManagedTenkiArtifactRegistryRef(artifact({
      scopeType: "managed_toolchain",
      snapshotId,
      registryDigestRef: snapshotRef,
    }))).toBe(false);
  });

  it.each([
    `closespan/private-node:latest@${snapshotId}`,
    `closespan/private-node:latest@${digest}`,
    `closespan/private-node@${snapshotId}@${snapshotId}`,
  ])("rejects a mutable or malformed catalog reference %s", (value) => {
    expect(isImmutableTenkiRegistryRef(value)).toBe(false);
  });

  it("isolates cache keys by tenant, repository, root, environment, and lockfile", () => {
    const base = {
      orgId: "org-1",
      repository: "owner/repo",
      workspaceRoot: ".",
      runtimeFamily: "node",
      packageManager: "npm",
      environmentDigestRef: `closespan/node-24@${digest}`,
      dependencyFingerprint: "lock-a",
    };
    expect(dependencyCacheKey(base)).toMatch(/^[a-f0-9]{64}$/);
    expect(dependencyCacheKey(base)).not.toBe(dependencyCacheKey({
      ...base,
      orgId: "org-2",
    }));
    expect(dependencyCacheKey(base)).not.toBe(dependencyCacheKey({
      ...base,
      dependencyFingerprint: "lock-b",
    }));
    expect(dependencyCacheEnvironment().npm_config_cache)
      .toContain("/home/tenki/.cache/closespan/");
  });
});
