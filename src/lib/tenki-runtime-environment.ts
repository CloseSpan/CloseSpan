import { Buffer } from "node:buffer";
import type {
  ExposedPort,
  ProcessRunHandle,
  ProcessRunResult,
  Session,
} from "@tenkicloud/sandbox";
import { TENKI_BROWSER_PREFLIGHT_COMMAND } from "./execution-profile";

const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 2 * 60_000;
const DEFAULT_HEALTH_POLL_INTERVAL_MS = 1_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_TERMINATION_GRACE_MS = 5_000;
const DEFAULT_LOG_LIMIT_BYTES = 128_000;
const DEFAULT_RESPONSE_LIMIT_BYTES = 128_000;
const MAX_PREVIEW_TTL_MS = 15 * 60_000;
const MAX_REQUEST_BODY_BYTES = 64_000;

const RUNTIME_SUPERVISOR_SOURCE = String.raw`
set -u
setsid bash -c "$1" &
child_pid=$!
shutdown_runtime() {
  trap - TERM INT
  kill -TERM -- "-$child_pid" 2>/dev/null || true
  attempt=0
  while kill -0 "$child_pid" 2>/dev/null && [ "$attempt" -lt 30 ]; do
    sleep 0.1
    attempt=$((attempt + 1))
  done
  if kill -0 "$child_pid" 2>/dev/null; then
    kill -KILL -- "-$child_pid" 2>/dev/null || true
  fi
  wait "$child_pid" 2>/dev/null || true
  exit 143
}
trap shutdown_runtime TERM INT
set +e
wait "$child_pid"
status=$?
set -e
exit "$status"
`;

const LOCAL_HTTP_CLIENT_SOURCE = String.raw`
const http = require("node:http");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  if (Buffer.byteLength(input) > 100000) {
    process.stderr.write("request specification is too large");
    process.exit(2);
  }
});
process.stdin.on("end", () => {
  let spec;
  try {
    spec = JSON.parse(input);
  } catch {
    process.stderr.write("invalid request specification");
    process.exit(2);
    return;
  }
  let settled = false;
  const finish = (payload, exitCode) => {
    if (settled) return;
    settled = true;
    process.stdout.write(JSON.stringify(payload));
    process.exitCode = exitCode;
  };
  const request = http.request({
    hostname: "127.0.0.1",
    port: spec.port,
    path: spec.path,
    method: spec.method,
    headers: spec.headers,
  }, (response) => {
    const chunks = [];
    let bytes = 0;
    response.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > spec.maxBytes) {
        response.destroy(new Error("response exceeds configured limit"));
        return;
      }
      chunks.push(chunk);
    });
    response.on("end", () => finish({
      ok: true,
      statusCode: response.statusCode || 0,
      bodyBase64: Buffer.concat(chunks).toString("base64"),
    }, 0));
    response.on("error", (error) => finish({ ok: false, error: error.message }, 2));
  });
  request.setTimeout(spec.timeoutMs, () => request.destroy(new Error("request timed out")));
  request.on("error", (error) => finish({ ok: false, error: error.message }, 2));
  if (spec.bodyBase64) request.write(Buffer.from(spec.bodyBase64, "base64"));
  request.end();
});
`;

