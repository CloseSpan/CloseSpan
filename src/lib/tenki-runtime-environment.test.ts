import type { ProcessRunHandle, ProcessRunResult, Session } from "@tenkicloud/sandbox";
import { describe, expect, it, vi } from "vitest";
import { TENKI_BROWSER_PREFLIGHT_COMMAND } from "./execution-profile";
import {
  createTenkiRuntimeEnvironment,
  type TenkiRuntimeEnvironmentConfig,
} from "./tenki-runtime-environment";

interface ControllableProcess {
  handle: ProcessRunHandle;
  signal: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  resolve: (result?: ProcessRunResult) => void;
}

function readable(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk === undefined) controller.close();
      else controller.enqueue(encoder.encode(chunk));
    },
  });
}

function processResult(overrides: Partial<ProcessRunResult> = {}): ProcessRunResult {
  return {
    exitCode: 0,
    stdout: new Uint8Array(),
    stderr: new Uint8Array(),
    durationMs: 1,
    reason: "exit",
    ...overrides,
  };
}

function controllableProcess(options: {
  stdout?: readonly string[];
  stderr?: readonly string[];
  immediateResult?: ProcessRunResult;
  exitOnTerm?: boolean;
  exitOnKill?: boolean;
  pid?: number;
} = {}): ControllableProcess {
  let resolvePromise: (result: ProcessRunResult) => void = () => undefined;
  const promise = new Promise<ProcessRunResult>((resolve) => {
    resolvePromise = resolve;
  });
  const signal = vi.fn(async (name: string) => {
    if (name === "TERM" && options.exitOnTerm) {
      resolvePromise(processResult({ exitCode: 143, signal: "TERM", reason: "signaled" }));
    }
  });
  const kill = vi.fn(async () => {
    if (options.exitOnKill) {
      resolvePromise(processResult({ exitCode: 137, signal: "KILL", reason: "signaled" }));
    }
  });
  const handle: ProcessRunHandle = {
    pid: Promise.resolve(options.pid ?? 41),
    stdout: readable(options.stdout ?? []),
    stderr: readable(options.stderr ?? []),
    stdin: new WritableStream<Uint8Array>(),
    signal,
    kill,
    then: promise.then.bind(promise),
  };
  if (options.immediateResult) resolvePromise(options.immediateResult);
  return {
    handle,
    signal,
    kill,
    resolve: (result = processResult()) => resolvePromise(result),
  };
}

function httpProcess(statusCode: number, body = ""): ControllableProcess {
  const stdout = JSON.stringify({
    ok: true,
    statusCode,
    bodyBase64: Buffer.from(body, "utf8").toString("base64"),
  });
  return controllableProcess({
    immediateResult: processResult({ stdout: new TextEncoder().encode(stdout) }),
  });
}

function baseConfig(overrides: Partial<TenkiRuntimeEnvironmentConfig> = {}): TenkiRuntimeEnvironmentConfig {
  return {
    workingDirectory: "/home/tenki/repo",
    install: { enabled: false, commands: [] },
    build: { enabled: false, commands: [] },
    startCommand: "npm run dev",
    port: 3000,
    healthPath: "/health",
    preview: { allowed: false, ttlMs: 60_000 },
    commandTimeoutMs: 1_000,
    startupTimeoutMs: 1_000,
    healthPollIntervalMs: 100,
    requestTimeoutMs: 1_000,
    terminationGraceMs: 100,
    maxLogBytes: 4_096,
    maxResponseBytes: 4_096,
    ...overrides,
  };
}

