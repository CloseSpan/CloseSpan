import { createHash } from "node:crypto";
import { z } from "zod";

export const executionProfileSources = [
  "detected",
  "confirmed",
  "override",
  "safe_generic",
] as const;

export type ExecutionProfileSource = (typeof executionProfileSources)[number];

export const TENKI_BROWSER_PREFLIGHT_COMMAND = `node -e "let c;try{c=require('playwright').chromium}catch{c=require('@playwright/test').chromium}(async()=>{const b=await c.launch({headless:true});const x=await b.newContext({serviceWorkers:'block'});if(typeof x.routeWebSocket!=='function')throw new Error('Playwright WebSocket routing is unavailable');await x.close();await b.close()})().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exit(1)})"`;

const playwrightInstallCommands = {
  npm: "npm exec -- playwright install chromium",
  pnpm: "pnpm exec playwright install chromium",
  yarn: "yarn exec playwright install chromium",
  bun: "bunx playwright install chromium",
} as const;

export type ExecutionProfileBrowserProvisioningMode =
  | "none"
  | "repository"
  | "image";

export interface ExecutionProfileBrowserReadiness {
  ready: boolean;
  mode: ExecutionProfileBrowserProvisioningMode;
  installCommand: string | null;
  reason: string;
}

function normalizedJavascriptPackageManager(value: string): keyof typeof playwrightInstallCommands | null {
  const normalized = value.trim().toLowerCase().split("@")[0];
  return normalized && normalized in playwrightInstallCommands
    ? normalized as keyof typeof playwrightInstallCommands
    : null;
}

export function playwrightChromiumInstallCommand(packageManager: string): string | null {
  const normalized = normalizedJavascriptPackageManager(packageManager);
  return normalized ? playwrightInstallCommands[normalized] : null;
}

export function isPlaywrightChromiumInstallCommand(command: string): boolean {
  return Object.values(playwrightInstallCommands).includes(
    command.trim() as (typeof playwrightInstallCommands)[keyof typeof playwrightInstallCommands],
  );
}

export function executionProfileBrowserReadiness(input: {
  packageManager: string;
  installCommands: readonly string[];
  automaticInstall: boolean;
  tenkiImage: string | null;
  tenkiSnapshotId: string | null;
  allowOutbound: boolean;
}): ExecutionProfileBrowserReadiness {
  const commands = new Set(input.installCommands.map((command) => command.trim()));
  const installCommand = playwrightChromiumInstallCommand(input.packageManager);
  const preflightConfigured = commands.has(TENKI_BROWSER_PREFLIGHT_COMMAND);
  const immutableBootSource = Boolean(input.tenkiImage || input.tenkiSnapshotId);
  const repositoryProvisioning = Boolean(installCommand && commands.has(installCommand));

  if (!input.automaticInstall) {
    return {
      ready: false,
      mode: "none",
      installCommand,
      reason: "Browser interaction requires automatic setup so readiness is checked before the agent starts.",
    };
  }
  if (!preflightConfigured) {
    return {
      ready: false,
      mode: "none",
      installCommand,
      reason: "Browser interaction requires the exact CloseSpan Chromium launch preflight command.",
    };
  }
  if (immutableBootSource && repositoryProvisioning) {
    return {
      ready: false,
      mode: "none",
      installCommand,
      reason: "Choose either image or snapshot provisioning, or repository Chromium provisioning, not both.",
    };
  }
  if (immutableBootSource) {
    return {
      ready: true,
      mode: "image",
      installCommand: null,
      reason: "The selected image or snapshot must provide Playwright and pass a real Chromium launch preflight.",
    };
  }
  if (!repositoryProvisioning) {
    return {
      ready: false,
      mode: "none",
      installCommand,
      reason: installCommand
        ? "Browser interaction requires the exact package-manager Chromium install command."
        : "Choose npm, pnpm, yarn, or bun, or select a browser-ready Tenki image or snapshot.",
    };
  }
  if (!input.allowOutbound) {
    return {
      ready: false,
      mode: "repository",
      installCommand,
      reason: "Repository Chromium provisioning requires outbound access during setup.",
    };
  }
  return {
    ready: true,
    mode: "repository",
    installCommand,
    reason: "Chromium is installed from the locked repository dependency and launch-tested before the agent starts.",
  };
}

const commandListSchema = z
  .array(z.string().trim().min(1).max(1_000))
  .max(30)
  .default([]);

const nullableLabelSchema = z
  .union([z.string().trim().min(1).max(120), z.null()])
  .default(null);