const LOCAL_BROWSER_CLIENT_SOURCE = String.raw`
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  if (Buffer.byteLength(input) > 100000) {
    process.stderr.write("browser specification is too large");
    process.exit(2);
  }
});
process.stdin.on("end", async () => {
  let browser;
  try {
    const spec = JSON.parse(input);
    let chromium;
    try {
      chromium = require("playwright").chromium;
    } catch {
      chromium = require("@playwright/test").chromium;
    }
    const origin = "http://127.0.0.1:" + spec.port;
    const websocketOrigin = "ws://127.0.0.1:" + spec.port;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: "block" });
    if (typeof context.routeWebSocket !== "function") {
      throw new Error("Playwright WebSocket routing is unavailable");
    }
    await context.routeWebSocket("**/*", async (websocket) => {
      let target;
      try {
        target = new URL(websocket.url());
      } catch {
        await websocket.close({ code: 1008, reason: "blocked by CloseSpan" });
        return;
      }
      if (target.origin !== websocketOrigin) {
        await websocket.close({ code: 1008, reason: "blocked by CloseSpan" });
        return;
      }
      const server = websocket.connectToServer();
      websocket.onMessage((message) => server.send(message));
      server.onMessage((message) => websocket.send(message));
      websocket.onClose(() => server.close());
      server.onClose(() => websocket.close());
    });
    const page = await context.newPage();
    await page.route("**/*", async (route) => {
      try {
        const target = new URL(route.request().url());
        if (target.origin === origin) await route.continue();
        else await route.abort("blockedbyclient");
      } catch {
        await route.abort("blockedbyclient");
      }
    });
    await page.goto(origin + spec.path, {
      waitUntil: "domcontentloaded",
      timeout: spec.timeoutMs,
    });
    for (const action of spec.actions) {
      if (action.type === "click") {
        await page.locator(action.selector).click({ timeout: spec.timeoutMs });
      } else if (action.type === "fill") {
        await page.locator(action.selector).fill(action.value, { timeout: spec.timeoutMs });
      } else if (action.type === "press") {
        await page.locator(action.selector).press(action.key, { timeout: spec.timeoutMs });
      }
    }
    const finalUrl = new URL(page.url());
    if (finalUrl.origin !== origin) throw new Error("browser navigation left the configured application");
    const result = {
      ok: true,
      url: page.url(),
      title: (await page.title()).slice(0, 1000),
      text: ((await page.locator("body").innerText()).slice(0, spec.maxBytes)),
      html: ((await page.content()).slice(0, spec.maxBytes)),
    };
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.stderr.write(error && error.message ? error.message : "browser interaction failed");
    process.exitCode = 2;
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
});
`;

type RuntimeSession = Pick<
  Session,
  "inboundEnabled" | "run" | "exposePort" | "unexposePort"
>;

export type TenkiRuntimeState =
  | "idle"
  | "preparing"
  | "starting"
  | "healthy"
  | "stopped"
  | "failed"
  | "disposed";

export interface TenkiRuntimeCommandGroup {
  enabled: boolean;
  commands: readonly string[];
}

export interface TenkiRuntimePreviewConfig {
  allowed: boolean;
  ttlMs: number;
  slug?: string;
}

export interface TenkiRuntimeEnvironmentConfig {
  workingDirectory: string;
  install: TenkiRuntimeCommandGroup;
  build: TenkiRuntimeCommandGroup;
  startCommand: string | null;
  port: number | null;
  healthPath: string | null;
  preview: TenkiRuntimePreviewConfig;
  commandTimeoutMs?: number;
  startupTimeoutMs?: number;
  healthPollIntervalMs?: number;
  requestTimeoutMs?: number;
  terminationGraceMs?: number;
  maxLogBytes?: number;
  maxResponseBytes?: number;
  healthSuccessStatusCodes?: readonly number[];
}

export interface TenkiRuntimeEnvironmentDependencies {
  /** Resolved immediately before dispatch and used only by the first trusted bootstrap attempt. */
  setupEnv: Readonly<Record<string, string>>;
  /** Public-only environment used after the repository may contain agent changes. */
  rerunEnv?: Readonly<Record<string, string>>;
  /** Only values required by the long-lived application process. */
  runtimeEnv: Readonly<Record<string, string>>;
  /** Additional values that must be removed from logs and HTTP response bodies. */
  redactionValues: readonly string[];
  sleep?: (milliseconds: number) => Promise<void>;
  scheduleTimeout?: (callback: () => void, milliseconds: number) => () => void;
}

export interface TenkiRuntimeHttpRequest {
  method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
  path: string;
  body?: string;
  contentType?: "application/json" | "text/plain" | "application/x-www-form-urlencoded";
}

export interface TenkiRuntimeHttpResponse {
  statusCode: number;
  body: string;
}

export type TenkiRuntimeBrowserAction =
  | { type: "click"; selector: string }
  | { type: "fill"; selector: string; value: string }
  | { type: "press"; selector: string; key: string };

export interface TenkiRuntimeBrowserRequest {
  path: string;
  actions?: readonly TenkiRuntimeBrowserAction[];
}

export interface TenkiRuntimeBrowserResponse {
  url: string;
  title: string;
  text: string;
  html: string;
}

export interface TenkiRuntimeStatus {
  state: TenkiRuntimeState;
  pid?: number;
  healthy: boolean;
  previewUrl?: string;
  lastExit?: {
    exitCode: number;
    signal?: string;
    reason?: string;
  };
}

export interface TenkiRuntimeRestartOptions {
  runInstall?: boolean;
  runBuild?: boolean;
}

export interface TenkiRuntimePrepareOptions {
  runInstall?: boolean;
  runBuild?: boolean;
}

interface LocalHttpWireResponse {
  ok: boolean;
  statusCode?: number;
  bodyBase64?: string;
  error?: string;
}

