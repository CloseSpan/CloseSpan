import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { ProcessRunHandle, ProcessRunResult, Session } from "@tenkicloud/sandbox";
import { describe, expect, it, vi } from "vitest";
import { TenkiLiveReplayWitness } from "./tenki-live-replay-witness";

function result(stdout = "", exitCode = 0): ProcessRunResult {
  return {
    exitCode,
    stdout: new TextEncoder().encode(stdout),
    stderr: new Uint8Array(),
  };
}

function immediate(value: ProcessRunResult): ProcessRunHandle {
  const completion = Promise.resolve(value);
  return {
    pid: Promise.resolve(1),
    stdout: new ReadableStream<Uint8Array>(),
    stderr: new ReadableStream<Uint8Array>(),
    stdin: new WritableStream<Uint8Array>(),
    signal: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined),
    then: completion.then.bind(completion),
  };
}

function pendingProxy(): ProcessRunHandle {
  let finish!: (value: ProcessRunResult) => void;
  const completion = new Promise<ProcessRunResult>((resolve) => { finish = resolve; });
  return {
    pid: Promise.resolve(2),
    stdout: new ReadableStream<Uint8Array>(),
    stderr: new ReadableStream<Uint8Array>(),
    stdin: new WritableStream<Uint8Array>(),
    signal: vi.fn(async () => finish(result("", 143))),
    kill: vi.fn(async () => finish(result("", 137))),
    then: completion.then.bind(completion),
  };
}

function localProcessSession(): Pick<Session, "run"> {
  return {
    run(argv, options) {
      // The production Tenki VM is Linux and supports the setsid supervisor.
      // This integration adapter runs on macOS too, so unwrap that separately
      // tested supervisor and execute its original command locally.
      const executableArgv = argv[3] === "tenki-host-command-supervisor"
        ? argv.slice(5)
        : argv;
      const executable = executableArgv[0];
      if (!executable) throw new Error("Missing local test executable");
      const child = spawn(executable, executableArgv.slice(1), {
        cwd: options?.cwd,
        env: options?.env ? { ...process.env, ...options.env } : process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      const completion = new Promise<ProcessRunResult>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (exitCode, signal) => resolve({
          exitCode: exitCode ?? (signal ? 128 : 1),
          stdout: new Uint8Array(Buffer.concat(stdout)),
          stderr: new Uint8Array(Buffer.concat(stderr)),
        }));
      });
      return {
        pid: Promise.resolve(child.pid ?? 0),
        stdout: new ReadableStream<Uint8Array>(),
        stderr: new ReadableStream<Uint8Array>(),
        stdin: new WritableStream<Uint8Array>(),
        signal: async (signal) => { child.kill(signal as NodeJS.Signals); },
        kill: async () => { child.kill("SIGKILL"); },
        then: completion.then.bind(completion),
      } as ProcessRunHandle;
    },
  };
}

async function listenOnLoopback(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end(request.url === "/health" ? "healthy" : "live application");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

describe("Tenki live replay witness", () => {
  it("proves that the test contacted the VM-local application and cleans up", async () => {
    const proxy = pendingProxy();
    const processes = [proxy, immediate(result()), immediate(result("2")), immediate(result())];
    const run = vi.fn<Session["run"]>(() => {
      const process = processes.shift();
      if (!process) throw new Error("Unexpected process");
      return process;
    });
    const witness = new TenkiLiveReplayWitness(
      { run },
      3_000,
      "/health",
      "/home/tenki/repo",
      ["private-value"],
    );

    await expect(witness.start()).resolves.toBe("http://127.0.0.1:4024");
    await expect(witness.requestCount()).resolves.toBe(2);
    await witness.close();

    expect(run.mock.calls[0]?.[0].slice(0, 3)).toEqual(["node", "-e", expect.any(String)]);
    expect(run.mock.calls[1]?.[0]).toContain("/health");
    expect(proxy.signal).toHaveBeenCalledWith("TERM");
  });

  it("forwards to a real loopback application and counts only replay traffic", async () => {
    const application = await listenOnLoopback();
    const witness = new TenkiLiveReplayWitness(
      localProcessSession(),
      application.port,
      "/health",
      process.cwd(),
      [],
    );

    try {
      await witness.start();
      await expect(witness.requestCount()).resolves.toBe(0);

      const response = await fetch(`${witness.baseUrl}/user-story`);
      await expect(response.text()).resolves.toBe("live application");
      await expect(witness.requestCount()).resolves.toBe(1);
    } finally {
      await witness.close();
      await application.close();
    }
  });
});