const executionProfileBaseShape = {
  language: z.string().trim().min(1).max(80).default("unknown"),
  framework: nullableLabelSchema,
  packageManager: z.string().trim().min(1).max(80).default("unknown"),
  runtimeVersion: nullableLabelSchema,
  workingDirectory: z.string().trim().min(1).max(500).default("."),
  installCommands: commandListSchema,
  buildCommands: commandListSchema,
  testCommands: commandListSchema,
  typecheckCommands: commandListSchema,
  permittedPaths: z
    .array(z.string().trim().min(1).max(500))
    .max(100)
    .default([]),
  tenkiImage: z
    .union([z.string().trim().min(1).max(500), z.null()])
    .default(null),
  tenkiSnapshotId: z
    .union([z.string().trim().min(1).max(500), z.null()])
    .default(null),
  // Preserve the historical parser ceiling so already-bound immutable
  // profiles remain readable. New saves and execution are separately limited
  // to the current provider ceilings below.
  cpuCores: z.number().int().min(1).max(32).default(2),
  memoryMb: z.number().int().min(512).max(131_072).default(4_096),
  allowInbound: z.boolean().default(false),
  allowOutbound: z.boolean().default(false),
  maxDurationMs: z
    .number()
    .int()
    .min(60_000)
    .max(86_400_000)
    .default(1_800_000),
  idleTimeoutMinutes: z.number().int().min(1).max(1_440).default(2),
} as const;

function refineBootSource(
  value: { tenkiImage: string | null; tenkiSnapshotId: string | null },
  context: z.RefinementCtx,
): void {
  if (value.tenkiImage && value.tenkiSnapshotId) {
    context.addIssue({
      code: "custom",
      path: ["tenkiSnapshotId"],
      message: "Configure either a Tenki image or snapshot, not both",
    });
  }
}

const executionProfileConfigV1InputSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    ...executionProfileBaseShape,
  })
  .strict()
  .superRefine(refineBootSource);

const environmentNameSchema = z.string()
  .trim()
  .regex(/^[A-Z_][A-Z0-9_]{0,127}$/, "Environment names must use uppercase letters, numbers, and underscores");

const runtimeToolsSchema = z.object({
  http: z.boolean().default(false),
  browser: z.boolean().default(false),
  logs: z.boolean().default(false),
}).strict().default({ http: false, browser: false, logs: false });

