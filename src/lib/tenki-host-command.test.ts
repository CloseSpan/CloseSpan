import { describe, expect, it, vi } from "vitest";
import { runTenkiHostCommand } from "./tenki-host-command";

function processHandle() {
  let resolve!: (value: {
    exitCode: number;
    stdout: Uint8Array;
    stderr: Uint8Array;
    signal?: string;
  }) => void;
  const completion = new Promise<{
    exitCode: number;
    stdout: Uint8Array;
    stderr: Uint8Array;
    signal?: string;
  }>((done) => { resolve = done; });
  return {
    handle: {
      then: completion.then.bind(completion),
      pid: Promise.resolve(42),
      stdout: new ReadableStream<Uint8Array>(),
      stderr: new ReadableStream<Uint8Array>(),
      stdin: new WritableStream<Uint8Array>(),
      signal: vi.fn(async () => undefined),
      kill: vi.fn(async () => undefined),
    },
    resolve,
  };
}

function sessionFor(process: ReturnType<typeof processHandle>) {
  return {
    run: vi.fn((argv: string[], options?: unknown) => {
      void argv;
      void options;
      return process.handle;
    }),
  };
}

describe("host-bounded Tenki commands", () => {
  it("returns a completed command without sending a signal", async () => {
    const process = processHandle();
    const session = sessionFor(process);
    process.resolve({
      exitCode: 0,
      stdout: new TextEncoder().encode("ok"),
      stderr: new Uint8Array(),
    });
    const result = await runTenkiHostCommand(session as never, ["npm", "test"], {
      cwd: "/repo",
      env: { CI: "true" },
      timeoutMs: 1_000,
    });
    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
    expect(process.handle.signal).not.toHaveBeenCalled();
    const [wrappedArgv, runOptions] = session.run.mock.calls[0]!;
    expect(wrappedArgv.slice(0, 2)).toEqual(["bash", "-c"]);
    expect(wrappedArgv[2]).toContain('setsid -- "$@" &');
    expect(wrappedArgv[2]).toContain('kill "-$1" -- "-$child_pid"');
    expect(wrappedArgv[2]).toContain("signal_group TERM");
    expect(wrappedArgv[2]).toContain("signal_group KILL");
    expect(wrappedArgv.slice(3)).toEqual([
      "tenki-host-command-supervisor",
      "50",
      "npm",
      "test",
    ]);
    expect(runOptions).toEqual({ cwd: "/repo", env: { CI: "true" } });
  });

  it("enforces the host deadline and terminates a hung command", async () => {
    vi.useFakeTimers();
    try {
      const process = processHandle();
      process.handle.signal.mockImplementation(async () => {
        process.resolve({
          exitCode: 143,
          stdout: new Uint8Array(),
          stderr: new Uint8Array(),
          signal: "TERM",
        });
      });
      const session = sessionFor(process);
      const pending = runTenkiHostCommand(session as never, ["npm", "test"], {
        timeoutMs: 100,
        terminationGraceMs: 50,
      });
      await vi.advanceTimersByTimeAsync(100);
      const result = await pending;
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBe(143);
      expect(process.handle.signal).toHaveBeenCalledWith("TERM");
      expect(new TextDecoder().decode(result.stderr)).toContain("host-side timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("escalates from TERM to KILL when the supervised group stays hung", async () => {
    vi.useFakeTimers();
    try {
      const process = processHandle();
      process.handle.kill.mockImplementation(async () => {
        process.resolve({
          exitCode: 137,
          stdout: new Uint8Array(),
          stderr: new Uint8Array(),
          signal: "KILL",
        });
      });
      const session = sessionFor(process);
      const pending = runTenkiHostCommand(session as never, ["bash", "-c", "wait"], {
        timeoutMs: 100,
        terminationGraceMs: 50,
      });
      await vi.advanceTimersByTimeAsync(150);
      const result = await pending;
      expect(result).toMatchObject({ timedOut: true, exitCode: 137, signal: "KILL" });
      expect(process.handle.signal).toHaveBeenCalledTimes(1);
      expect(process.handle.signal).toHaveBeenCalledWith("TERM");
      expect(process.handle.kill).toHaveBeenCalledTimes(1);
      expect(process.handle.signal.mock.invocationCallOrder[0]).toBeLessThan(
        process.handle.kill.mock.invocationCallOrder[0]!,
      );
      expect(session.run.mock.calls[0]?.[0].slice(-3)).toEqual(["bash", "-c", "wait"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects an invalid termination grace before starting a command", async () => {
    const session = sessionFor(processHandle());
    await expect(runTenkiHostCommand(session as never, ["true"], {
      timeoutMs: 100,
      terminationGraceMs: 0,
    })).rejects.toThrow("termination grace must be a positive integer");
    expect(session.run).not.toHaveBeenCalled();
  });
});
