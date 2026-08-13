import { createHash } from "node:crypto";
import {
  TENKI_BROWSER_PREFLIGHT_COMMAND,
  playwrightChromiumInstallCommand,
} from "./execution-profile";
import {
  saveDetectedExecutionProfileSuggestion,
  type ExecutionProfileActor,
} from "./execution-profile-repository";
import { createGithubInstallationClient } from "./github-app-auth";
import {
  resolveManagedTenkiEnvironment,
} from "./tenki-environment-catalog-repository";
import type {
  ManagedTenkiEnvironmentArtifact,
  ManagedTenkiEnvironmentRequest,
} from "./tenki-environment-catalog";
import {
  assessTenkiRunnerWorkload,
  assertTenkiRunnerLabel,
  tenkiRunnerSize,
} from "./tenki-runner-sizing";

const DETECTOR_VERSION = 6;
const TENKI_RUNNER_WORKFLOW_PATH = ".github/workflows/closespan-agent-runner.yml";
const TENKI_RUNNER_PROBE_WORKFLOW_PATH = ".github/workflows/closespan-runner-sizing.yml";
const PRIMARY_MANIFESTS = new Set([
  "package.json",
  "deno.json",
  "deno.jsonc",
  "pyproject.toml",
  "requirements.txt",
  "Pipfile",
  "Cargo.toml",
  "go.mod",
  "Gemfile",
  "composer.json",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "mix.exs",
  "Package.swift",
  "Podfile",
  "project.pbxproj",
]);
const AUXILIARY_MANIFESTS = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "uv.lock",
  "poetry.lock",
  "Pipfile.lock",
  "Cargo.lock",
  "go.sum",
  "Gemfile.lock",
  "composer.lock",
  "gradle.properties",
  "settings.gradle",
  "settings.gradle.kts",
  "Package.resolved",
  "Podfile.lock",
  "contents.xcworkspacedata",
  "closespan-agent-runner.yml",
  "closespan-agent-runner.yaml",
  "closespan-runner-sizing.yml",
  "closespan-runner-sizing.yaml",
]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
]);

export interface RepositoryDetectionLimits {
  maxTreeDepth: number;
  maxTreeRequests: number;
  maxTreeEntries: number;
  maxManifestFiles: number;
  maxManifestBytes: number;
  maxTotalManifestBytes: number;
}

const DEFAULT_LIMITS: RepositoryDetectionLimits = {
  maxTreeDepth: 3,
  maxTreeRequests: 48,
  maxTreeEntries: 4_096,
  maxManifestFiles: 96,
  maxManifestBytes: 128 * 1_024,
  maxTotalManifestBytes: 512 * 1_024,
};

interface GithubTreeEntry {
  path?: string;
  mode?: string;
  type?: string;
  sha?: string;
  size?: number;
}

export interface RepositoryMetadataGithubClient {
  rest: {
    git: {
      getRef(input: { owner: string; repo: string; ref: string }): Promise<{
        data: { object: { sha: string } };
      }>;
      getCommit(input: { owner: string; repo: string; commit_sha: string }): Promise<{
        data: { tree: { sha: string } };
      }>;
      getTree(input: { owner: string; repo: string; tree_sha: string }): Promise<{
        data: { tree: GithubTreeEntry[]; truncated?: boolean };
      }>;
      getBlob(input: { owner: string; repo: string; file_sha: string }): Promise<{
        data: { content?: string; encoding?: string; size?: number };
      }>;
    };
  };
}

export type DetectedLanguage =
  | "javascript"
  | "typescript"
  | "python"
  | "rust"
  | "go"
  | "ruby"
  | "php"
  | "java"
  | "kotlin"
  | "elixir"
  | "swift"
  | "unknown";

export type DetectedExecutionPlatform = "generic" | "ios" | "android";

export interface SuggestedExecutionCommands {
  install: string | null;
  build: string | null;
  test: string | null;
  typecheck: string | null;
}

export interface SuggestedRunningApplication {
  startCommand: string;
  port: number;
  healthPath: string;
  browserDependencyDetected: boolean;
}

export interface DetectedRepositoryProfileSuggestion {
  repository: string;
  root: string;
  defaultBranch: string;
  sourceSha: string;
  language: DetectedLanguage;
  platform: DetectedExecutionPlatform;
  framework: string | null;
  packageManager: string | null;
  runtime: string | null;
  commands: SuggestedExecutionCommands;
  application: SuggestedRunningApplication | null;
  environment: {
    image: "sandbox";
    snapshotId: null;
    runtimeFamily: string | null;
  };
  manifestPaths: string[];
  confidence: number;
  reviewState: "Pending review";
  active: false;
  detectorVersion: number;
  dependencyFingerprint: string;
  detectionHash: string;
  runnerWorkflowSha256: string | null;
  runnerProbeWorkflowSha256: string | null;
  xcode: {
    version: string;
    containerKind: "workspace" | "project" | "package";
    containerPath: string;
    scheme: string;
    configuration: "Debug";
    destination: string;
  } | null;
  androidEmulator: {
    apiLevel: number;
    target: "google_apis";
    architecture: "x86_64";
    deviceProfile: string;
    gradleTask: string;
  } | null;
}

export interface GithubRepositoryProfileDetection {
  repository: string;
  defaultBranch: string;
  sourceSha: string;
  profiles: DetectedRepositoryProfileSuggestion[];
  evidence: {
    treeEntriesInspected: number;
    treeRequests: number;
    manifestFilesRead: number;
    manifestBytesRead: number;
    limitsReached: boolean;
  };
}