const executionProfileConfigV2InputSchema = z
  .object({
    schemaVersion: z.literal(2),
    ...executionProfileBaseShape,
    automaticInstall: z.boolean().default(false),
    automaticBuild: z.boolean().default(false),
    publicEnvironment: z.array(z.object({
      name: environmentNameSchema,
      value: z.string().max(4_000),
    }).strict()).max(100).default([]),
    secretBindings: z.array(z.object({
      envName: environmentNameSchema,
      secretId: z.string().uuid(),
      secretVersion: z.number().int().positive(),
      exposure: z.enum(["setup", "runtime", "test"]),
    }).strict()).max(100).default([]),
    startCommand: z.union([z.string().trim().min(1).max(1_000), z.null()]).default(null),
    applicationPort: z.union([z.number().int().min(1_024).max(65_535), z.null()]).default(null),
    healthCheckPath: z.union([
      z.string().trim().regex(/^\/(?!\/)[^\s?#]{0,499}$/, "Health check must be an absolute HTTP path without a query or fragment"),
      z.null(),
    ]).default(null),
    healthCheckTimeoutMs: z.number().int().min(5_000).max(600_000).default(90_000),
    previewEnabled: z.boolean().default(false),
    previewTtlMs: z.number().int().min(60_000).max(900_000).default(600_000),
    runtimeTools: runtimeToolsSchema,
  })
  .strict()
  .superRefine((value, context) => {
    refineBootSource(value, context);
    const publicNames = new Set<string>();
    const secretNames = new Set<string>();
    for (const item of value.publicEnvironment) {
      if (publicNames.has(item.name)) {
        context.addIssue({ code: "custom", path: ["publicEnvironment"], message: `Duplicate public environment variable: ${item.name}` });
      }
      publicNames.add(item.name);
    }
    for (const item of value.secretBindings) {
      const phaseName = `${item.exposure}:${item.envName}`;
      if (secretNames.has(phaseName)) {
        context.addIssue({ code: "custom", path: ["secretBindings"], message: `Duplicate ${item.exposure} secret environment variable: ${item.envName}` });
      }
      secretNames.add(phaseName);
      if (publicNames.has(item.envName)) {
        context.addIssue({ code: "custom", path: ["secretBindings"], message: `${item.envName} cannot be both public and secret` });
      }
    }
    if (value.automaticInstall && value.installCommands.length === 0) {
      context.addIssue({ code: "custom", path: ["automaticInstall"], message: "Automatic install requires at least one install command" });
    }
    if (value.automaticBuild && value.buildCommands.length === 0) {
      context.addIssue({ code: "custom", path: ["automaticBuild"], message: "Automatic build requires at least one build command" });
    }
    const runtimeConfigured = Boolean(value.startCommand || value.applicationPort || value.healthCheckPath);
    if (runtimeConfigured && !(value.startCommand && value.applicationPort && value.healthCheckPath)) {
      context.addIssue({
        code: "custom",
        path: ["startCommand"],
        message: "A running application requires a start command, application port, and health check path",
      });
    }
    if ((value.runtimeTools.http || value.runtimeTools.browser || value.runtimeTools.logs) && !value.startCommand) {
      context.addIssue({ code: "custom", path: ["runtimeTools"], message: "Runtime tools require a configured running application" });
    }
    if (value.runtimeTools.browser) {
      const browserReadiness = executionProfileBrowserReadiness(value);
      if (!browserReadiness.ready) {
        context.addIssue({
          code: "custom",
          path: ["runtimeTools", "browser"],
          message: browserReadiness.reason,
        });
      }
    }
    if (
      value.allowOutbound
      && value.secretBindings.some((binding) => binding.exposure === "runtime" || binding.exposure === "test")
    ) {
      context.addIssue({
        code: "custom",
        path: ["secretBindings"],
        message: "Outbound execution cannot be combined with runtime or test secrets until scoped egress policies are available",
      });
    }
    if (value.previewEnabled && !value.allowInbound) {
      context.addIssue({ code: "custom", path: ["allowInbound"], message: "A preview URL requires inbound networking" });
    }
    if (
      value.previewEnabled
      && value.secretBindings.some((binding) => binding.exposure === "runtime")
    ) {
      context.addIssue({
        code: "custom",
        path: ["previewEnabled"],
        message: "A public preview cannot be combined with runtime secrets",
      });
    }
  });

const repositoryRelativeFileSchema = z.string().trim().min(1).max(500).refine(
  (value) => !value.startsWith("/")
    && !value.includes("\\")
    && !value.split("/").includes(".."),
  "Path must stay inside the repository",
);

const tenkiGithubActionsXcodeSchema = z.object({
  version: z.string().trim().min(1).max(40),
  containerKind: z.enum(["workspace", "project", "package"]),
  containerPath: repositoryRelativeFileSchema,
  scheme: z.string().trim().min(1).max(200),
  configuration: z.string().trim().min(1).max(80).default("Debug"),
  destination: z.string().trim().min(1).max(500),
  sdk: z.literal("iphonesimulator").default("iphonesimulator"),
  signingPolicy: z.literal("simulator_only").default("simulator_only"),
}).strict().superRefine((value, context) => {
  const expectedSuffix = value.containerKind === "workspace"
    ? ".xcworkspace"
    : value.containerKind === "project"
      ? ".xcodeproj"
      : "Package.swift";
  if (!value.containerPath.endsWith(expectedSuffix)) {
    context.addIssue({
      code: "custom",
      path: ["containerPath"],
      message: `Xcode ${value.containerKind} path must end with ${expectedSuffix}`,
    });
  }
});

const tenkiGithubActionsAndroidSchema = z.object({
  apiLevel: z.number().int().min(21).max(99),
  target: z.enum(["google_apis", "google_apis_playstore", "default"]),
  architecture: z.enum(["x86_64", "arm64-v8a"]),
  deviceProfile: z.string().trim().min(1).max(120),
  gradleTask: z.string().trim().regex(/^:[A-Za-z0-9_.:-]+$/),
}).strict();

const executionProfileExecutorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("tenki_sandbox"),
  }).strict(),
  z.object({
    kind: z.literal("tenki_github_actions"),
    platform: z.enum(["linux", "macos"]),
    architecture: z.enum(["x64", "arm64"]),
    runnerLabel: z.string().trim().regex(/^[A-Za-z0-9_.-]{1,120}$/),
    workflowPath: z.string().trim().regex(
      /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/,
      "Runner workflow must be a repository workflow YAML file",
    ),
    // Detection can create a reviewable candidate before the runner workflow
    // exists. Confirmation and dispatch both require this immutable digest.
    workflowSha256: z.union([z.string().regex(/^[a-f0-9]{64}$/), z.null()]),
    xcode: z.union([tenkiGithubActionsXcodeSchema, z.null()]).default(null),
    androidEmulator: z.union([tenkiGithubActionsAndroidSchema, z.null()]).default(null),
  }).strict(),
]);

