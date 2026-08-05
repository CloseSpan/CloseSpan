import { describe, expect, it } from "vitest";
import {
  SAFE_GENERIC_EXECUTION_PROFILE_CONFIG,
  assertExecutionProfileNarrowing,
  assertExecutionProfileScopeBoundary,
  canonicalExecutionProfileJson,
  hashExecutionProfileConfig,
  resolveExecutionProfile,
  sanitizeExecutionProfileConfig,
  type ExecutionProfileConfig,
  type ExecutionProfileSource,
  type ExecutionProfileVersion,
} from "./execution-profile";

function profile(input: {
  id: string;
  orgId?: string;
  repository?: string;
  workspaceRoot?: string;
  source: ExecutionProfileSource;
  config?: ExecutionProfileConfig;
}): ExecutionProfileVersion {
  const config = sanitizeExecutionProfileConfig(
    input.config ?? SAFE_GENERIC_EXECUTION_PROFILE_CONFIG,
  );
  return {
    id: input.id,
    orgId: input.orgId ?? "org_alpha",
    repository: input.repository ?? "acme/widget",
    workspaceRoot: input.workspaceRoot ?? ".",
    version: 1,
    source: input.source,
    config,
    contentHash: hashExecutionProfileConfig(config),
    parentProfileId: null,
    detectionEvidence: {},
    createdBy: "member_admin",
    createdAt: "2026-08-05T12:00:00.000Z",
  };
}

describe("execution profile configuration", () => {
  it("sanitizes paths, labels, commands, and resource defaults", () => {
    const result = sanitizeExecutionProfileConfig({
      language: " TypeScript ",
      framework: " Next.js ",
      packageManager: " PNPM ",
      runtimeVersion: " 22 ",
      workingDirectory: "./apps/web/",
      testCommands: ["  pnpm test\r\n  "],
      permittedPaths: ["./src/**", "src/**", "src/components/**"],
    });

    expect(result).toMatchObject({
      schemaVersion: 1,
      language: "typescript",
      framework: "Next.js",
      packageManager: "pnpm",
      runtimeVersion: "22",
      workingDirectory: "apps/web",
      testCommands: ["pnpm test"],
      permittedPaths: ["src/**", "src/components/**"],
      tenkiImage: null,
      tenkiSnapshotId: null,
      cpuCores: 2,
      memoryMb: 4096,
      allowInbound: false,
      allowOutbound: false,
      maxDurationMs: 1_800_000,
      idleTimeoutMinutes: 2,
    });
  });

  it("rejects traversal and mutually exclusive Tenki boot sources", () => {
    expect(() => sanitizeExecutionProfileConfig({ workingDirectory: "../api" }))
      .toThrow("cannot traverse outside the repository");
    expect(() => sanitizeExecutionProfileConfig({
      tenkiImage: "registry.example/agent:1",
      tenkiSnapshotId: "snapshot_123",
    })).toThrow("Configure either a Tenki image or snapshot, not both");
  });

  it("produces a canonical SHA-256 hash for semantically identical input", () => {
    const left = {
      language: "typescript",
      packageManager: "pnpm",
      testCommands: ["pnpm test"],
      permittedPaths: ["src/components/**", "src/**"],
    };
    const right = {
      permittedPaths: ["./src/**", "src/components/**"],
      testCommands: [" pnpm test "],
      packageManager: "PNPM",
      language: " TypeScript ",
    };

    expect(canonicalExecutionProfileJson(left))
      .toBe(canonicalExecutionProfileJson(right));
    expect(hashExecutionProfileConfig(left))
      .toMatch(/^[a-f0-9]{64}$/);
    expect(hashExecutionProfileConfig(left))
      .toBe(hashExecutionProfileConfig(right));
    expect(hashExecutionProfileConfig({ ...left, testCommands: ["pnpm test:unit"] }))
      .not.toBe(hashExecutionProfileConfig(left));
  });

  it("requires tickets to narrow profile paths and commands", () => {
    const config = sanitizeExecutionProfileConfig({
      language: "typescript",
      packageManager: "pnpm",
      permittedPaths: ["src/**", "tests/*.test.ts"],
      testCommands: ["pnpm test", "pnpm test:unit"],
    });

    expect(() => assertExecutionProfileNarrowing(config, {
      permittedPaths: ["src/components/**", "tests/button.test.ts"],
      requiredCommands: ["pnpm test"],
    })).not.toThrow();
    expect(() => assertExecutionProfileNarrowing(config, {
      permittedPaths: ["**/*"],
      requiredCommands: ["pnpm test"],
    })).toThrow("Ticket permitted path is broader");
    expect(() => assertExecutionProfileNarrowing(config, {
      permittedPaths: ["src/**"],
      requiredCommands: ["pnpm deploy"],
    })).toThrow("Ticket command is not allowed");
  });

  it("keeps monorepo profile execution inside its assigned workspace root", () => {
    const base = {
      language: "typescript",
      packageManager: "pnpm",
      workingDirectory: "apps/web",
      permittedPaths: ["apps/web/**"],
    };
    expect(() => assertExecutionProfileScopeBoundary({
      repository: "acme/widget",
      workspaceRoot: "apps/web",
    }, base)).not.toThrow();
    expect(() => assertExecutionProfileScopeBoundary({
      repository: "acme/widget",
      workspaceRoot: "apps/web",
    }, { ...base, permittedPaths: ["packages/shared/**"] }))
      .toThrow("outside its workspace root");
    expect(() => assertExecutionProfileScopeBoundary({
      repository: "",
      workspaceRoot: ".",
    }, base)).toThrow("workspace default profile must run from the repository root");
  });
});