export interface RepositoryProfileSuggestionStore {
  saveDetectedSuggestion(input: {
    orgId: string;
    suggestion: DetectedRepositoryProfileSuggestion;
    evidence: GithubRepositoryProfileDetection["evidence"];
  }): Promise<unknown>;
}

export interface RepositoryProfileDetectionDependencies {
  github?: RepositoryMetadataGithubClient;
  limits?: Partial<RepositoryDetectionLimits>;
  managedEnvironmentResolver?: {
    resolve(input: ManagedTenkiEnvironmentRequest): Promise<ManagedTenkiEnvironmentArtifact | null>;
  };
}

interface ManifestMetadata {
  path: string;
  name: string;
  root: string;
  sha: string;
  size: number;
}

interface ReadManifest extends ManifestMetadata {
  content: string;
}

interface ProfileDraft {
  language: DetectedLanguage;
  platform: DetectedExecutionPlatform;
  framework: string | null;
  packageManager: string | null;
  runtime: string | null;
  commands: SuggestedExecutionCommands;
  application?: SuggestedRunningApplication | null;
  runtimeFamily: string | null;
  confidence: number;
  xcode?: DetectedRepositoryProfileSuggestion["xcode"];
  androidEmulator?: DetectedRepositoryProfileSuggestion["androidEmulator"];
}

function repositoryCoordinates(repository: string): { owner: string; repo: string } {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repository);
  if (!match) throw new Error("GitHub repository must use the owner/name format");
  return { owner: match[1], repo: match[2] };
}

function validSha(value: string): string {
  if (!/^[a-f0-9]{40,64}$/i.test(value)) throw new Error("GitHub returned an invalid commit SHA");
  return value.toLowerCase();
}

function joinedPath(parent: string, child: string): string {
  return parent ? `${parent}/${child}` : child;
}

function manifestName(name: string): boolean {
  return PRIMARY_MANIFESTS.has(name)
    || AUXILIARY_MANIFESTS.has(name)
    || name.endsWith(".xcscheme");
}

function manifestRoot(directory: string, name: string): string {
  if (name === "project.pbxproj" && directory.endsWith(".xcodeproj")) {
    return directory.split("/").slice(0, -1).join("/") || ".";
  }
  if (
    (name === "contents.xcworkspacedata" || name.endsWith(".xcscheme"))
    && /\.(?:xcodeproj|xcworkspace)(?:\/|$)/.test(directory)
  ) {
    const segments = directory.split("/");
    const containerIndex = segments.findIndex((segment) => /\.(?:xcodeproj|xcworkspace)$/.test(segment));
    return segments.slice(0, Math.max(containerIndex, 0)).join("/") || ".";
  }
  return directory || ".";
}

function safeLimits(overrides: Partial<RepositoryDetectionLimits> = {}): RepositoryDetectionLimits {
  const merged = { ...DEFAULT_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error(`Repository detection limit ${key} must be a positive integer`);
  }
  return merged;
}

async function inspectManifestTree(
  github: RepositoryMetadataGithubClient,
  repository: { owner: string; repo: string },
  rootTreeSha: string,
  limits: RepositoryDetectionLimits,
): Promise<{
  manifests: ManifestMetadata[];
  treeEntriesInspected: number;
  treeRequests: number;
  limitsReached: boolean;
}> {
  const queue: Array<{ path: string; sha: string; depth: number }> = [
    { path: "", sha: rootTreeSha, depth: 0 },
  ];
  const manifests: ManifestMetadata[] = [];
  let treeEntriesInspected = 0;
  let treeRequests = 0;
  let limitsReached = false;

  while (queue.length && treeRequests < limits.maxTreeRequests) {
    const directory = queue.shift();
    if (!directory) break;
    const response = await github.rest.git.getTree({
      ...repository,
      tree_sha: directory.sha,
    });
    treeRequests += 1;
    if (response.data.truncated) limitsReached = true;

    for (const entry of response.data.tree) {
      if (treeEntriesInspected >= limits.maxTreeEntries) {
        limitsReached = true;
        break;
      }
      treeEntriesInspected += 1;
      if (!entry.path || !entry.sha || entry.path.includes("/")) continue;
      const path = joinedPath(directory.path, entry.path);
      if (
        entry.type === "tree" &&
        directory.depth < limits.maxTreeDepth &&
        !IGNORED_DIRECTORIES.has(entry.path) &&
        queue.length + treeRequests < limits.maxTreeRequests
      ) {
        queue.push({ path, sha: entry.sha, depth: directory.depth + 1 });
      } else if (
        entry.type === "blob" &&
        entry.mode !== "120000" &&
        manifestName(entry.path) &&
        manifests.length < limits.maxManifestFiles
      ) {
        manifests.push({
          path,
          name: entry.path,
          root: manifestRoot(directory.path, entry.path),
          sha: entry.sha,
          size: typeof entry.size === "number" ? entry.size : 0,
        });
      }
    }
    if (treeEntriesInspected >= limits.maxTreeEntries) break;
  }
  if (queue.length || manifests.length >= limits.maxManifestFiles) limitsReached = true;
  return {
    manifests: manifests.sort((left, right) => left.path.localeCompare(right.path)),
    treeEntriesInspected,
    treeRequests,
    limitsReached,
  };
}