const executionProfileConfigV3InputSchema = z
  .object({
    schemaVersion: z.literal(3),
    ...executionProfileBaseShape,
    automaticInstall: z.boolean().default(false),
    automaticBuild: z.boolean().default(false),
    publicEnvironment: z.array(z.object({
      name: environmentNameSchema,
      value: z.string().max(4_000),
    }).strict()).max(100).default([]),
    secretBindings: z.array(z.object({
      envName: environmentNameSchema,
      secretId: z.string().uuid(),
      secretVersion: z.number().int().positive(),
      exposure: z.enum(["setup", "runtime", "test"]),
    }).strict()).max(100).default([]),
    startCommand: z.union([z.string().trim().min(1).max(1_000), z.null()]).default(null),
    applicationPort: z.union([z.number().int().min(1_024).max(65_535), z.null()]).default(null),
    healthCheckPath: z.union([
      z.string().trim().regex(/^\/(?!\/)[^\s?#]{0,499}$/, "Health check must be an absolute HTTP path without a query or fragment"),
      z.null(),
    ]).default(null),
    healthCheckTimeoutMs: z.number().int().min(5_000).max(600_000).default(90_000),
    previewEnabled: z.boolean().default(false),
    previewTtlMs: z.number().int().min(60_000).max(900_000).default(600_000),
    runtimeTools: runtimeToolsSchema,
    executor: executionProfileExecutorSchema,
  })
  .strict()
  .superRefine((value, context) => {
    refineBootSource(value, context);
    if (value.automaticInstall && value.installCommands.length === 0) {
      context.addIssue({ code: "custom", path: ["automaticInstall"], message: "Automatic install requires at least one install command" });
    }
    if (value.automaticBuild && value.buildCommands.length === 0) {
      context.addIssue({ code: "custom", path: ["automaticBuild"], message: "Automatic build requires at least one build command" });
    }
    const runtimeConfigured = Boolean(value.startCommand || value.applicationPort || value.healthCheckPath);
    if (runtimeConfigured && !(value.startCommand && value.applicationPort && value.healthCheckPath)) {
      context.addIssue({ code: "custom", path: ["startCommand"], message: "A running application requires a start command, application port, and health check path" });
    }
    const executor = value.executor;
    if (executor.kind === "tenki_github_actions") {
      if (value.tenkiImage || value.tenkiSnapshotId) {
        context.addIssue({ code: "custom", path: ["tenkiImage"], message: "Tenki GitHub Actions profiles use a runner label, not a Sandbox image or snapshot" });
      }
      if (value.allowInbound || value.previewEnabled) {
        context.addIssue({ code: "custom", path: ["allowInbound"], message: "Tenki GitHub Actions jobs cannot expose an inbound CloseSpan preview" });
      }
      if (value.secretBindings.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["secretBindings"],
          message: "Tenki GitHub Actions profiles must use explicitly reviewed GitHub Actions secrets; CloseSpan runtime secret bindings are not exported to repository workflows",
        });
      }
      if (executor.platform === "macos") {
        if (executor.architecture !== "arm64") {
          context.addIssue({ code: "custom", path: ["executor", "architecture"], message: "Tenki macOS runners use Apple Silicon arm64" });
        }
        if (!executor.xcode) {
          context.addIssue({ code: "custom", path: ["executor", "xcode"], message: "A Tenki macOS execution profile requires an Xcode contract" });
        }
        if (executor.androidEmulator) {
          context.addIssue({ code: "custom", path: ["executor", "androidEmulator"], message: "Android Emulator profiles run on Tenki Linux x64 with KVM" });
        }
      } else if (executor.xcode) {
        context.addIssue({ code: "custom", path: ["executor", "xcode"], message: "Xcode requires a Tenki macOS runner" });
      }
      if (executor.androidEmulator && executor.architecture !== "x64") {
        context.addIssue({ code: "custom", path: ["executor", "architecture"], message: "Tenki Android Emulator profiles require Linux x64 with nested KVM" });
      }
    }
  });

export interface ExecutionProfileConfigBase {
  language: string;
  framework: string | null;
  packageManager: string;
  runtimeVersion: string | null;
  workingDirectory: string;
  installCommands: string[];
  buildCommands: string[];
  testCommands: string[];
  typecheckCommands: string[];
  permittedPaths: string[];
  tenkiImage: string | null;
  tenkiSnapshotId: string | null;
  cpuCores: number;
  memoryMb: number;
  allowInbound: boolean;
  allowOutbound: boolean;
  maxDurationMs: number;
  idleTimeoutMinutes: number;
}

export interface ExecutionProfileConfigV1 extends ExecutionProfileConfigBase {
  schemaVersion: 1;
}

export interface ExecutionProfilePublicEnvironmentVariable {
  name: string;
  value: string;
}

export interface ExecutionProfileSecretBinding {
  envName: string;
  secretId: string;
  secretVersion: number;
  exposure: "setup" | "runtime" | "test";
}

export interface ExecutionProfileRuntimeTools {
  http: boolean;
  browser: boolean;
  logs: boolean;
}

export interface ExecutionProfileConfigV2 extends ExecutionProfileConfigBase {
  schemaVersion: 2;
  automaticInstall: boolean;
  automaticBuild: boolean;
  publicEnvironment: ExecutionProfilePublicEnvironmentVariable[];
  secretBindings: ExecutionProfileSecretBinding[];
  startCommand: string | null;
  applicationPort: number | null;
  healthCheckPath: string | null;
  healthCheckTimeoutMs: number;
  previewEnabled: boolean;
  previewTtlMs: number;
  runtimeTools: ExecutionProfileRuntimeTools;
}

export interface TenkiGithubActionsXcodeContract {
  version: string;
  containerKind: "workspace" | "project" | "package";
  containerPath: string;
  scheme: string;
  configuration: string;
  destination: string;
  sdk: "iphonesimulator";
  signingPolicy: "simulator_only";
}

export interface TenkiGithubActionsAndroidContract {
  apiLevel: number;
  target: "google_apis" | "google_apis_playstore" | "default";
  architecture: "x86_64" | "arm64-v8a";
  deviceProfile: string;
  gradleTask: string;
}

export type ExecutionProfileExecutor =
  | { kind: "tenki_sandbox" }
  | {
      kind: "tenki_github_actions";
      platform: "linux" | "macos";
      architecture: "x64" | "arm64";
      runnerLabel: string;
      workflowPath: string;
      workflowSha256: string | null;
      xcode: TenkiGithubActionsXcodeContract | null;
      androidEmulator: TenkiGithubActionsAndroidContract | null;
    };

