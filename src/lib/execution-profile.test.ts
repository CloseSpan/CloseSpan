import { describe, expect, it } from "vitest";
import {
  SAFE_GENERIC_EXECUTION_PROFILE_CONFIG,
  TENKI_BROWSER_PREFLIGHT_COMMAND,
  assertExecutionProfileNarrowing,
  assertExecutionProfileScopeBoundary,
  canonicalExecutionProfileJson,
  executionProfileBrowserReadiness,
  hashExecutionProfileConfig,
  playwrightChromiumInstallCommand,
  resolveExecutionProfile,
  sanitizeExecutionProfileConfig,
  upgradeExecutionProfileConfigV2,
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

  it("preserves the version-one canonical shape while supporting immutable runtime profiles", () => {
    const legacy = sanitizeExecutionProfileConfig({
      schemaVersion: 1,
      language: "typescript",
      packageManager: "pnpm",
      installCommands: ["pnpm install --frozen-lockfile"],
      permittedPaths: ["src/**"],
    });
    expect(legacy.schemaVersion).toBe(1);
    expect(canonicalExecutionProfileJson(legacy)).not.toContain("automaticInstall");

    const runtime = upgradeExecutionProfileConfigV2(legacy);
    expect(runtime).toMatchObject({
      schemaVersion: 2,
      automaticInstall: true,
      automaticBuild: false,
      startCommand: null,
      applicationPort: null,
      previewEnabled: false,
      runtimeTools: { http: false, browser: false, logs: false },
    });
    expect(hashExecutionProfileConfig(runtime)).not.toBe(hashExecutionProfileConfig(legacy));
  });

  it("normalizes a complete running-app contract without storing secret values", () => {
    const result = sanitizeExecutionProfileConfig({
      schemaVersion: 2,
      language: "typescript",
      packageManager: "pnpm",
      workingDirectory: ".",
      installCommands: [
        "pnpm install --frozen-lockfile",
        TENKI_BROWSER_PREFLIGHT_COMMAND,
      ],
      buildCommands: ["pnpm build"],
      testCommands: ["pnpm test"],
      permittedPaths: ["src/**"],
      automaticInstall: true,
      automaticBuild: true,
      publicEnvironment: [{ name: "NODE_ENV", value: "test" }],
      secretBindings: [{
        envName: "DATABASE_URL",
        secretId: "9e31aa95-7092-4ed4-b859-238ad6aec584",
        secretVersion: 3,
        exposure: "runtime",
      }],
      startCommand: "pnpm start --hostname 0.0.0.0",
      applicationPort: 3000,
      healthCheckPath: "/api/health",
      healthCheckTimeoutMs: 60_000,
      previewEnabled: false,
      previewTtlMs: 300_000,
      runtimeTools: { http: true, browser: true, logs: true },
      tenkiSnapshotId: "snapshot_browser_ready",
      allowInbound: true,
      allowOutbound: false,
    });
    expect(result.schemaVersion).toBe(2);
    if (result.schemaVersion !== 2) throw new Error("Expected runtime profile");
    expect(result.secretBindings[0]).toEqual({
      envName: "DATABASE_URL",
      secretId: "9e31aa95-7092-4ed4-b859-238ad6aec584",
      secretVersion: 3,
      exposure: "runtime",
    });
    expect(canonicalExecutionProfileJson(result)).not.toContain("postgres://");
    expect(executionProfileBrowserReadiness(result)).toMatchObject({
      ready: true,
      mode: "image",
    });
  });

  it("allows one immutable secret version in multiple isolated phases without duplicate phase bindings", () => {
    const shared = {
      envName: "DATABASE_URL",
      secretId: "9e31aa95-7092-4ed4-b859-238ad6aec584",
      secretVersion: 3,
    };
    const result = sanitizeExecutionProfileConfig({
      schemaVersion: 2,
      secretBindings: [
        { ...shared, exposure: "runtime" },
        { ...shared, exposure: "test" },
      ],
    });
    expect(result.schemaVersion).toBe(2);
    if (result.schemaVersion !== 2) throw new Error("Expected runtime profile");
    expect(result.secretBindings).toHaveLength(2);
    expect(() => sanitizeExecutionProfileConfig({
      schemaVersion: 2,
      secretBindings: [
        { ...shared, exposure: "runtime" },
        { ...shared, exposure: "runtime" },
      ],
    })).toThrow("Duplicate runtime secret environment variable");
  });

  it("rejects incomplete or unsafe running-app configuration", () => {
    const base = {
      schemaVersion: 2,
      language: "typescript",
      packageManager: "pnpm",
      permittedPaths: ["src/**"],
    } as const;
    expect(() => sanitizeExecutionProfileConfig({
      ...base,
      startCommand: "pnpm start",
    })).toThrow("start command, application port, and health check path");
    expect(() => sanitizeExecutionProfileConfig({
      ...base,
      publicEnvironment: [{ name: "API_KEY", value: "not-public" }],
    })).toThrow("must use the runtime secret vault");
    expect(() => sanitizeExecutionProfileConfig({
      ...base,
      startCommand: "pnpm start",
      applicationPort: 3000,
      healthCheckPath: "/health",
      previewEnabled: true,
      runtimeTools: { http: true, browser: true, logs: true },
    })).toThrow("preview URL requires inbound networking");
    expect(() => sanitizeExecutionProfileConfig({
      ...base,
      startCommand: "pnpm start",
      applicationPort: 3000,
      healthCheckPath: "/health",
      runtimeTools: { http: true, browser: false, logs: true },
    })).not.toThrow();
  });

  it("requires exact, preflighted Chromium provisioning before advertising browser interaction", () => {
    const installBrowser = playwrightChromiumInstallCommand("pnpm");
    expect(installBrowser).toBe("pnpm exec playwright install chromium");
    const base = {
      schemaVersion: 2,
      language: "typescript",
      packageManager: "pnpm",
      startCommand: "pnpm start",
      applicationPort: 3000,
      healthCheckPath: "/health",
      automaticInstall: true,
      allowOutbound: true,
      runtimeTools: { http: true, browser: true, logs: true },
    } as const;

    expect(() => sanitizeExecutionProfileConfig({
      ...base,
      installCommands: [installBrowser!],
    })).toThrow("exact CloseSpan Chromium launch preflight");
    expect(() => sanitizeExecutionProfileConfig({
      ...base,
      installCommands: [
        "pnpm exec playwright install --with-deps chromium",
        TENKI_BROWSER_PREFLIGHT_COMMAND,
      ],
    })).toThrow("exact package-manager Chromium install command");

    const repositoryProvisioned = sanitizeExecutionProfileConfig({
      ...base,
      installCommands: [installBrowser!, TENKI_BROWSER_PREFLIGHT_COMMAND],
    });
    expect(repositoryProvisioned.schemaVersion).toBe(2);
    if (repositoryProvisioned.schemaVersion !== 2) throw new Error("Expected runtime profile");
    expect(executionProfileBrowserReadiness(repositoryProvisioned)).toMatchObject({
      ready: true,
      mode: "repository",
    });
  });

  it("keeps all outbound execution away from runtime and test secrets", () => {
    const browserCommands = [
      playwrightChromiumInstallCommand("npm")!,
      TENKI_BROWSER_PREFLIGHT_COMMAND,
    ];
    const base = {
      schemaVersion: 2,
      language: "typescript",
      packageManager: "npm",
      installCommands: browserCommands,
      automaticInstall: true,
      startCommand: "npm start",
      applicationPort: 3000,
      healthCheckPath: "/health",
      runtimeTools: { http: true, browser: true, logs: true },
      allowOutbound: true,
    } as const;
    const secret = {
      envName: "APP_SECRET",
      secretId: "9e31aa95-7092-4ed4-b859-238ad6aec584",
      secretVersion: 1,
    } as const;

    expect(() => sanitizeExecutionProfileConfig({
      ...base,
      secretBindings: [{ ...secret, exposure: "runtime" }],
    })).toThrow("cannot be combined with runtime or test secrets");
    expect(() => sanitizeExecutionProfileConfig({
      ...base,
      secretBindings: [{ ...secret, exposure: "test" }],
    })).toThrow("cannot be combined with runtime or test secrets");
    expect(() => sanitizeExecutionProfileConfig({
      ...base,
      runtimeTools: { http: true, browser: false, logs: true },
      installCommands: ["npm ci --ignore-scripts"],
      secretBindings: [{ ...secret, exposure: "runtime" }],
    })).toThrow("Outbound execution cannot be combined");
    expect(() => sanitizeExecutionProfileConfig({
      ...base,
      secretBindings: [{ ...secret, exposure: "setup" }],
    })).not.toThrow();
  });

  it("keeps public previews away from runtime secrets", () => {
    expect(() => sanitizeExecutionProfileConfig({
      schemaVersion: 2,
      startCommand: "npm start",
      applicationPort: 3000,
      healthCheckPath: "/health",
      previewEnabled: true,
      allowInbound: true,
      secretBindings: [{
        envName: "APP_SECRET",
        secretId: "9e31aa95-7092-4ed4-b859-238ad6aec584",
        secretVersion: 1,
        exposure: "runtime",
      }],
    })).toThrow("public preview cannot be combined with runtime secrets");

    expect(() => sanitizeExecutionProfileConfig({
      schemaVersion: 2,
      startCommand: "npm start",
      applicationPort: 3000,
      healthCheckPath: "/health",
      previewEnabled: true,
      allowInbound: true,
      secretBindings: [{
        envName: "TEST_TOKEN",
        secretId: "9e31aa95-7092-4ed4-b859-238ad6aec584",
        secretVersion: 1,
        exposure: "test",
      }],
    })).not.toThrow();
  });

  it("keeps common credential names and secret-shaped values out of public environment", () => {
    const base = {
      schemaVersion: 2,
      language: "typescript",
      packageManager: "pnpm",
      permittedPaths: ["src/**"],
    } as const;
    for (const name of [
      "AWS_SECRET_ACCESS_KEY",
      "AWS_ACCESS_KEY_ID",
      "GITHUB_PAT",
      "GITHUB_TOKEN",
    ]) {
      expect(() => sanitizeExecutionProfileConfig({
        ...base,
        publicEnvironment: [{ name, value: "credential-placeholder" }],
      }), name).toThrow("must use the runtime secret vault");
    }
    for (const value of [
      `github_pat_${"a".repeat(30)}`,
      "https://service-user:service-password@example.com/api",
      `Bearer ${"a".repeat(32)}`,
      `${"a".repeat(16)}.${"b".repeat(16)}.${"c".repeat(16)}`,
    ]) {
      expect(() => sanitizeExecutionProfileConfig({
        ...base,
        publicEnvironment: [{ name: "PUBLIC_CONFIGURATION", value }],
      }), value).toThrow("must use the runtime secret vault");
    }
    expect(() => sanitizeExecutionProfileConfig({
      ...base,
      publicEnvironment: [{
        name: "PUBLIC_API_ORIGIN",
        value: "https://api.example.com",
      }],
    })).not.toThrow();
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