interface RunningProcess {
  handle: ProcessRunHandle;
  completion: Promise<ProcessRunResult>;
  drains: Promise<void>[];
  pid?: number;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function defaultScheduleTimeout(callback: () => void, milliseconds: number): () => void {
  const timeout = setTimeout(callback, milliseconds);
  return () => clearTimeout(timeout);
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return resolved;
}

function validateGuestDirectory(value: string): string {
  const directory = value.trim();
  if (!directory.startsWith("/") || directory.includes("\0") || directory.split("/").includes("..")) {
    throw new Error("Tenki runtime workingDirectory must be an absolute guest path without traversal");
  }
  return directory.replace(/\/$/, "") || "/";
}

function validateCommand(value: string, field: string): string {
  const command = value.trim();
  if (!command || command.length > 2_000 || command.includes("\0")) {
    throw new Error(`${field} must be a non-empty command no longer than 2,000 characters`);
  }
  return command;
}

function validateLocalPath(value: string): string {
  if (
    !value.startsWith("/")
    || value.startsWith("//")
    || value.includes("\\")
    || /[\r\n\0]/.test(value)
    || value.length > 2_000
  ) {
    throw new Error("Runtime HTTP paths must be local absolute paths");
  }
  const base = "http://127.0.0.1";
  const parsed = new URL(value, base);
  if (parsed.origin !== base || parsed.hash) {
    throw new Error("Runtime HTTP paths must stay on the configured localhost application");
  }
  return `${parsed.pathname}${parsed.search}`;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

class SecretRedactor {
  private readonly values: string[];
  readonly carryLength: number;

  constructor(values: readonly string[]) {
    const expanded = new Set<string>();
    for (const value of values) {
      if (!value) continue;
      expanded.add(value);
      expanded.add(Buffer.from(value, "utf8").toString("base64"));
      expanded.add(Buffer.from(value, "utf8").toString("base64url"));
      expanded.add(encodeURIComponent(value));
      expanded.add(JSON.stringify(value).slice(1, -1));
    }
    this.values = [...expanded].filter(Boolean).sort((left, right) => right.length - left.length);
    this.carryLength = Math.max(0, ...this.values.map((value) => value.length - 1));
  }

  redact(value: string): string {
    let redacted = value;
    for (const secret of this.values) redacted = redacted.split(secret).join("[REDACTED]");
    return redacted;
  }

  safeBoundary(value: string, requestedBoundary: number): number {
    let boundary = requestedBoundary;
    for (const secret of this.values) {
      const searchStart = Math.max(0, boundary - secret.length + 1);
      const occurrence = value.indexOf(secret, searchStart);
      if (occurrence >= 0 && occurrence < boundary && occurrence + secret.length > boundary) {
        boundary = occurrence;
      }
    }
    return boundary;
  }
}

class BoundedLogBuffer {
  private value = "";

  constructor(
    private readonly maxBytes: number,
    private readonly redactor: SecretRedactor,
  ) {}

  appendRedacted(value: string): void {
    this.value += this.redactor.redact(value);
    while (byteLength(this.value) > this.maxBytes) {
      this.value = this.value.slice(Math.max(1, Math.floor(this.value.length / 8)));
    }
  }

  read(maxBytes = this.maxBytes): string {
    const limit = Math.min(positiveInteger(maxBytes, this.maxBytes, "maxBytes"), this.maxBytes);
    if (byteLength(this.value) <= limit) return this.value;
    let start = Math.max(0, this.value.length - limit);
    while (byteLength(this.value.slice(start)) > limit) start += 1;
    return this.value.slice(start);
  }
}

class RedactingStreamWriter {
  private pending = "";

  constructor(
    private readonly destination: BoundedLogBuffer,
    private readonly redactor: SecretRedactor,
  ) {}

  write(value: string): void {
    const combined = this.pending + value;
    const keep = Math.min(this.redactor.carryLength, combined.length);
    const boundary = this.redactor.safeBoundary(combined, combined.length - keep);
    this.destination.appendRedacted(combined.slice(0, boundary));
    this.pending = combined.slice(boundary);
  }

  flush(): void {
    this.destination.appendRedacted(this.pending);
    this.pending = "";
  }
}

async function drainStream(
  stream: ReadableStream<Uint8Array>,
  writer: RedactingStreamWriter,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(decoder.decode(value, { stream: true }));
    }
    writer.write(decoder.decode());
  } finally {
    reader.releaseLock();
    writer.flush();
  }
}