export interface ExecutionProfileConfigV3
  extends Omit<ExecutionProfileConfigV2, "schemaVersion"> {
  schemaVersion: 3;
  executor: ExecutionProfileExecutor;
}

export type ExecutionProfileConfig =
  | ExecutionProfileConfigV1
  | ExecutionProfileConfigV2
  | ExecutionProfileConfigV3;

export function assertTenkiProviderResourceLimits(
  config: ExecutionProfileConfig,
): void {
  if (executionProfileExecutor(config).kind === "tenki_github_actions") return;
  if (config.cpuCores > 16) {
    throw new Error("Tenki execution profiles support at most 16 CPU cores");
  }
  if (config.memoryMb > 65_536) {
    throw new Error("Tenki execution profiles support at most 65536 MB of memory");
  }
}

export interface ExecutionProfileScope {
  repository: string;
  workspaceRoot: string;
}

export interface ExecutionProfileVersion extends ExecutionProfileScope {
  id: string;
  orgId: string;
  version: number;
  source: ExecutionProfileSource;
  config: ExecutionProfileConfig;
  contentHash: string;
  parentProfileId: string | null;
  detectionEvidence: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
}

export interface ExecutionProfileSnapshot extends ExecutionProfileScope {
  profileId: string;
  version: number;
  source: ExecutionProfileSource;
  contentHash: string;
  config: ExecutionProfileConfig;
}

export type ExecutionProfileResolution =
  | "ticket_override"
  | "repository_assignment"
  | "workspace_default"
  | "safe_generic";

export interface ResolvedExecutionProfile {
  profile: ExecutionProfileVersion;
  snapshot: ExecutionProfileSnapshot;
  resolution: ExecutionProfileResolution;
}

export interface ExecutionProfileResolutionInput {
  orgId: string;
  repository: string;
  workspaceRoot?: string;
  ticketOverride?: ExecutionProfileVersion | null;
  repositoryAssignment?: ExecutionProfileVersion | null;
  workspaceDefault?: ExecutionProfileVersion | null;
  safeGeneric: ExecutionProfileVersion;
}

export interface ProblemRepositoryMatchView extends ExecutionProfileScope {
  problemId: string;
  profileId: string;
  profileHash: string;
  confidence: number;
  reasons: string[];
  status: "Suggested" | "Confirmed" | "Rejected";
  createdAt: string;
  updatedAt: string;
}

function normalizeRelativePath(value: string, field: string): string {
  const normalizedSlashes = value.trim().replaceAll("\\", "/");
  if (
    normalizedSlashes.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalizedSlashes) ||
    normalizedSlashes.includes("\0")
  ) {
    throw new Error(`${field} must be a repository-relative path`);
  }

  const segments = normalizedSlashes.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new Error(`${field} cannot traverse outside the repository`);
  }

  const compact = segments
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");
  return compact || ".";
}