describe("Tenki runtime environment", () => {
  it("preserves the configured repository cwd for setup and application shells", async () => {
    const install = controllableProcess({ immediateResult: processResult() });
    const runtime = controllableProcess({ exitOnTerm: true });
    const health = httpProcess(200);
    const processes = [install, runtime, health];
    const run = vi.fn<Session["run"]>(() => {
      const process = processes.shift();
      if (!process) throw new Error("Unexpected process launch");
      return process.handle;
    });
    const workingDirectory = "/home/tenki/repo/apps/web";
    const environment = createTenkiRuntimeEnvironment(
      { inboundEnabled: false, run, exposePort: vi.fn(), unexposePort: vi.fn() },
      baseConfig({
        workingDirectory,
        install: { enabled: true, commands: ["npm ci"] },
      }),
      { setupEnv: {}, runtimeEnv: {}, redactionValues: [] },
    );

    await environment.start();

    expect(run.mock.calls[0]?.[0]).toEqual(["bash", "-c", "npm ci"]);
    expect(run.mock.calls[0]?.[1]).toMatchObject({ cwd: workingDirectory });
    expect(run.mock.calls[1]?.[0].slice(0, 2)).toEqual(["bash", "-c"]);
    expect(run.mock.calls[1]?.[0][2]).toContain("setsid bash -c");
    expect(run.mock.calls[1]?.[1]).toMatchObject({ cwd: workingDirectory });
    expect(run.mock.calls.flatMap(([argv]) => argv)).not.toContain("-lc");

    await environment.close();
  });

  it("runs enabled setup, starts the app, exposes a short preview, redacts logs, and cleans up", async () => {
    const install = controllableProcess({
      stdout: ["installed with tok", "en-value\n"],
      immediateResult: processResult(),
    });
    const build = controllableProcess({ immediateResult: processResult() });
    const runtime = controllableProcess({
      stdout: ["server token=tok", "en-value ready\n"],
      exitOnTerm: true,
      pid: 777,
    });
    const health = httpProcess(200);
    const processes = [install, build, runtime, health];
    const run = vi.fn<Session["run"]>(() => {
      const process = processes.shift();
      if (!process) throw new Error("Unexpected process launch");
      return process.handle;
    });
    const exposePort = vi.fn(async () => ({
      port: 3000,
      previewUrl: "https://preview.test",
      expiresAt: new Date(Date.now() + 60_000),
    }));
    const unexposePort = vi.fn(async () => undefined);
    const environment = createTenkiRuntimeEnvironment(
      { inboundEnabled: true, run, exposePort, unexposePort },
      baseConfig({
        install: { enabled: true, commands: ["npm ci"] },
        build: { enabled: true, commands: ["npm run build"] },
        preview: { allowed: true, ttlMs: 60_000, slug: "run-preview" },
      }),
      {
        setupEnv: { APP_TOKEN: "token-value" },
        runtimeEnv: { APP_TOKEN: "token-value" },
        redactionValues: [],
      },
    );

    await expect(environment.start()).resolves.toMatchObject({
      state: "healthy",
      pid: 777,
      healthy: true,
      previewUrl: "https://preview.test",
    });
    await Promise.resolve();

    expect(run.mock.calls.slice(0, 2).map((call) => call[0])).toEqual([
      ["bash", "-c", "npm ci"],
      ["bash", "-c", "npm run build"],
    ]);
    expect(run.mock.calls[2]?.[0].slice(0, 2)).toEqual(["bash", "-c"]);
    expect(run.mock.calls[2]?.[0][2]).toContain("setsid bash -c");
    expect(run.mock.calls[2]?.[0].slice(-2)).toEqual(["--", "npm run dev"]);
    expect(run.mock.calls[0]?.[1]).toMatchObject({ env: { APP_TOKEN: "token-value" } });
    expect(exposePort).toHaveBeenCalledWith(3000, { slug: "run-preview" });
    expect(environment.logs()).toContain("[REDACTED]");
    expect(environment.logs()).not.toContain("token-value");

    await environment.close();
    expect(unexposePort).toHaveBeenCalledWith(3000);
    expect(runtime.signal).toHaveBeenCalledWith("TERM");
  });

  it("keeps requests on the configured localhost app and redacts response bodies", async () => {
    const runtime = controllableProcess({ exitOnTerm: true });
    const health = httpProcess(200);
    const response = httpProcess(200, '{"credential":"response-secret"}');
    const processes = [runtime, health, response];
    const run = vi.fn<Session["run"]>(() => {
      const process = processes.shift();
      if (!process) throw new Error("Unexpected process launch");
      return process.handle;
    });
    const exposePort = vi.fn();
    const environment = createTenkiRuntimeEnvironment(
      { inboundEnabled: false, run, exposePort, unexposePort: vi.fn() },
      baseConfig(),
      { setupEnv: {}, runtimeEnv: {}, redactionValues: ["response-secret"] },
    );
    await environment.start();

    await expect(environment.request({
      method: "POST",
      path: "/api/test?case=1",
      body: "{}",
      contentType: "application/json",
    })).resolves.toEqual({
      statusCode: 200,
      body: '{"credential":"[REDACTED]"}',
    });
    await expect(environment.request({ method: "GET", path: "//example.com/steal" })).rejects.toThrow(
      "local absolute paths",
    );
    expect(exposePort).not.toHaveBeenCalled();
    expect(run.mock.calls.filter((call) => call[0][0] === "node")).toHaveLength(2);
    await environment.close();
  });

  it("runs bounded Playwright interactions against only the configured localhost app", async () => {
    const preflight = controllableProcess({ immediateResult: processResult() });
    const runtime = controllableProcess({ exitOnTerm: true });
    const health = httpProcess(200);
    const browser = controllableProcess({
      immediateResult: processResult({
        stdout: new TextEncoder().encode(JSON.stringify({
          ok: true,
          url: "http://127.0.0.1:3000/account",
          title: "Account",
          text: "Signed in with browser-secret",
          html: "<main>browser-secret</main>",
        })),
      }),
    });
    const processes = [preflight, runtime, health, browser];
    const run = vi.fn<Session["run"]>(() => {
      const process = processes.shift();
      if (!process) throw new Error("Unexpected process launch");
      return process.handle;
    });
    const environment = createTenkiRuntimeEnvironment(
      { inboundEnabled: false, run, exposePort: vi.fn(), unexposePort: vi.fn() },
      baseConfig({
        install: {
          enabled: true,
          commands: [TENKI_BROWSER_PREFLIGHT_COMMAND],
        },
      }),
      { setupEnv: {}, runtimeEnv: {}, redactionValues: ["browser-secret"] },
    );
    await environment.start();

    await expect(environment.browser({
      path: "/account",
      actions: [
        { type: "fill", selector: "#email", value: "person@example.com" },
        { type: "click", selector: "button[type=submit]" },
      ],
    })).resolves.toEqual({
      url: "http://127.0.0.1:3000/account",
      title: "Account",
      text: "Signed in with [REDACTED]",
      html: "<main>[REDACTED]</main>",
    });
    expect(run.mock.calls[0]?.[0]).toEqual([
      "bash",
      "-c",
      TENKI_BROWSER_PREFLIGHT_COMMAND,
    ]);
    expect(run.mock.calls[3]?.[0].slice(0, 2)).toEqual(["node", "-e"]);
    await environment.close();
  });

  it("does not start or advertise browser interaction when the Chromium preflight fails", async () => {
    const failedPreflight = controllableProcess({
      immediateResult: processResult({ exitCode: 1, reason: "exit" }),
    });
    const run = vi.fn<Session["run"]>(() => failedPreflight.handle);
    const environment = createTenkiRuntimeEnvironment(
      { inboundEnabled: false, run, exposePort: vi.fn(), unexposePort: vi.fn() },
      baseConfig({
        install: {
          enabled: true,
          commands: [TENKI_BROWSER_PREFLIGHT_COMMAND],
        },
      }),
      { setupEnv: {}, runtimeEnv: {}, redactionValues: [] },
    );

    await expect(environment.start()).rejects.toThrow("install command 1 failed");
    expect(run).toHaveBeenCalledTimes(1);
    await environment.close();
  });

  it("refuses direct browser use when no exact Chromium preflight completed", async () => {
    const runtime = controllableProcess({ exitOnTerm: true });
    const health = httpProcess(200);
    const processes = [runtime, health];
    const run = vi.fn<Session["run"]>(() => {
      const process = processes.shift();
      if (!process) throw new Error("Unexpected process launch");
      return process.handle;
    });
    const environment = createTenkiRuntimeEnvironment(
      { inboundEnabled: false, run, exposePort: vi.fn(), unexposePort: vi.fn() },
      baseConfig(),
      { setupEnv: {}, runtimeEnv: {}, redactionValues: [] },
    );
    await environment.start();

    await expect(environment.browser({ path: "/" })).rejects.toThrow(
      "exact Chromium launch preflight did not complete",
    );
    expect(run).toHaveBeenCalledTimes(2);
    await environment.close();
  });

  it("can run automatic install and build without configuring a web process", async () => {
    const install = controllableProcess({ immediateResult: processResult() });
    const build = controllableProcess({ immediateResult: processResult() });
    const processes = [install, build];
    const run = vi.fn<Session["run"]>(() => {
      const process = processes.shift();
      if (!process) throw new Error("Unexpected process launch");
      return process.handle;
    });
    const environment = createTenkiRuntimeEnvironment(
      { inboundEnabled: false, run, exposePort: vi.fn(), unexposePort: vi.fn() },
      baseConfig({
        install: { enabled: true, commands: ["npm ci"] },
        build: { enabled: true, commands: ["npm run build"] },
        startCommand: null,
        port: null,
        healthPath: null,
      }),
      { setupEnv: {}, runtimeEnv: {}, redactionValues: [] },
    );

    await expect(environment.prepare()).resolves.toBeUndefined();
    expect(run.mock.calls.map((call) => call[0])).toEqual([
      ["bash", "-c", "npm ci"],
      ["bash", "-c", "npm run build"],
    ]);
    await expect(environment.start()).rejects.toThrow("not configured");
    await environment.close();
  });

  it("can rerun a failed baseline build after the coding agent changes the repository", async () => {
    const failedBuild = controllableProcess({
      immediateResult: processResult({ exitCode: 1, reason: "exit" }),
    });
    const repairedBuild = controllableProcess({ immediateResult: processResult() });
    const processes = [failedBuild, repairedBuild];
    const run = vi.fn<Session["run"]>(() => {
      const process = processes.shift();
      if (!process) throw new Error("Unexpected process launch");
      return process.handle;
    });
    const environment = createTenkiRuntimeEnvironment(
      { inboundEnabled: false, run, exposePort: vi.fn(), unexposePort: vi.fn() },
      baseConfig({
        install: { enabled: false, commands: [] },
        build: { enabled: true, commands: ["npm run build"] },
        startCommand: null,
        port: null,
        healthPath: null,
      }),
      {
        setupEnv: { PRIVATE_REGISTRY_TOKEN: "bootstrap-secret", PUBLIC_MODE: "test" },
        rerunEnv: { PUBLIC_MODE: "test" },
        runtimeEnv: {},
        redactionValues: [],
      },
    );

    await expect(environment.prepare()).rejects.toThrow("build command 1 failed");
    await expect(environment.prepare({ runBuild: true })).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]?.[1]?.env).toEqual({
      PRIVATE_REGISTRY_TOKEN: "bootstrap-secret",
      PUBLIC_MODE: "test",
    });
    expect(run.mock.calls[1]?.[1]?.env).toEqual({ PUBLIC_MODE: "test" });
    await environment.close();
  });

  it("rebuilds on an explicit restart and replaces the preview binding", async () => {
    const buildOne = controllableProcess({ immediateResult: processResult() });
    const runtimeOne = controllableProcess({ exitOnTerm: true });
    const healthOne = httpProcess(200);
    const buildTwo = controllableProcess({ immediateResult: processResult() });
    const runtimeTwo = controllableProcess({ exitOnTerm: true, pid: 99 });
    const healthTwo = httpProcess(200);
    const processes = [buildOne, runtimeOne, healthOne, buildTwo, runtimeTwo, healthTwo];
    const run = vi.fn<Session["run"]>(() => {
      const process = processes.shift();
      if (!process) throw new Error("Unexpected process launch");
      return process.handle;
    });
    const exposePort = vi.fn(async () => ({ port: 3000, previewUrl: "https://preview.test" }));
    const unexposePort = vi.fn(async () => undefined);
    const environment = createTenkiRuntimeEnvironment(
      { inboundEnabled: true, run, exposePort, unexposePort },
      baseConfig({
        build: { enabled: true, commands: ["npm run build"] },
        preview: { allowed: true, ttlMs: 60_000 },
      }),
      { setupEnv: {}, runtimeEnv: {}, redactionValues: [] },
    );
    await environment.start();

    await expect(environment.restart({ runBuild: true })).resolves.toMatchObject({
      state: "healthy",
      pid: 99,
    });
    expect(runtimeOne.signal).toHaveBeenCalledWith("TERM");
    expect(unexposePort).toHaveBeenCalledTimes(1);
    expect(exposePort).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.filter((call) => call[0][2] === "npm run build")).toHaveLength(2);
    await environment.close();
  });

  it("enforces a host-side setup timeout with TERM followed by KILL", async () => {
    const install = controllableProcess({ exitOnKill: true });
    const run = vi.fn<Session["run"]>(() => install.handle);
    let scheduledTimeouts = 0;
    const environment = createTenkiRuntimeEnvironment(
      { inboundEnabled: false, run, exposePort: vi.fn(), unexposePort: vi.fn() },
      baseConfig({ install: { enabled: true, commands: ["npm ci"] } }),
      {
        setupEnv: {},
        runtimeEnv: {},
        redactionValues: [],
        scheduleTimeout(callback) {
          scheduledTimeouts += 1;
          if (scheduledTimeouts <= 2) {
            queueMicrotask(callback);
            return () => undefined;
          }
          const timeout = setTimeout(callback, 0);
          return () => clearTimeout(timeout);
        },
      },
    );

    await expect(environment.start()).rejects.toThrow("host-side timeout");
    expect(install.signal).toHaveBeenCalledWith("TERM");
    expect(install.kill).toHaveBeenCalledTimes(1);
  });
});