async function readManifests(
  github: RepositoryMetadataGithubClient,
  repository: { owner: string; repo: string },
  metadata: ManifestMetadata[],
  limits: RepositoryDetectionLimits,
): Promise<{ files: ReadManifest[]; bytesRead: number; limitsReached: boolean }> {
  const files: ReadManifest[] = [];
  let bytesRead = 0;
  let limitsReached = false;
  for (const manifest of metadata) {
    if (manifest.size > limits.maxManifestBytes) {
      limitsReached = true;
      continue;
    }
    if (bytesRead >= limits.maxTotalManifestBytes) {
      limitsReached = true;
      break;
    }
    const response = await github.rest.git.getBlob({
      ...repository,
      file_sha: manifest.sha,
    });
    if (response.data.encoding !== "base64" || typeof response.data.content !== "string") continue;
    const content = Buffer.from(response.data.content.replaceAll("\n", ""), "base64");
    if (
      content.byteLength > limits.maxManifestBytes ||
      bytesRead + content.byteLength > limits.maxTotalManifestBytes
    ) {
      limitsReached = true;
      continue;
    }
    bytesRead += content.byteLength;
    files.push({ ...manifest, size: content.byteLength, content: content.toString("utf8") });
  }
  return { files, bytesRead, limitsReached };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length <= 120 ? value : null;
}

function dependencyNames(packageJson: Record<string, unknown>): Set<string> {
  return new Set([
    ...Object.keys(record(packageJson.dependencies)),
    ...Object.keys(record(packageJson.devDependencies)),
  ]);
}

function detectJavascriptFramework(dependencies: Set<string>): string | null {
  const frameworks: Array<[string, string]> = [
    ["next", "Next.js"],
    ["@remix-run/react", "Remix"],
    ["nuxt", "Nuxt"],
    ["@sveltejs/kit", "SvelteKit"],
    ["svelte", "Svelte"],
    ["@angular/core", "Angular"],
    ["astro", "Astro"],
    ["vite", "Vite"],
    ["vue", "Vue"],
    ["react", "React"],
    ["express", "Express"],
    ["fastify", "Fastify"],
    ["nestjs", "NestJS"],
    ["@nestjs/core", "NestJS"],
  ];
  return frameworks.find(([dependency]) => dependencies.has(dependency))?.[1] ?? null;
}

function packageManagerFromFiles(files: ReadManifest[], packageJson: Record<string, unknown>): string {
  const names = new Set(files.map((file) => file.name));
  if (names.has("pnpm-lock.yaml")) return "pnpm";
  if (names.has("yarn.lock")) return "yarn";
  if (names.has("bun.lock") || names.has("bun.lockb")) return "bun";
  if (names.has("package-lock.json") || names.has("npm-shrinkwrap.json")) return "npm";
  const declared = stringField(packageJson.packageManager)?.split("@")[0];
  return declared && ["npm", "pnpm", "yarn", "bun"].includes(declared) ? declared : "npm";
}

function javascriptCommand(packageManager: string, script: string): string {
  if (packageManager === "npm" && script === "test") return "npm test";
  if (packageManager === "yarn") return `yarn ${script}`;
  return `${packageManager} run ${script}`;
}

function detectedJavascriptApplication(
  packageManager: string,
  framework: string | null,
  scripts: Record<string, unknown>,
  dependencies: Set<string>,
): SuggestedRunningApplication | null {
  const scriptName = typeof scripts.start === "string"
    ? "start"
    : typeof scripts.dev === "string"
      ? "dev"
      : null;
  if (!scriptName) return null;
  const script = String(scripts[scriptName]);
  const explicitPort = /(?:--port(?:=|\s+)|(?:^|\s)-p\s+)(\d{2,5})(?:\s|$)/.exec(script)?.[1];
  const defaults: Record<string, number> = {
    "Angular": 4200,
    "Astro": 4321,
    "SvelteKit": scriptName === "start" ? 3000 : 5173,
    "Vite": scriptName === "start" ? 4173 : 5173,
  };
  const port = explicitPort ? Number(explicitPort) : defaults[framework ?? ""] ?? 3000;
  if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535) return null;
  return {
    startCommand: javascriptCommand(packageManager, scriptName),
    port,
    healthPath: "/",
    browserDependencyDetected:
      dependencies.has("playwright") || dependencies.has("@playwright/test"),
  };
}