function normalizeCommands(commands: string[], field: string): string[] {
  return commands.map((command) => {
    const normalized = command.replace(/\r\n?/g, "\n").trim();
    if (/\0|[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
      throw new Error(`${field} contains an unsupported control character`);
    }
    return normalized;
  });
}

const reservedRuntimeEnvironmentNames = new Set([
  "BASH_ENV",
  "CI",
  "ENV",
  "HOME",
  "IFS",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "NODE_OPTIONS",
  "OLDPWD",
  "PATH",
  "PORT",
  "PWD",
  "SHELL",
]);

const credentialEnvironmentNamePattern = new RegExp(
  [
    "(?:^|_)(?:API_KEY|PRIVATE_KEY|SECRET_ACCESS_KEY|ACCESS_KEY_ID|CLIENT_SECRET|AUTH_TOKEN|ACCESS_TOKEN|REFRESH_TOKEN|WEBHOOK_SECRET|SIGNING_SECRET|ENCRYPTION_KEY)(?:_|$)",
    "(?:^|_)(?:SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS?|DSN|PAT)$",
    "^(?:DATABASE|REDIS|MONGODB|POSTGRES)_URL$",
  ].join("|"),
);

const credentialValuePatterns = [
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/,
  /(?:github_pat_|gh[pousr]_|glpat-|xox[baprs]-)[A-Za-z0-9_-]{16,}/,
  /(?:^|[^A-Za-z0-9])AKIA[0-9A-Z]{16}(?:$|[^A-Za-z0-9])/,
  /(?:^|[^A-Za-z0-9])(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/,
  /(?:^|[^A-Za-z0-9])sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/,
  /^Bearer\s+\S+/i,
  /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/,
  /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i,
  /(?:^|[?&;\s])(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)=[^\s&;]+/i,
];

function assertRuntimeEnvironmentName(name: string, secret: boolean): void {
  if (
    reservedRuntimeEnvironmentNames.has(name)
    || name.startsWith("CLOSESPAN_")
    || name.startsWith("TENKI_")
  ) {
    throw new Error(`Runtime environment variable ${name} is reserved`);
  }
  if (
    !secret
    && credentialEnvironmentNamePattern.test(name)
  ) {
    throw new Error(`Secret-looking environment variable ${name} must use the runtime secret vault`);
  }
}

function assertPublicEnvironmentValue(name: string, value: string): void {
  if (credentialValuePatterns.some((pattern) => pattern.test(value))) {
    throw new Error(`Secret-looking value for public environment variable ${name} must use the runtime secret vault`);
  }
}

function normalizePublicEnvironment(
  input: ExecutionProfilePublicEnvironmentVariable[],
): ExecutionProfilePublicEnvironmentVariable[] {
  return input.map((item) => {
    assertRuntimeEnvironmentName(item.name, false);
    assertPublicEnvironmentValue(item.name, item.value);
    if (/\0|[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(item.value)) {
      throw new Error(`Public environment variable ${item.name} contains an unsupported control character`);
    }
    return { name: item.name, value: item.value.replace(/\r\n?/g, "\n") };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeSecretBindings(
  input: ExecutionProfileSecretBinding[],
): ExecutionProfileSecretBinding[] {
  return input.map((item) => {
    assertRuntimeEnvironmentName(item.envName, true);
    return { ...item };
  }).sort((left, right) => left.envName.localeCompare(right.envName)
    || left.exposure.localeCompare(right.exposure)
    || left.secretVersion - right.secretVersion);
}

export function normalizeExecutionProfileScope(
  scope: Partial<ExecutionProfileScope>,
): ExecutionProfileScope {
  const repository = scope.repository?.trim() ?? "";
  if (
    repository &&
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
  ) {
    throw new Error("Repository must use the owner/name format");
  }
  const workspaceRoot = normalizeRelativePath(
    scope.workspaceRoot?.trim() || ".",
    "Workspace root",
  );
  if (!repository && workspaceRoot !== ".") {
    throw new Error("A workspace default profile must use the repository root");
  }
  return { repository, workspaceRoot };
}

export function sanitizeExecutionProfileConfig(
  input: unknown,
): ExecutionProfileConfig {
  const requestedVersion = input && typeof input === "object"
    ? (input as { schemaVersion?: unknown }).schemaVersion
    : undefined;
  const parsed = requestedVersion === 3
    ? executionProfileConfigV3InputSchema.parse(input)
    : requestedVersion === 2
      ? executionProfileConfigV2InputSchema.parse(input)
      : executionProfileConfigV1InputSchema.parse(input);
  const workingDirectory = normalizeRelativePath(
    parsed.workingDirectory,
    "Working directory",
  );
  if (/[*?{}[\]!]/.test(workingDirectory)) {
    throw new Error("Working directory must identify one concrete directory");
  }
  const permittedPaths = [...new Set(
    parsed.permittedPaths.map((path) => normalizeRelativePath(path, "Permitted path")),
  )].sort((left, right) => left.localeCompare(right));

  const base: ExecutionProfileConfigBase = {
    language: parsed.language.toLowerCase(),
    framework: parsed.framework,
    packageManager: parsed.packageManager.toLowerCase(),
    runtimeVersion: parsed.runtimeVersion,
    workingDirectory,
    installCommands: normalizeCommands(parsed.installCommands, "Install commands"),
    buildCommands: normalizeCommands(parsed.buildCommands, "Build commands"),
    testCommands: normalizeCommands(parsed.testCommands, "Test commands"),
    typecheckCommands: normalizeCommands(
      parsed.typecheckCommands,
      "Typecheck commands",
    ),
    permittedPaths,
    tenkiImage: parsed.tenkiImage,
    tenkiSnapshotId: parsed.tenkiSnapshotId,
    cpuCores: parsed.cpuCores,
    memoryMb: parsed.memoryMb,
    allowInbound: parsed.allowInbound,
    allowOutbound: parsed.allowOutbound,
    maxDurationMs: parsed.maxDurationMs,
    idleTimeoutMinutes: parsed.idleTimeoutMinutes,
  };
  if (parsed.schemaVersion === 1) {
    return { schemaVersion: 1, ...base };
  }
  const runtime = {
    ...base,
    automaticInstall: parsed.automaticInstall,
    automaticBuild: parsed.automaticBuild,
    publicEnvironment: normalizePublicEnvironment(parsed.publicEnvironment),
    secretBindings: normalizeSecretBindings(parsed.secretBindings),
    startCommand: parsed.startCommand === null
      ? null
      : normalizeCommands([parsed.startCommand], "Start command")[0]!,
    applicationPort: parsed.applicationPort,
    healthCheckPath: parsed.healthCheckPath,
    healthCheckTimeoutMs: parsed.healthCheckTimeoutMs,
    previewEnabled: parsed.previewEnabled,
    previewTtlMs: parsed.previewTtlMs,
    runtimeTools: { ...parsed.runtimeTools },
  };
  if (parsed.schemaVersion === 2) {
    return { schemaVersion: 2, ...runtime };
  }
  const executor = parsed.executor.kind === "tenki_sandbox"
    ? { kind: "tenki_sandbox" as const }
    : {
        ...parsed.executor,
        xcode: parsed.executor.xcode
          ? {
              ...parsed.executor.xcode,
              containerPath: normalizeRelativePath(
                parsed.executor.xcode.containerPath,
                "Xcode container path",
              ),
            }
          : null,
        androidEmulator: parsed.executor.androidEmulator
          ? { ...parsed.executor.androidEmulator }
          : null,
      };
  return { schemaVersion: 3, ...runtime, executor };
}

export function upgradeExecutionProfileConfigV2(
  input: unknown,
): ExecutionProfileConfigV2 {
  const config = sanitizeExecutionProfileConfig(input);
  if (config.schemaVersion === 2) return config;
  if (config.schemaVersion === 3) {
    const { executor, ...runtime } = config;
    void executor;
    return { ...runtime, schemaVersion: 2 };
  }
  return sanitizeExecutionProfileConfig({
    ...config,
    schemaVersion: 2,
    automaticInstall: config.installCommands.length > 0,
    automaticBuild: config.buildCommands.length > 0,
    publicEnvironment: [],
    secretBindings: [],
    startCommand: null,
    applicationPort: null,
    healthCheckPath: null,
    healthCheckTimeoutMs: 90_000,
    previewEnabled: false,
    previewTtlMs: 600_000,
    runtimeTools: { http: false, browser: false, logs: false },
  }) as ExecutionProfileConfigV2;
}

export function executionProfileUsesRuntimeContract(
  config: ExecutionProfileConfig,
): config is ExecutionProfileConfigV2 | ExecutionProfileConfigV3 {
  return config.schemaVersion === 2 || config.schemaVersion === 3;
}

export function assertExecutionProfileReadyForActivation(
  config: ExecutionProfileConfig,
): void {
  if (
    config.schemaVersion === 3
    && config.executor.kind === "tenki_github_actions"
    && !config.executor.workflowSha256
  ) {
    throw new Error(
      "Tenki GitHub Actions profiles require an immutable runner workflow SHA-256 before activation",
    );
  }
}

export function executionProfileExecutor(
  config: ExecutionProfileConfig,
): ExecutionProfileExecutor {
  return config.schemaVersion === 3
    ? config.executor
    : { kind: "tenki_sandbox" };
}

export const executionProfileConfigSchema = z.unknown().transform(
  (value, context): ExecutionProfileConfig => {
    try {
      return sanitizeExecutionProfileConfig(value);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error
          ? error.message
          : "Invalid execution profile configuration",
      });
      return z.NEVER;
    }
  },
);

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
}

export function canonicalExecutionProfileJson(input: unknown): string {
  return canonicalJson(sanitizeExecutionProfileConfig(input));
}

export function hashExecutionProfileConfig(input: unknown): string {
  return createHash("sha256")
    .update(canonicalExecutionProfileJson(input), "utf8")
    .digest("hex");
}

export const SAFE_GENERIC_EXECUTION_PROFILE_CONFIG: ExecutionProfileConfig =
  Object.freeze({
    schemaVersion: 1,
    language: "unknown",
    framework: null,
    packageManager: "unknown",
    runtimeVersion: null,
    workingDirectory: ".",
    installCommands: Object.freeze([]) as unknown as string[],
    buildCommands: Object.freeze([]) as unknown as string[],
    testCommands: Object.freeze([]) as unknown as string[],
    typecheckCommands: Object.freeze([]) as unknown as string[],
    permittedPaths: Object.freeze([]) as unknown as string[],
    tenkiImage: null,
    tenkiSnapshotId: null,
    cpuCores: 2,
    memoryMb: 4_096,
    allowInbound: false,
    allowOutbound: false,
    maxDurationMs: 1_800_000,
    idleTimeoutMinutes: 2,
  });

export function executionProfileSnapshot(
  profile: ExecutionProfileVersion,
): ExecutionProfileSnapshot {
  return {
    profileId: profile.id,
    version: profile.version,
    source: profile.source,
    repository: profile.repository,
    workspaceRoot: profile.workspaceRoot,
    contentHash: profile.contentHash,
    config: structuredClone(profile.config),
  };
}

type ExecutionProfileConfigCarrier =
  | ExecutionProfileConfig
  | ExecutionProfileSnapshot
  | ExecutionProfileVersion;

function configFromCarrier(
  input: ExecutionProfileConfigCarrier,
): ExecutionProfileConfig {
  return "config" in input
    ? sanitizeExecutionProfileConfig(input.config)
    : sanitizeExecutionProfileConfig(input);
}

function globMatches(pattern: string, path: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\?]/g, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*");
  return new RegExp(`^${escaped}$`).test(path);
}

function pathPatternIsNarrower(ticketPattern: string, allowedPattern: string): boolean {
  if (ticketPattern === allowedPattern || allowedPattern === "**/*") return true;
  if (!ticketPattern.includes("*") && globMatches(allowedPattern, ticketPattern)) {
    return true;
  }
  if (allowedPattern.endsWith("/**")) {
    const allowedPrefix = allowedPattern.slice(0, -3).replace(/\/$/, "");
    const ticketPrefix = ticketPattern.split("*")[0]?.replace(/\/$/, "") ?? "";
    return ticketPrefix === allowedPrefix || ticketPrefix.startsWith(`${allowedPrefix}/`);
  }
  return false;
}

export function assertExecutionProfileScopeBoundary(
  scopeInput: ExecutionProfileScope,
  configInput: unknown,
): void {
  const scope = normalizeExecutionProfileScope(scopeInput);
  const config = sanitizeExecutionProfileConfig(configInput);
  if (!scope.repository && config.workingDirectory !== ".") {
    throw new Error("A workspace default profile must run from the repository root");
  }
  if (scope.workspaceRoot === ".") return;
  if (
    config.workingDirectory !== scope.workspaceRoot &&
    !config.workingDirectory.startsWith(`${scope.workspaceRoot}/`)
  ) {
    throw new Error("Execution profile working directory is outside its workspace root");
  }
  const rootBoundary = `${scope.workspaceRoot}/**`;
  for (const permittedPath of config.permittedPaths) {
    if (!pathPatternIsNarrower(permittedPath, rootBoundary)) {
      throw new Error(
        `Execution profile permitted path is outside its workspace root: ${permittedPath}`,
      );
    }
  }
}

export function assertExecutionProfileNarrowing(
  profile: ExecutionProfileConfigCarrier,
  ticket: { permittedPaths: string[]; requiredCommands: string[] },
): void {
  const config = configFromCarrier(profile);
  const permittedPaths = ticket.permittedPaths.map((path) =>
    normalizeRelativePath(path, "Ticket permitted path"),
  );
  const requiredCommands = normalizeCommands(
    ticket.requiredCommands,
    "Ticket required commands",
  );

  for (const path of permittedPaths) {
    if (!config.permittedPaths.some((allowed) => pathPatternIsNarrower(path, allowed))) {
      throw new Error(`Ticket permitted path is broader than the execution profile: ${path}`);
    }
  }

  const allowedCommands = new Set([
    ...config.installCommands,
    ...config.buildCommands,
    ...config.testCommands,
    ...config.typecheckCommands,
  ]);
  for (const command of requiredCommands) {
    if (!allowedCommands.has(command)) {
      throw new Error(`Ticket command is not allowed by the execution profile: ${command}`);
    }
  }
}

function requireProfileScope(
  profile: ExecutionProfileVersion,
  orgId: string,
  scope: ExecutionProfileScope,
  label: string,
): void {
  if (profile.orgId !== orgId) {
    throw new Error(`${label} belongs to a different organization`);
  }
  if (
    profile.repository !== scope.repository ||
    profile.workspaceRoot !== scope.workspaceRoot
  ) {
    throw new Error(`${label} does not match the requested repository scope`);
  }
  if (hashExecutionProfileConfig(profile.config) !== profile.contentHash) {
    throw new Error(`${label} content hash does not match its configuration`);
  }
}

export function resolveExecutionProfile(
  input: ExecutionProfileResolutionInput,
): ResolvedExecutionProfile {
  const repositoryScope = normalizeExecutionProfileScope({
    repository: input.repository,
    workspaceRoot: input.workspaceRoot,
  });
  const workspaceScope = normalizeExecutionProfileScope({ repository: "" });

  if (input.ticketOverride) {
    if (input.ticketOverride.source === "detected") {
      throw new Error("A detected suggestion cannot be used as a ticket override");
    }
    requireProfileScope(
      input.ticketOverride,
      input.orgId,
      repositoryScope,
      "Ticket execution profile",
    );
    return {
      profile: input.ticketOverride,
      snapshot: executionProfileSnapshot(input.ticketOverride),
      resolution: "ticket_override",
    };
  }

  if (input.repositoryAssignment) {
    if (input.repositoryAssignment.source === "detected") {
      throw new Error("A detected suggestion cannot be used as an active repository profile");
    }
    requireProfileScope(
      input.repositoryAssignment,
      input.orgId,
      {
        repository: input.repositoryAssignment.repository,
        workspaceRoot: input.repositoryAssignment.workspaceRoot,
      },
      "Repository execution profile",
    );
    if (
      input.repositoryAssignment.repository !== repositoryScope.repository ||
      ![
        repositoryScope.workspaceRoot,
        ".",
      ].includes(input.repositoryAssignment.workspaceRoot)
    ) {
      throw new Error(
        "Repository execution profile does not match the requested repository scope",
      );
    }
    return {
      profile: input.repositoryAssignment,
      snapshot: executionProfileSnapshot(input.repositoryAssignment),
      resolution: "repository_assignment",
    };
  }

  if (input.workspaceDefault) {
    if (input.workspaceDefault.source === "detected") {
      throw new Error("A detected suggestion cannot be used as an active workspace profile");
    }
    requireProfileScope(
      input.workspaceDefault,
      input.orgId,
      workspaceScope,
      "Workspace default execution profile",
    );
    return {
      profile: input.workspaceDefault,
      snapshot: executionProfileSnapshot(input.workspaceDefault),
      resolution: "workspace_default",
    };
  }

  requireProfileScope(
    input.safeGeneric,
    input.orgId,
    workspaceScope,
    "Safe generic execution profile",
  );
  if (input.safeGeneric.source !== "safe_generic") {
    throw new Error("Safe generic fallback must use the safe_generic source");
  }
  return {
    profile: input.safeGeneric,
    snapshot: executionProfileSnapshot(input.safeGeneric),
    resolution: "safe_generic",
  };
}