describe("execution profile resolution", () => {
  const repository = "acme/widget";
  const generic = profile({
    id: "safe",
    repository: "",
    workspaceRoot: ".",
    source: "safe_generic",
  });
  const workspace = profile({
    id: "workspace",
    repository: "",
    workspaceRoot: ".",
    source: "override",
  });
  const repositoryProfile = profile({
    id: "repository",
    repository,
    workspaceRoot: ".",
    source: "confirmed",
  });
  const ticket = profile({
    id: "ticket",
    repository,
    workspaceRoot: ".",
    source: "override",
  });

  it("uses ticket override, repository, workspace, then safe generic precedence", () => {
    const base = { orgId: "org_alpha", repository, safeGeneric: generic };
    expect(resolveExecutionProfile({
      ...base,
      ticketOverride: ticket,
      repositoryAssignment: repositoryProfile,
      workspaceDefault: workspace,
    }).resolution).toBe("ticket_override");
    expect(resolveExecutionProfile({
      ...base,
      repositoryAssignment: repositoryProfile,
      workspaceDefault: workspace,
    }).resolution).toBe("repository_assignment");
    expect(resolveExecutionProfile({
      ...base,
      workspaceDefault: workspace,
    }).resolution).toBe("workspace_default");
    expect(resolveExecutionProfile(base).resolution).toBe("safe_generic");
  });

  it("allows a repository-root assignment for a monorepo child root", () => {
    expect(resolveExecutionProfile({
      orgId: "org_alpha",
      repository,
      workspaceRoot: "apps/web",
      repositoryAssignment: repositoryProfile,
      safeGeneric: generic,
    }).profile.id).toBe("repository");
  });

  it("rejects cross-tenant, tampered, and detected active profiles", () => {
    expect(() => resolveExecutionProfile({
      orgId: "org_beta",
      repository,
      repositoryAssignment: repositoryProfile,
      safeGeneric: { ...generic, orgId: "org_beta" },
    })).toThrow("different organization");
    expect(() => resolveExecutionProfile({
      orgId: "org_alpha",
      repository,
      repositoryAssignment: {
        ...repositoryProfile,
        contentHash: "0".repeat(64),
      },
      safeGeneric: generic,
    })).toThrow("content hash does not match");
    expect(() => resolveExecutionProfile({
      orgId: "org_alpha",
      repository,
      repositoryAssignment: { ...repositoryProfile, source: "detected" },
      safeGeneric: generic,
    })).toThrow("detected suggestion cannot be used as an active");
  });
});