export class TenkiRuntimeEnvironment {
  private readonly workingDirectory: string;
  private readonly commandTimeoutMs: number;
  private readonly startupTimeoutMs: number;
  private readonly healthPollIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly terminationGraceMs: number;
  private readonly maxResponseBytes: number;
  private readonly healthSuccessStatusCodes: Set<number>;
  private readonly setupEnv: Record<string, string>;
  private readonly rerunEnv: Record<string, string>;
  private readonly runtimeEnv: Record<string, string>;
  private readonly redactor: SecretRedactor;
  private readonly logBuffer: BoundedLogBuffer;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly scheduleTimeout: (callback: () => void, milliseconds: number) => () => void;
  private readonly installCommands: string[];
  private readonly buildCommands: string[];
  private readonly startCommand: string | null;
  private readonly port: number | null;
  private readonly healthPath: string | null;
  private state: TenkiRuntimeState = "idle";
  private setupComplete = false;
  private bootstrapAttempted = false;
  private browserPreflightComplete = false;
  private runtime?: RunningProcess;
  private exposedPort?: ExposedPort;
  private lastExit?: TenkiRuntimeStatus["lastExit"];

  constructor(
    private readonly session: RuntimeSession,
    private readonly config: TenkiRuntimeEnvironmentConfig,
    dependencies: TenkiRuntimeEnvironmentDependencies,
  ) {
    this.workingDirectory = validateGuestDirectory(config.workingDirectory);
    this.installCommands = config.install.enabled
      ? config.install.commands.map((command) => validateCommand(command, "install command"))
      : [];
    this.buildCommands = config.build.enabled
      ? config.build.commands.map((command) => validateCommand(command, "build command"))
      : [];
    const runtimeValues = [config.startCommand, config.port, config.healthPath];
    const runtimeConfigured = runtimeValues.every((value) => value !== null);
    if (!runtimeConfigured && runtimeValues.some((value) => value !== null)) {
      throw new Error("Tenki runtime requires a start command, port, and health path together");
    }
    this.startCommand = config.startCommand === null
      ? null
      : validateCommand(config.startCommand, "startCommand");
    if (config.port !== null && (!Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65_535)) {
      throw new Error("Tenki runtime port must be between 1 and 65535");
    }
    this.port = config.port;
    this.healthPath = config.healthPath === null ? null : validateLocalPath(config.healthPath);
    this.commandTimeoutMs = positiveInteger(config.commandTimeoutMs, DEFAULT_COMMAND_TIMEOUT_MS, "commandTimeoutMs");
    this.startupTimeoutMs = positiveInteger(config.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS, "startupTimeoutMs");
    this.healthPollIntervalMs = positiveInteger(config.healthPollIntervalMs, DEFAULT_HEALTH_POLL_INTERVAL_MS, "healthPollIntervalMs");
    this.requestTimeoutMs = positiveInteger(config.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, "requestTimeoutMs");
    this.terminationGraceMs = positiveInteger(config.terminationGraceMs, DEFAULT_TERMINATION_GRACE_MS, "terminationGraceMs");
    const maxLogBytes = positiveInteger(config.maxLogBytes, DEFAULT_LOG_LIMIT_BYTES, "maxLogBytes");
    this.maxResponseBytes = positiveInteger(config.maxResponseBytes, DEFAULT_RESPONSE_LIMIT_BYTES, "maxResponseBytes");
    if (config.preview.allowed) {
      if (!runtimeConfigured) throw new Error("Preview exposure requires a configured runtime");
      if (!session.inboundEnabled) throw new Error("Preview exposure requires an inbound-enabled Tenki session");
      if (!Number.isSafeInteger(config.preview.ttlMs) || config.preview.ttlMs < 1_000 || config.preview.ttlMs > MAX_PREVIEW_TTL_MS) {
        throw new Error("Preview TTL must be between 1 second and 15 minutes");
      }
      if (config.preview.slug && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(config.preview.slug)) {
        throw new Error("Preview slug is invalid");
      }
    }
    this.healthSuccessStatusCodes = new Set(
      config.healthSuccessStatusCodes
        ?? Array.from({ length: 200 }, (_, index) => 200 + index),
    );
    if (!this.healthSuccessStatusCodes.size || [...this.healthSuccessStatusCodes].some((status) => !Number.isSafeInteger(status) || status < 100 || status > 599)) {
      throw new Error("healthSuccessStatusCodes must contain valid HTTP status codes");
    }
    this.setupEnv = this.validateEnvironment(dependencies.setupEnv);
    this.rerunEnv = this.validateEnvironment(dependencies.rerunEnv ?? {});
    this.runtimeEnv = this.validateEnvironment(dependencies.runtimeEnv);
    this.redactor = new SecretRedactor([
      ...Object.values(this.setupEnv),
      ...Object.values(this.runtimeEnv),
      ...dependencies.redactionValues,
    ]);
    this.logBuffer = new BoundedLogBuffer(maxLogBytes, this.redactor);
    this.sleep = dependencies.sleep ?? defaultSleep;
    this.scheduleTimeout = dependencies.scheduleTimeout ?? defaultScheduleTimeout;
  }