function detectJavascript(files: ReadManifest[]): ProfileDraft {
  const denoFile = files.find((file) => file.name === "deno.json");
  if (denoFile || files.some((file) => file.name === "deno.jsonc")) {
    let deno: Record<string, unknown> = {};
    try {
      deno = record(JSON.parse(denoFile?.content ?? "{}"));
    } catch {
      // JSONC is intentionally not evaluated; the generic Deno profile remains reviewable.
    }
    const tasks = record(deno.tasks);
    return {
      platform: "generic",
      language: "typescript",
      framework: null,
      packageManager: "deno",
      runtime: "deno",
      commands: {
        install: null,
        build: typeof tasks.build === "string" ? "deno task build" : null,
        test: typeof tasks.test === "string" ? "deno task test" : "deno test",
        typecheck: typeof tasks.typecheck === "string" ? "deno task typecheck" : null,
      },
      runtimeFamily: "deno",
      confidence: denoFile ? 0.9 : 0.82,
    };
  }
  const packageFile = files.find((file) => file.name === "package.json");
  let packageJson: Record<string, unknown> = {};
  try {
    packageJson = record(JSON.parse(packageFile?.content ?? "{}"));
  } catch {
    // Malformed repository metadata remains a reviewable low-confidence suggestion.
  }
  const dependencies = dependencyNames(packageJson);
  const scripts = record(packageJson.scripts);
  const packageManager = packageManagerFromFiles(files, packageJson);
  const framework = detectJavascriptFramework(dependencies);
  const names = new Set(files.map((file) => file.name));
  const install = packageManager === "pnpm"
    ? "pnpm install --frozen-lockfile --ignore-scripts"
    : packageManager === "yarn"
      ? "yarn install --immutable --mode=skip-build"
      : packageManager === "bun"
        ? "bun install --frozen-lockfile --ignore-scripts"
        : names.has("package-lock.json") || names.has("npm-shrinkwrap.json")
          ? "npm ci --ignore-scripts"
          : "npm install --ignore-scripts";
  const typecheckScript = ["typecheck", "type-check", "check:types"]
    .find((name) => typeof scripts[name] === "string");
  const engines = record(packageJson.engines);
  const nodeVersion = stringField(engines.node);
  const usesTypescript = dependencies.has("typescript") || Boolean(typecheckScript);
  return {
    platform: "generic",
    language: usesTypescript ? "typescript" : "javascript",
    framework,
    packageManager,
    runtime: nodeVersion ? `node ${nodeVersion}` : "node",
    commands: {
      install,
      build: typeof scripts.build === "string" ? javascriptCommand(packageManager, "build") : null,
      test: typeof scripts.test === "string" ? javascriptCommand(packageManager, "test") : null,
      typecheck: typecheckScript ? javascriptCommand(packageManager, typecheckScript) : null,
    },
    application: detectedJavascriptApplication(
      packageManager,
      framework,
      scripts,
      dependencies,
    ),
    runtimeFamily: "node",
    confidence: packageFile ? (names.size > 1 ? 0.96 : 0.9) : 0.65,
  };
}

function containsDependency(content: string, name: string): boolean {
  return new RegExp(`(?:^|[\\s\"'])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[\\s\"'=<>~!]|$)`, "im")
    .test(content);
}

function detectPython(files: ReadManifest[]): ProfileDraft {
  const content = files.map((file) => file.content).join("\n");
  const names = new Set(files.map((file) => file.name));
  const packageManager = names.has("uv.lock")
    ? "uv"
    : names.has("poetry.lock") || /\[tool\.poetry\]/.test(content)
      ? "poetry"
      : names.has("Pipfile") || names.has("Pipfile.lock")
        ? "pipenv"
        : "pip";
  const runtimeVersion = /requires-python\s*=\s*["']([^"']{1,80})["']/i.exec(content)?.[1];
  const framework = containsDependency(content, "django")
    ? "Django"
    : containsDependency(content, "fastapi")
      ? "FastAPI"
      : containsDependency(content, "flask")
        ? "Flask"
        : null;
  const install = packageManager === "uv"
    ? "uv sync --frozen --no-install-project"
    : packageManager === "poetry"
      ? "poetry install --no-root --no-interaction"
      : packageManager === "pipenv"
        ? "pipenv sync --dev"
        : names.has("requirements.txt")
          ? "python -m pip install --requirement requirements.txt"
          : "python -m pip install --editable . --no-deps";
  return {
    platform: "generic",
    language: "python",
    framework,
    packageManager,
    runtime: runtimeVersion ? `python ${runtimeVersion}` : "python",
    commands: {
      install,
      build: names.has("pyproject.toml") ? "python -m build" : null,
      test: containsDependency(content, "pytest") ? "python -m pytest" : null,
      typecheck: containsDependency(content, "mypy")
        ? "python -m mypy ."
        : containsDependency(content, "pyright") ? "pyright" : null,
    },
    runtimeFamily: "python",
    confidence: names.size > 1 ? 0.94 : 0.86,
  };
}

