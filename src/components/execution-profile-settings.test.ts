import { describe, expect, it } from "vitest";
import {
  TENKI_BROWSER_PREFLIGHT_COMMAND,
  type ExecutionProfileConfigV2,
} from "../lib/execution-profile";
import {
  configureBrowserInteraction,
  runtimeSecretBindingOptions,
} from "./execution-profile-settings";

const secrets = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    environmentName: "SHARED_TOKEN",
    label: "Shared token",
    scopeType: "workspace" as const,
    repository: "",
    workspaceRoot: ".",
    createdAt: "2026-08-05T00:00:00.000Z",
    versions: [
      { version: 2, active: true, createdAt: "2026-08-05T00:00:00.000Z", revokedAt: null },
      { version: 1, active: false, createdAt: "2026-08-04T00:00:00.000Z", revokedAt: "2026-08-05T00:00:00.000Z" },
    ],
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    environmentName: "DATABASE_URL",
    label: "Repository database",
    scopeType: "repository" as const,
    repository: "acme/web",
    workspaceRoot: "apps/web",
    createdAt: "2026-08-05T00:00:00.000Z",
    versions: [
      { version: 3, active: true, createdAt: "2026-08-05T00:00:00.000Z", revokedAt: null },
    ],
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    environmentName: "OTHER_DATABASE_URL",
    label: "Other root database",
    scopeType: "repository" as const,
    repository: "acme/web",
    workspaceRoot: "apps/admin",
    createdAt: "2026-08-05T00:00:00.000Z",
    versions: [
      { version: 1, active: true, createdAt: "2026-08-05T00:00:00.000Z", revokedAt: null },
    ],
  },
];

describe("runtime secret binding options", () => {
  it("offers workspace secrets and only exact repository-root secrets", () => {
    expect(runtimeSecretBindingOptions(secrets, "acme/web", "apps/web")).toEqual([
      {
        token: "22222222-2222-4222-8222-222222222222:3",
        secretId: "22222222-2222-4222-8222-222222222222",
        secretVersion: 3,
        environmentName: "DATABASE_URL",
        label: "Repository database",
        scopeType: "repository",
      },
      {
        token: "11111111-1111-4111-8111-111111111111:2",
        secretId: "11111111-1111-4111-8111-111111111111",
        secretVersion: 2,
        environmentName: "SHARED_TOKEN",
        label: "Shared token",
        scopeType: "workspace",
      },
    ]);
  });

  it("never offers repository secrets to the workspace fallback", () => {
    const options = runtimeSecretBindingOptions(secrets, "", ".");
    expect(options.map((option) => option.environmentName)).toEqual(["SHARED_TOKEN"]);
    expect(options.some((option) => option.secretVersion === 1)).toBe(false);
  });
});

function runtimeProfile(
  overrides: Partial<ExecutionProfileConfigV2> = {},
): ExecutionProfileConfigV2 {
  return {
    schemaVersion: 2,
    language: "typescript",
    framework: "Next.js",
    packageManager: "pnpm",
    runtimeVersion: "node 22",
    workingDirectory: ".",
    installCommands: ["pnpm install --frozen-lockfile"],
    buildCommands: ["pnpm build"],
    testCommands: ["pnpm test"],
    typecheckCommands: ["pnpm typecheck"],
    permittedPaths: ["**/*"],
    tenkiImage: null,
    tenkiSnapshotId: null,
    cpuCores: 2,
    memoryMb: 4_096,
    allowInbound: false,
    allowOutbound: false,
    maxDurationMs: 1_800_000,
    idleTimeoutMinutes: 2,
    automaticInstall: true,
    automaticBuild: true,
    publicEnvironment: [],
    secretBindings: [],
    startCommand: "pnpm start",
    applicationPort: 3000,
    healthCheckPath: "/health",
    healthCheckTimeoutMs: 90_000,
    previewEnabled: false,
    previewTtlMs: 600_000,
    runtimeTools: { http: true, browser: false, logs: true },
    ...overrides,
  };
}

describe("browser interaction profile controls", () => {
  it("adds exact repository provisioning and preflight commands atomically", () => {
    const result = configureBrowserInteraction(runtimeProfile(), true);

    expect(result.error).toBeUndefined();
    expect(result.config).toMatchObject({
      automaticInstall: true,
      allowOutbound: true,
      runtimeTools: { http: true, browser: true, logs: true },
    });
    expect(result.config.installCommands).toEqual([
      "pnpm install --frozen-lockfile",
      "pnpm exec playwright install chromium",
      TENKI_BROWSER_PREFLIGHT_COMMAND,
    ]);
  });

  it("uses an immutable image with launch preflight and no forced outbound access", () => {
    const result = configureBrowserInteraction(runtimeProfile({
      tenkiSnapshotId: "snapshot_browser_ready",
    }), true);

    expect(result.error).toBeUndefined();
    expect(result.config.allowOutbound).toBe(false);
    expect(result.config.installCommands).toEqual([
      "pnpm install --frozen-lockfile",
      TENKI_BROWSER_PREFLIGHT_COMMAND,
    ]);
    expect(result.config.runtimeTools.browser).toBe(true);
  });

  it("fails closed when repository provisioning would expose runtime secrets to outbound access", () => {
    const result = configureBrowserInteraction(runtimeProfile({
      secretBindings: [{
        envName: "APP_SECRET",
        secretId: "11111111-1111-4111-8111-111111111111",
        secretVersion: 1,
        exposure: "runtime",
      }],
    }), true);

    expect(result.error).toContain("cannot share runtime or test secrets");
    expect(result.config.runtimeTools.browser).toBe(false);
    expect(result.config.allowOutbound).toBe(false);
  });
});