  async start(): Promise<TenkiRuntimeStatus> {
    this.assertUsable();
    this.assertRuntimeConfigured();
    if (this.state === "healthy") return this.status();
    if (this.state === "preparing" || this.state === "starting") {
      throw new Error("Tenki runtime start is already in progress");
    }
    if (this.runtime || this.exposedPort) await this.cleanupRuntimeResources();
    try {
      await this.prepare();
      this.assertBrowserPreflightIfConfigured();
      await this.launchAndWaitForHealth();
      await this.exposePreviewIfAllowed();
      this.state = "healthy";
      return this.statusSnapshot(true);
    } catch (error) {
      this.state = "failed";
      await this.cleanupRuntimeResources().catch(() => undefined);
      throw new Error(`Tenki runtime failed to start: ${this.safeError(error)}`);
    }
  }

  async prepare(options: TenkiRuntimePrepareOptions = {}): Promise<void> {
    this.assertUsable();
    const runInstall = options.runInstall
      ?? (!this.setupComplete && this.config.install.enabled);
    const runBuild = options.runBuild
      ?? (!this.setupComplete && this.config.build.enabled);
    if (this.setupComplete && !runInstall && !runBuild) return;
    if (this.state === "preparing" || this.state === "starting") {
      throw new Error("Tenki runtime preparation is already in progress");
    }
    this.state = "preparing";
    const commandEnvironment = this.bootstrapAttempted
      ? this.rerunEnv
      : this.setupEnv;
    this.bootstrapAttempted = true;
    try {
      if (runInstall) await this.runCommandGroup("install", this.installCommands, commandEnvironment);
      if (runBuild) await this.runCommandGroup("build", this.buildCommands, commandEnvironment);
      this.setupComplete = true;
      this.state = "stopped";
    } catch (error) {
      this.state = "failed";
      throw new Error(`Tenki runtime preparation failed: ${this.safeError(error)}`);
    }
  }

  async restart(options: TenkiRuntimeRestartOptions = {}): Promise<TenkiRuntimeStatus> {
    this.assertUsable();
    this.assertRuntimeConfigured();
    if (this.state === "preparing" || this.state === "starting") {
      throw new Error("Tenki runtime start is already in progress");
    }
    await this.cleanupRuntimeResources();
    this.state = "preparing";
    try {
      if (options.runInstall && this.config.install.enabled) {
        await this.runCommandGroup("install", this.installCommands, this.rerunEnv);
      }
      if (options.runBuild && this.config.build.enabled) {
        await this.runCommandGroup("build", this.buildCommands, this.rerunEnv);
      }
      this.assertBrowserPreflightIfConfigured();
      await this.launchAndWaitForHealth();
      await this.exposePreviewIfAllowed();
      this.state = "healthy";
      return this.statusSnapshot(true);
    } catch (error) {
      this.state = "failed";
      await this.cleanupRuntimeResources().catch(() => undefined);
      throw new Error(`Tenki runtime failed to restart: ${this.safeError(error)}`);
    }
  }

  async request(request: TenkiRuntimeHttpRequest): Promise<TenkiRuntimeHttpResponse> {
    this.assertUsable();
    if (this.state !== "healthy" || !this.runtime) throw new Error("Tenki runtime is not healthy");
    const path = validateLocalPath(request.path);
    const body = request.body ?? "";
    if (byteLength(body) > MAX_REQUEST_BODY_BYTES) throw new Error("Runtime HTTP request body exceeds 64 KB");
    const headers: Record<string, string> = {};
    if (body) headers["content-type"] = request.contentType ?? "application/json";
    return this.localHttpRequest(request.method, path, body, headers);
  }