function detectCompiled(files: ReadManifest[]): ProfileDraft {
  const names = new Set(files.map((file) => file.name));
  const content = files.map((file) => file.content).join("\n");
  if (names.has("Cargo.toml")) {
    const version = /rust-version\s*=\s*["']([^"']{1,40})["']/i.exec(content)?.[1];
    return {
      platform: "generic",
      language: "rust", framework: null, packageManager: "cargo",
      runtime: version ? `rust ${version}` : "rust",
      commands: {
        install: names.has("Cargo.lock") ? "cargo fetch --locked" : "cargo fetch",
        build: names.has("Cargo.lock") ? "cargo build --locked" : "cargo build",
        test: names.has("Cargo.lock") ? "cargo test --locked" : "cargo test",
        typecheck: names.has("Cargo.lock") ? "cargo check --locked" : "cargo check",
      },
      runtimeFamily: "rust", confidence: 0.93,
    };
  }
  if (names.has("go.mod")) {
    const version = /^go\s+([^\s]+)$/m.exec(content)?.[1];
    return {
      platform: "generic",
      language: "go", framework: null, packageManager: "go modules",
      runtime: version ? `go ${version}` : "go",
      commands: {
        install: "go mod download", build: "go build ./...", test: "go test ./...", typecheck: "go vet ./...",
      },
      runtimeFamily: "go", confidence: 0.93,
    };
  }
  const android = /com\.android\.(?:application|library)|id\s*[('\"]+com\.android\./i.test(content);
  const kotlin = /org\.jetbrains\.kotlin|kotlin\s*\(/i.test(content);
  const maven = names.has("pom.xml");
  if (android) {
    return {
      platform: "android",
      language: kotlin ? "kotlin" : "java",
      framework: "Android",
      packageManager: "gradle",
      runtime: "android",
      commands: {
        install: "./gradlew dependencies",
        build: "./gradlew assembleDebug",
        test: "./gradlew testDebugUnitTest",
        typecheck: "./gradlew lintDebug",
      },
      runtimeFamily: "android",
      confidence: 0.96,
      androidEmulator: {
        apiLevel: 35,
        target: "google_apis",
        architecture: "x86_64",
        deviceProfile: "pixel_7",
        gradleTask: ":app:connectedDebugAndroidTest",
      },
    };
  }
  return {
    platform: "generic",
    language: kotlin ? "kotlin" : "java",
    framework: /spring-boot/i.test(content) ? "Spring Boot" : null,
    packageManager: maven ? "maven" : "gradle",
    runtime: "jvm",
    commands: maven
      ? { install: "./mvnw dependency:go-offline", build: "./mvnw package -DskipTests", test: "./mvnw test", typecheck: "./mvnw verify -DskipTests" }
      : { install: "./gradlew dependencies", build: "./gradlew assemble", test: "./gradlew test", typecheck: "./gradlew check" },
    runtimeFamily: "jvm",
    confidence: 0.88,
  };
}

function detectOther(files: ReadManifest[]): ProfileDraft {
  const names = new Set(files.map((file) => file.name));
  const content = files.map((file) => file.content).join("\n");
  if (names.has("Gemfile")) return {
    platform: "generic",
    language: "ruby", framework: containsDependency(content, "rails") ? "Rails" : null,
    packageManager: "bundler", runtime: "ruby",
    commands: { install: "bundle install", build: null, test: "bundle exec rake test", typecheck: null },
    runtimeFamily: "ruby", confidence: 0.86,
  };
  if (names.has("composer.json")) return {
    platform: "generic",
    language: "php", framework: /laravel\/framework/i.test(content) ? "Laravel" : null,
    packageManager: "composer", runtime: "php",
    commands: { install: "composer install --no-interaction --no-scripts", build: null, test: "composer test", typecheck: null },
    runtimeFamily: "php", confidence: 0.86,
  };
  if (names.has("mix.exs")) return {
    platform: "generic",
    language: "elixir", framework: /phoenix/i.test(content) ? "Phoenix" : null,
    packageManager: "mix", runtime: "elixir",
    commands: { install: "mix deps.get", build: "mix compile --warnings-as-errors", test: "mix test", typecheck: null },
    runtimeFamily: "elixir", confidence: 0.86,
  };
  return {
    platform: "generic",
    language: "unknown", framework: null, packageManager: null, runtime: null,
    commands: { install: null, build: null, test: null, typecheck: null },
    runtimeFamily: null, confidence: 0.35,
  };
}

function xcodeContainer(files: ReadManifest[]): {
  kind: "workspace" | "project" | "package";
  path: string;
} {
  const workspace = files.find(
    (file) => file.name === "contents.xcworkspacedata"
      && !file.path.includes(".xcodeproj/"),
  );
  if (workspace) {
    const marker = ".xcworkspace/";
    return { kind: "workspace", path: `${workspace.path.split(marker)[0]}.xcworkspace` };
  }
  const project = files.find((file) => file.name === "project.pbxproj");
  if (project) {
    const marker = ".xcodeproj/";
    return { kind: "project", path: `${project.path.split(marker)[0]}.xcodeproj` };
  }
  return { kind: "package", path: "Package.swift" };
}

function shellArgument(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function detectedXcodeVersion(content: string): string {
  const checks = [...content.matchAll(/(?:LastUpgradeCheck|LastSwiftUpdateCheck)\s*=\s*(\d{4})\s*;/g)]
    .map((match) => Number.parseInt(match[1], 10))
    .filter(Number.isFinite);
  if (!checks.length) return "16";
  const newest = Math.max(...checks);
  return `${Math.floor(newest / 100)}.${Math.floor((newest % 100) / 10)}`;
}

function detectSwift(files: ReadManifest[]): ProfileDraft {
  const names = new Set(files.map((file) => file.name));
  const content = files.map((file) => file.content).join("\n");
  const container = xcodeContainer(files);
  const projectName = container.path.split("/").at(-1)?.replace(/\.(?:xcodeproj|xcworkspace)$/, "") || "App";
  const schemeFile = files.find((file) => file.name.endsWith(".xcscheme"));
  const scheme = schemeFile?.name.replace(/\.xcscheme$/, "") || projectName;
  const ios = container.kind !== "package" && /IPHONEOS_DEPLOYMENT_TARGET|SDKROOT\s*=\s*iphoneos|TARGETED_DEVICE_FAMILY/i.test(content);
  if (!ios) {
    return {
      platform: "generic",
      language: "swift",
      framework: "Swift Package",
      packageManager: "swiftpm",
      runtime: "swift",
      commands: { install: "swift package resolve", build: "swift build", test: "swift test", typecheck: null },
      runtimeFamily: "swift",
      confidence: names.has("Package.swift") ? 0.9 : 0.7,
    };
  }
  const containerFlag = container.kind === "workspace" ? "-workspace" : "-project";
  const base = `xcodebuild ${containerFlag} ${shellArgument(container.path)} -scheme ${shellArgument(scheme)} -configuration Debug -sdk iphonesimulator -destination ${shellArgument("platform=iOS Simulator,name=iPhone 16")} CODE_SIGNING_ALLOWED=NO`;
  return {
    platform: "ios",
    language: "swift",
    framework: /SwiftUI/i.test(content) ? "SwiftUI" : "iOS",
    packageManager: names.has("Podfile") ? "cocoapods" : "xcode",
    runtime: "xcode",
    commands: {
      install: names.has("Podfile") ? "bundle exec pod install" : null,
      build: `${base} build`,
      // PDD materializes this immutable, standalone Swift acceptance script
      // before implementation and verification commands run. It does not
      // require a repository to already maintain an XCTest target.
      test: "swift tests/CloseSpanPDDTests.swift",
      typecheck: null,
    },
    runtimeFamily: "ios",
    confidence: 0.96,
    xcode: {
      version: detectedXcodeVersion(content),
      containerKind: container.kind,
      containerPath: container.path,
      scheme,
      configuration: "Debug",
      destination: "platform=iOS Simulator,name=iPhone 16",
    },
  };
}

function profileDraft(files: ReadManifest[]): ProfileDraft {
  const names = new Set(files.map((file) => file.name));
  if (names.has("project.pbxproj") || names.has("Package.swift"))
    return detectSwift(files);
  if (names.has("package.json") || names.has("deno.json") || names.has("deno.jsonc"))
    return detectJavascript(files);
  if (names.has("pyproject.toml") || names.has("requirements.txt") || names.has("Pipfile"))
    return detectPython(files);
  if (names.has("Cargo.toml") || names.has("go.mod") || names.has("pom.xml") || names.has("build.gradle") || names.has("build.gradle.kts"))
    return detectCompiled(files);
  return detectOther(files);
}

function detectionHash(input: Omit<DetectedRepositoryProfileSuggestion, "detectionHash">): string {
  return createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
}

function suggestion(input: {
  repository: string;
  root: string;
  defaultBranch: string;
  sourceSha: string;
  files: ReadManifest[];
  runnerWorkflowSha256: string | null;
  runnerProbeWorkflowSha256: string | null;
}): DetectedRepositoryProfileSuggestion {
  const draftFiles = input.root === "."
    ? input.files
    : input.files.map((file) => ({
        ...file,
        path: file.path.startsWith(`${input.root}/`)
          ? file.path.slice(input.root.length + 1)
          : file.path,
      }));
  const draft = profileDraft(draftFiles);
  const dependencyFingerprint = createHash("sha256")
    .update(JSON.stringify(input.files
      .filter((file) => PRIMARY_MANIFESTS.has(file.name) || AUXILIARY_MANIFESTS.has(file.name))
      .map((file) => [file.path, file.sha, createHash("sha256").update(file.content).digest("hex")])
      .sort((left, right) => left[0].localeCompare(right[0]))))
    .digest("hex");
  const base = {
    repository: input.repository,
    root: input.root,
    defaultBranch: input.defaultBranch,
    sourceSha: input.sourceSha,
    language: draft.language,
    platform: draft.platform,
    framework: draft.framework,
    packageManager: draft.packageManager,
    runtime: draft.runtime,
    commands: draft.commands,
    application: draft.application ?? null,
    environment: {
      image: "sandbox" as const,
      snapshotId: null,
      runtimeFamily: draft.runtimeFamily,
    },
    manifestPaths: input.files.map((file) => file.path).sort(),
    confidence: draft.confidence,
    reviewState: "Pending review" as const,
    active: false as const,
    detectorVersion: DETECTOR_VERSION,
    dependencyFingerprint,
    runnerWorkflowSha256: input.runnerWorkflowSha256,
    runnerProbeWorkflowSha256: input.runnerProbeWorkflowSha256,
    xcode: draft.xcode ?? null,
    androidEmulator: draft.androidEmulator ?? null,
  };
  return { ...base, detectionHash: detectionHash(base) };
}

function filesForRoot(files: ReadManifest[], root: string): ReadManifest[] {
  const direct = files.filter((file) => file.root === root);
  if (root === ".") return direct;
  const directNames = new Set(direct.map((file) => file.name));
  const inheritable = directNames.has("package.json")
    ? new Set(["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "yarn.lock", "bun.lock", "bun.lockb"])
    : directNames.has("pyproject.toml") || directNames.has("requirements.txt") || directNames.has("Pipfile")
      ? new Set(["uv.lock", "poetry.lock", "Pipfile.lock"])
      : directNames.has("Cargo.toml")
        ? new Set(["Cargo.lock"])
        : directNames.has("go.mod")
          ? new Set(["go.sum"])
          : new Set<string>();
  const repositoryLevel = files.filter(
    (file) => file.root === "." && inheritable.has(file.name),
  );
  return [...direct, ...repositoryLevel.filter(
    (file) => !direct.some((candidate) => candidate.name === file.name),
  )];
}

export async function detectGithubRepositoryProfiles(
  input: {
    installationId: string;
    repository: string;
    defaultBranch: string;
  },
  dependencies: RepositoryProfileDetectionDependencies = {},
): Promise<GithubRepositoryProfileDetection> {
  const repository = repositoryCoordinates(input.repository);
  const limits = safeLimits(dependencies.limits);
  const github = dependencies.github ?? await createGithubInstallationClient(input.installationId) as unknown as RepositoryMetadataGithubClient;
  const ref = await github.rest.git.getRef({
    ...repository,
    ref: `heads/${input.defaultBranch}`,
  });
  const sourceSha = validSha(ref.data.object.sha);
  const commit = await github.rest.git.getCommit({
    ...repository,
    commit_sha: sourceSha,
  });
  const rootTreeSha = validSha(commit.data.tree.sha);
  const tree = await inspectManifestTree(github, repository, rootTreeSha, limits);
  const read = await readManifests(github, repository, tree.manifests, limits);
  const runnerWorkflow = read.files.find((file) => file.path === TENKI_RUNNER_WORKFLOW_PATH);
  const runnerWorkflowSha256 = runnerWorkflow
    ? createHash("sha256").update(runnerWorkflow.content, "utf8").digest("hex")
    : null;
  const runnerProbeWorkflow = read.files.find(
    (file) => file.path === TENKI_RUNNER_PROBE_WORKFLOW_PATH,
  );
  const runnerProbeWorkflowSha256 = runnerProbeWorkflow
    ? createHash("sha256").update(runnerProbeWorkflow.content, "utf8").digest("hex")
    : null;
  const roots = [...new Set(
    read.files.filter((file) => PRIMARY_MANIFESTS.has(file.name)).map((file) => file.root),
  )].sort((left, right) => left === "." ? -1 : right === "." ? 1 : left.localeCompare(right));
  const detectedRoots = roots.length ? roots : ["."];
  const profiles = detectedRoots.map((root) => suggestion({
    repository: input.repository,
    root,
    defaultBranch: input.defaultBranch,
    sourceSha,
    files: filesForRoot(read.files, root),
    runnerWorkflowSha256,
    runnerProbeWorkflowSha256,
  }));
  return {
    repository: input.repository,
    defaultBranch: input.defaultBranch,
    sourceSha,
    profiles,
    evidence: {
      treeEntriesInspected: tree.treeEntriesInspected,
      treeRequests: tree.treeRequests,
      manifestFilesRead: read.files.length,
      manifestBytesRead: read.bytesRead,
      limitsReached: tree.limitsReached || read.limitsReached,
    },
  };
}

export async function detectAndPersistGithubRepositoryProfiles(
  input: {
    orgId: string;
    installationId: string;
    repository: string;
    defaultBranch: string;
  },
  store: RepositoryProfileSuggestionStore,
  dependencies: RepositoryProfileDetectionDependencies = {},
): Promise<GithubRepositoryProfileDetection> {
  const detection = await detectGithubRepositoryProfiles(input, dependencies);
  for (const profile of detection.profiles) {
    await store.saveDetectedSuggestion({
      orgId: input.orgId,
      suggestion: profile,
      evidence: detection.evidence,
    });
  }
  return detection;
}

function optionalCommand(command: string | null): string[] {
  return command ? [command] : [];
}

function detectedInstallCommands(
  detected: DetectedRepositoryProfileSuggestion,
  managedEnvironment: ManagedTenkiEnvironmentArtifact | null,
): string[] {
  const commands = managedEnvironment?.scopeType === "repository_private"
    && managedEnvironment.capabilities.includes("dependency-cache")
    ? [
        `/opt/closespan/restore-cache.sh /home/tenki/repo/${detected.root === "." ? "" : detected.root}`
          .replace(/\/$/, ""),
      ]
    : optionalCommand(detected.commands.install);
  if (!detected.application?.browserDependencyDetected) return commands;
  if (managedEnvironment?.capabilities.includes("browser")) {
    return [...commands, TENKI_BROWSER_PREFLIGHT_COMMAND];
  }
  const installBrowser = playwrightChromiumInstallCommand(
    detected.packageManager ?? "unknown",
  );
  if (!installBrowser) return commands;
  return [...commands, installBrowser, TENKI_BROWSER_PREFLIGHT_COMMAND];
}

export function executionProfileSuggestionStore(
  actor: ExecutionProfileActor = { actorId: "system:repository-detector" },
  dependencies: Pick<RepositoryProfileDetectionDependencies, "managedEnvironmentResolver"> = {},
): RepositoryProfileSuggestionStore {
  return {
    async saveDetectedSuggestion({ orgId, suggestion: detected, evidence }) {
      const runnerExecution = detected.platform === "ios" || detected.platform === "android";
      const workload = assessTenkiRunnerWorkload(detected);
      const configuredRunnerLabel = detected.platform === "ios"
        ? process.env.TENKI_MACOS_RUNNER_LABEL?.trim()
        : detected.platform === "android"
          ? process.env.TENKI_ANDROID_RUNNER_LABEL?.trim()
          : undefined;
      const runnerLabel = configuredRunnerLabel || workload.baselineRunnerLabel;
      if (runnerExecution) assertTenkiRunnerLabel(runnerLabel, workload.platform);
      const runnerSize = runnerExecution ? tenkiRunnerSize(runnerLabel) : null;
      const managedEnvironment = runnerExecution ? null : await (
        dependencies.managedEnvironmentResolver?.resolve({
          orgId,
          repository: detected.repository,
          workspaceRoot: detected.root,
          runtimeFamily: detected.environment.runtimeFamily,
          runtimeVersion: detected.runtime,
          packageManager: detected.packageManager,
          requiredCapabilities: detected.application?.browserDependencyDetected
            ? ["browser"]
            : [],
          dependencyFingerprint: detected.dependencyFingerprint,
        })
        ?? resolveManagedTenkiEnvironment({
          orgId,
          repository: detected.repository,
          workspaceRoot: detected.root,
          runtimeFamily: detected.environment.runtimeFamily,
          runtimeVersion: detected.runtime,
          packageManager: detected.packageManager,
          requiredCapabilities: detected.application?.browserDependencyDetected
            ? ["browser"]
            : [],
          dependencyFingerprint: detected.dependencyFingerprint,
        })
      );
      const installCommands = detectedInstallCommands(
        detected,
        managedEnvironment,
      );
      const browserProvisioned = Boolean(
        detected.application?.browserDependencyDetected
        && (
          managedEnvironment?.capabilities.includes("browser")
          || playwrightChromiumInstallCommand(detected.packageManager ?? "unknown")
        ),
      );
      const commonConfig = {
        language: detected.language,
        framework: detected.framework,
        packageManager: detected.packageManager ?? "unknown",
        runtimeVersion: detected.runtime,
        workingDirectory: detected.root,
        installCommands,
        buildCommands: optionalCommand(detected.commands.build),
        testCommands: optionalCommand(detected.commands.test),
        typecheckCommands: optionalCommand(detected.commands.typecheck),
        automaticInstall: installCommands.length > 0,
        automaticBuild: Boolean(detected.commands.build),
        publicEnvironment: [],
        secretBindings: [],
        startCommand: detected.application?.startCommand ?? null,
        applicationPort: detected.application?.port ?? null,
        healthCheckPath: detected.application?.healthPath ?? null,
        healthCheckTimeoutMs: 90_000,
        previewEnabled: false,
        previewTtlMs: 600_000,
        runtimeTools: {
          http: Boolean(detected.application),
          browser: browserProvisioned,
          logs: Boolean(detected.application),
        },
        permittedPaths: detected.root === "." ? ["**/*"] : [`${detected.root}/**`],
        tenkiImage: managedEnvironment?.registryDigestRef ?? null,
        tenkiSnapshotId: null,
        cpuCores: runnerSize?.cpuCores ?? 2,
        memoryMb: runnerSize?.memoryMb ?? 4_096,
        allowInbound: false,
        allowOutbound: managedEnvironment?.scopeType === "repository_private"
          ? false
          : installCommands.length > 0,
        maxDurationMs: runnerExecution ? 3_600_000 : 1_800_000,
        idleTimeoutMinutes: 2,
      };
      const config = runnerExecution ? {
        schemaVersion: 3 as const,
        ...commonConfig,
        executor: detected.platform === "ios"
          ? {
              kind: "tenki_github_actions" as const,
              platform: "macos" as const,
              architecture: "arm64" as const,
              runnerLabel,
              workflowPath: TENKI_RUNNER_WORKFLOW_PATH,
              workflowSha256: detected.runnerWorkflowSha256,
              xcode: detected.xcode ? {
                ...detected.xcode,
                version: process.env.TENKI_XCODE_VERSION?.trim() || detected.xcode.version,
                sdk: "iphonesimulator" as const,
                signingPolicy: "simulator_only" as const,
              } : null,
              androidEmulator: null,
            }
          : {
              kind: "tenki_github_actions" as const,
              platform: "linux" as const,
              architecture: "x64" as const,
              runnerLabel,
              workflowPath: TENKI_RUNNER_WORKFLOW_PATH,
              workflowSha256: detected.runnerWorkflowSha256,
              xcode: null,
              androidEmulator: detected.androidEmulator,
            },
      } : {
        schemaVersion: 2 as const,
        ...commonConfig,
      };
      return saveDetectedExecutionProfileSuggestion({
        orgId,
        repository: detected.repository,
        workspaceRoot: detected.root,
        config,
        detectionEvidence: {
          defaultBranch: detected.defaultBranch,
          sourceSha: detected.sourceSha,
          runtimeFamily: detected.environment.runtimeFamily,
          manifestPaths: detected.manifestPaths,
          confidence: detected.confidence,
          detectorVersion: detected.detectorVersion,
          detectionHash: detected.detectionHash,
          dependencyFingerprint: detected.dependencyFingerprint,
          platform: detected.platform,
          runnerWorkflowSha256: detected.runnerWorkflowSha256,
          runnerProbeWorkflowSha256: detected.runnerProbeWorkflowSha256,
          runnerSizing: runnerExecution ? {
            workloadClass: workload.workloadClass,
            baselineRunnerLabel: workload.baselineRunnerLabel,
            selectedRunnerLabel: runnerLabel,
            selectionSource: configuredRunnerLabel ? "deployment_override" : "detected_workload",
            reasons: workload.reasons,
          } : null,
          managedEnvironment: managedEnvironment ? {
            artifactId: managedEnvironment.id,
            catalogKey: managedEnvironment.catalogKey,
            version: managedEnvironment.version,
            snapshotId: managedEnvironment.snapshotId,
            registryDigestRef: managedEnvironment.registryDigestRef,
          } : null,
          scan: evidence,
        },
        actor,
      });
    },
  };
}

export async function detectAndSaveGithubRepositoryProfiles(
  input: {
    orgId: string;
    installationId: string;
    repository: string;
    defaultBranch: string;
    actor?: ExecutionProfileActor;
  },
  dependencies: RepositoryProfileDetectionDependencies = {},
): Promise<GithubRepositoryProfileDetection> {
  return detectAndPersistGithubRepositoryProfiles(
    input,
    executionProfileSuggestionStore(input.actor, dependencies),
    dependencies,
  );
}
