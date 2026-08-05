import { createHash } from "node:crypto";
import { z } from "zod";

export const executionProfileSources = [
  "detected",
  "confirmed",
  "override",
  "safe_generic",
] as const;

export type ExecutionProfileSource = (typeof executionProfileSources)[number];

const commandListSchema = z
  .array(z.string().trim().min(1).max(1_000))
  .max(30)
  .default([]);

const nullableLabelSchema = z
  .union([z.string().trim().min(1).max(120), z.null()])
  .default(null);

const executionProfileConfigInputSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
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
  })
  .strict()
  .superRefine((value, context) => {
    if (value.tenkiImage && value.tenkiSnapshotId) {
      context.addIssue({
        code: "custom",
        path: ["tenkiSnapshotId"],
        message: "Configure either a Tenki image or snapshot, not both",
      });
    }
  });

export interface ExecutionProfileConfig {
  schemaVersion: 1;
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
  const parsed = executionProfileConfigInputSchema.parse(input);
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

  return {
    schemaVersion: 1,
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