  async browser(request: TenkiRuntimeBrowserRequest): Promise<TenkiRuntimeBrowserResponse> {
    this.assertUsable();
    this.assertRuntimeConfigured();
    if (this.state !== "healthy" || !this.runtime) {
      throw new Error("Tenki runtime is not healthy");
    }
    if (!this.browserPreflightComplete) {
      throw new Error(
        "Runtime browser is unavailable because the exact Chromium launch preflight did not complete",
      );
    }
    const path = validateLocalPath(request.path);
    const actions = [...(request.actions ?? [])];
    if (actions.length > 20) throw new Error("Runtime browser interactions are limited to 20 actions");
    for (const action of actions) {
      if (!action.selector.trim() || action.selector.length > 1_000 || /[\r\n\0]/.test(action.selector)) {
        throw new Error("Runtime browser selectors must be non-empty and no longer than 1,000 characters");
      }
      if (action.type === "fill" && (action.value.length > 4_000 || action.value.includes("\0"))) {
        throw new Error("Runtime browser fill values may not exceed 4,000 characters");
      }
      if (action.type === "press" && (!action.key.trim() || action.key.length > 100 || /[\r\n\0]/.test(action.key))) {
        throw new Error("Runtime browser keys must be non-empty and no longer than 100 characters");
      }
    }
    const spec = JSON.stringify({
      port: this.port,
      path,
      actions,
      timeoutMs: this.requestTimeoutMs,
      maxBytes: this.maxResponseBytes,
    });
    const stdin = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(spec));
        controller.close();
      },
    });
    const handle = this.session.run(["node", "-e", LOCAL_BROWSER_CLIENT_SOURCE], {
      cwd: this.workingDirectory,
      stdin,
    });
    const result = await this.observeCapturedProcess(
      handle,
      this.requestTimeoutMs + this.terminationGraceMs,
      "localhost browser interaction",
    );
    if (result.exitCode !== 0 || result.signal) {
      const failure = this.redactor.redact(
        new TextDecoder().decode(result.stderr).slice(-5_000)
          || "Playwright is unavailable or the browser interaction failed",
      );
      throw new Error(`Runtime browser failed: ${failure}`);
    }
    let response: { ok?: boolean; url?: string; title?: string; text?: string; html?: string };
    try {
      response = JSON.parse(new TextDecoder().decode(result.stdout)) as typeof response;
    } catch {
      throw new Error("Runtime browser returned an invalid response");
    }
    if (!response.ok || !response.url) throw new Error("Runtime browser did not return a page snapshot");
    return {
      url: response.url,
      title: this.redactor.redact(response.title ?? ""),
      text: this.redactor.redact(response.text ?? ""),
      html: this.redactor.redact(response.html ?? ""),
    };
  }

  async status(): Promise<TenkiRuntimeStatus> {
    this.assertUsable();
    if (!this.runtime || (this.state !== "healthy" && this.state !== "starting")) {
      return this.statusSnapshot(false);
    }
    const healthy = await this.healthProbe();
    if (!healthy && this.state === "healthy") this.state = "failed";
    return this.statusSnapshot(healthy);
  }

  logs(maxBytes?: number): string {
    return this.logBuffer.read(maxBytes);
  }

  async stop(): Promise<void> {
    if (this.state === "disposed") return;
    await this.cleanupRuntimeResources();
    this.state = "stopped";
  }

  async close(): Promise<void> {
    if (this.state === "disposed") return;
    let cleanupError: unknown;
    try {
      await this.cleanupRuntimeResources();
    } catch (error) {
      cleanupError = error;
    } finally {
      this.state = "disposed";
    }
    if (cleanupError) throw new Error(`Tenki runtime cleanup failed: ${this.safeError(cleanupError)}`);
  }

  private async runCommandGroup(
    stage: "install" | "build",
    commands: readonly string[],
    environment: Readonly<Record<string, string>>,
  ): Promise<void> {
    for (let index = 0; index < commands.length; index += 1) {
      this.logBuffer.appendRedacted(`[${stage}] command ${index + 1} started\n`);
      const handle = this.session.run(["bash", "-c", commands[index]], {
        cwd: this.workingDirectory,
        env: environment,
      });
      const result = await this.observeLoggedProcess(handle, this.commandTimeoutMs, `${stage} command ${index + 1}`);
      if (result.exitCode !== 0 || result.signal) {
        throw new Error(`${stage} command ${index + 1} failed with exit code ${result.exitCode}`);
      }
      if (stage === "install" && commands[index] === TENKI_BROWSER_PREFLIGHT_COMMAND) {
        this.browserPreflightComplete = true;
      }
      this.logBuffer.appendRedacted(`[${stage}] command ${index + 1} completed\n`);
    }
  }

  private assertBrowserPreflightIfConfigured(): void {
    if (
      this.installCommands.includes(TENKI_BROWSER_PREFLIGHT_COMMAND)
      && !this.browserPreflightComplete
    ) {
      throw new Error("configured Chromium launch preflight did not complete");
    }
  }

  private async launchAndWaitForHealth(): Promise<void> {
    this.assertRuntimeConfigured();
    this.state = "starting";
    this.lastExit = undefined;
    const handle = this.session.run([
      "bash",
      "-c",
      RUNTIME_SUPERVISOR_SOURCE,
      "--",
      this.startCommand!,
    ], {
      cwd: this.workingDirectory,
      env: this.runtimeEnv,
    });
    const stdoutWriter = new RedactingStreamWriter(this.logBuffer, this.redactor);
    const stderrWriter = new RedactingStreamWriter(this.logBuffer, this.redactor);
    const drains = [
      drainStream(handle.stdout, stdoutWriter),
      drainStream(handle.stderr, stderrWriter),
    ];
    const completion = Promise.resolve(handle);
    const running: RunningProcess = { handle, completion, drains };
    this.runtime = running;
    void completion.then((result) => {
      this.lastExit = { exitCode: result.exitCode, signal: result.signal, reason: result.reason };
      if (this.runtime === running && (this.state === "starting" || this.state === "healthy")) {
        this.state = result.exitCode === 0 && !result.signal ? "stopped" : "failed";
      }
    }).catch((error: unknown) => {
      this.logBuffer.appendRedacted(`[runtime] process observation failed: ${this.safeError(error)}\n`);
      if (this.runtime === running) this.state = "failed";
    });
    running.pid = await this.promiseWithTimeout(handle.pid, this.requestTimeoutMs, "runtime process did not report a PID");

    const maximumAttempts = Math.max(1, Math.ceil(this.startupTimeoutMs / this.healthPollIntervalMs));
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      if (this.runtime !== running || this.lastExit !== undefined) {
        throw new Error("runtime process exited before becoming healthy");
      }
      if (await this.healthProbe()) return;
      if (attempt + 1 < maximumAttempts) await this.sleep(this.healthPollIntervalMs);
    }
    throw new Error("localhost health check did not become ready before the startup deadline");
  }

  private async healthProbe(): Promise<boolean> {
    this.assertRuntimeConfigured();
    try {
      const response = await this.localHttpRequest("GET", this.healthPath!, "", {});
      return this.healthSuccessStatusCodes.has(response.statusCode);
    } catch {
      return false;
    }
  }

  private async localHttpRequest(
    method: TenkiRuntimeHttpRequest["method"],
    path: string,
    body: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<TenkiRuntimeHttpResponse> {
    const spec = JSON.stringify({
      method,
      port: this.port,
      path,
      headers,
      bodyBase64: body ? Buffer.from(body, "utf8").toString("base64") : "",
      timeoutMs: this.requestTimeoutMs,
      maxBytes: this.maxResponseBytes,
    });
    const stdin = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(spec));
        controller.close();
      },
    });
    const handle = this.session.run(["node", "-e", LOCAL_HTTP_CLIENT_SOURCE], {
      cwd: this.workingDirectory,
      stdin,
    });
    const result = await this.observeCapturedProcess(handle, this.requestTimeoutMs, "localhost HTTP request");
    let response: LocalHttpWireResponse;
    try {
      response = JSON.parse(new TextDecoder().decode(result.stdout)) as LocalHttpWireResponse;
    } catch {
      throw new Error("Localhost HTTP helper returned an invalid response");
    }
    if (!response.ok || result.exitCode !== 0 || !response.statusCode) {
      throw new Error(`Localhost HTTP request failed: ${this.redactor.redact(response.error ?? "unknown error")}`);
    }
    const decodedBody = response.bodyBase64
      ? Buffer.from(response.bodyBase64, "base64").toString("utf8")
      : "";
    return {
      statusCode: response.statusCode,
      body: this.redactor.redact(decodedBody),
    };
  }

  private async exposePreviewIfAllowed(): Promise<void> {
    if (!this.config.preview.allowed) return;
    this.assertRuntimeConfigured();
    this.exposedPort = await this.session.exposePort(this.port!, {
      // Tenki rejects an explicit expires_at/ttl when a stable slug is used.
      // Slugged previews remain bounded by the VM lease and are explicitly
      // unexposed during every normal restart and cleanup path.
      ...(this.config.preview.slug
        ? { slug: this.config.preview.slug }
        : { ttlMs: this.config.preview.ttlMs }),
    });
  }

  private async cleanupRuntimeResources(): Promise<void> {
    const errors: unknown[] = [];
    if (this.exposedPort) {
      try {
        if (this.port !== null) await this.session.unexposePort(this.port);
      } catch (error) {
        errors.push(error);
      } finally {
        this.exposedPort = undefined;
      }
    }
    if (this.runtime) {
      const running = this.runtime;
      try {
        await this.terminateProcess(running.handle, running.completion);
        await Promise.allSettled(running.drains);
      } catch (error) {
        errors.push(error);
      } finally {
        if (this.runtime === running) this.runtime = undefined;
      }
    }
    if (errors.length) throw new Error(this.safeError(errors[0]));
  }

  private async observeLoggedProcess(
    handle: ProcessRunHandle,
    timeoutMs: number,
    label: string,
  ): Promise<ProcessRunResult> {
    const stdoutWriter = new RedactingStreamWriter(this.logBuffer, this.redactor);
    const stderrWriter = new RedactingStreamWriter(this.logBuffer, this.redactor);
    const drains = [
      drainStream(handle.stdout, stdoutWriter),
      drainStream(handle.stderr, stderrWriter),
    ];
    try {
      return await this.processWithTimeout(handle, timeoutMs, label);
    } finally {
      await Promise.allSettled(drains);
    }
  }

  private async observeCapturedProcess(
    handle: ProcessRunHandle,
    timeoutMs: number,
    label: string,
  ): Promise<ProcessRunResult> {
    return this.processWithTimeout(handle, timeoutMs, label);
  }

  private async processWithTimeout(
    handle: ProcessRunHandle,
    timeoutMs: number,
    label: string,
  ): Promise<ProcessRunResult> {
    const completion = Promise.resolve(handle);
    const timed = await this.raceWithTimeout(completion, timeoutMs);
    if (!timed.timedOut) return timed.value;
    await this.terminateProcess(handle, completion);
    throw new Error(`${label} exceeded its host-side timeout`);
  }

  private async terminateProcess(
    handle: ProcessRunHandle,
    completion: Promise<ProcessRunResult>,
  ): Promise<void> {
    await handle.signal("TERM").catch(() => undefined);
    const graceful = await this.raceWithTimeout(completion, this.terminationGraceMs);
    if (!graceful.timedOut) return;
    await handle.kill().catch(() => undefined);
    const forced = await this.raceWithTimeout(completion, this.terminationGraceMs);
    if (forced.timedOut) throw new Error("runtime process did not terminate after KILL");
  }

  private async promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    const result = await this.raceWithTimeout(promise, timeoutMs);
    if (result.timedOut) throw new Error(message);
    return result.value;
  }

  private raceWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const cancelTimeout = this.scheduleTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ timedOut: true });
      }, timeoutMs);
      promise.then(
        (value) => {
          if (settled) return;
          settled = true;
          cancelTimeout();
          resolve({ timedOut: false, value });
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          cancelTimeout();
          reject(error);
        },
      );
    });
  }

  private statusSnapshot(healthy: boolean): TenkiRuntimeStatus {
    return {
      state: this.state,
      ...(this.runtime?.pid !== undefined ? { pid: this.runtime.pid } : {}),
      healthy,
      ...(this.exposedPort ? { previewUrl: this.exposedPort.previewUrl } : {}),
      ...(this.lastExit ? { lastExit: this.lastExit } : {}),
    };
  }

  private safeError(error: unknown): string {
    return this.redactor.redact(error instanceof Error ? error.message : "unknown runtime error");
  }

  private validateEnvironment(input: Readonly<Record<string, string>>): Record<string, string> {
    const environment: Record<string, string> = {};
    for (const [name, value] of Object.entries(input)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new Error("Resolved environment contains an invalid variable name");
      }
      environment[name] = value;
    }
    return environment;
  }

  private assertUsable(): void {
    if (this.state === "disposed") throw new Error("Tenki runtime environment is disposed");
  }

  private assertRuntimeConfigured(): void {
    if (this.startCommand === null || this.port === null || this.healthPath === null) {
      throw new Error("Tenki runtime application is not configured");
    }
  }
}

export function createTenkiRuntimeEnvironment(
  session: RuntimeSession,
  config: TenkiRuntimeEnvironmentConfig,
  dependencies: TenkiRuntimeEnvironmentDependencies,
): TenkiRuntimeEnvironment {
  return new TenkiRuntimeEnvironment(session, config, dependencies);
}
