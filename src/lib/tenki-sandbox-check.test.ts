import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecResult } from "@tenkicloud/sandbox";
import { runTenkiSandboxCheck } from "./tenki-sandbox-check";

function execution(overrides: Partial<ExecResult> = {}): ExecResult {
  return {
    sessionId: "session_test",
    command: "printf",
    args: ["closespan-tenki-ready"],
    status: "SUCCEEDED",
    exitCode: 0,
    durationMs: 37,
    outputs: [],
    stdout: new TextEncoder().encode("closespan-tenki-ready"),
    stderr: new Uint8Array(),
    ...overrides,
  };
}

function setup(result: ExecResult | Error = execution()) {
  const session = {
    id: "session_test",
    exec: vi.fn().mockImplementation(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const client = {
    createAndWait: vi.fn().mockResolvedValue(session),
    close: vi.fn(),
  };
  return { session, client };
}

describe("Tenki sandbox connectivity check", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("runs only the fixed verification command in an isolated sandbox", async () => {
    const { session, client } = setup();
    const times = [1_000, 1_250];
    const result = await runTenkiSandboxCheck({
      apiKey: "tk_test",
      now: () => times.shift()!,
      createClient: () => client,
    });

    expect(client.createAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        cpuCores: 1,
        memoryMb: 512,
        allowInbound: false,
        allowOutbound: false,
        maxDurationMs: 60_000,
      }),
    );
    expect(session.exec).toHaveBeenCalledWith("printf", {
      args: ["closespan-tenki-ready"],
      timeoutMs: 10_000,
    });
    expect(session.close).toHaveBeenCalledOnce();
    expect(client.close).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: "ok",
      sessionId: "session_test",
      executionDurationMs: 37,
      totalDurationMs: 250,
    });
  });

  it("rejects unexpected command output and still terminates the sandbox", async () => {
    const { session, client } = setup(
      execution({ stdout: new TextEncoder().encode("unexpected") }),
    );

    await expect(
      runTenkiSandboxCheck({
        apiKey: "tk_test",
        createClient: () => client,
      }),
    ).rejects.toMatchObject({
      code: "execution_failed",
    });
    expect(session.close).toHaveBeenCalledOnce();
    expect(client.close).toHaveBeenCalledOnce();
  });

  it("reports command timeouts without leaking provider errors and cleans up", async () => {
    const timeout = new Error("provider detail that must not be returned");
    timeout.name = "CommandTimeoutError";
    const { session, client } = setup(timeout);

    await expect(
      runTenkiSandboxCheck({
        apiKey: "tk_test",
        createClient: () => client,
      }),
    ).rejects.toMatchObject({
      code: "timeout",
      message: "The Tenki sandbox did not become ready in time.",
    });
    expect(session.close).toHaveBeenCalledOnce();
  });

  it("fails closed when session termination cannot be confirmed", async () => {
    const { session, client } = setup();
    session.close.mockRejectedValue(new Error("termination failed"));

    await expect(
      runTenkiSandboxCheck({
        apiKey: "tk_test",
        createClient: () => client,
      }),
    ).rejects.toMatchObject({
      code: "cleanup_failed",
    });
    expect(client.close).toHaveBeenCalledOnce();
  });

  it("does not contact Tenki without a server-side API key", async () => {
    const createClient = vi.fn();
    await expect(
      runTenkiSandboxCheck({ apiKey: "", createClient }),
    ).rejects.toMatchObject({
      code: "not_configured",
    });
    expect(createClient).not.toHaveBeenCalled();
  });
});
