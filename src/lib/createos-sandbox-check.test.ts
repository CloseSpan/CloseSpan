import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateosSandboxTimeoutError } from "@nodeops-createos/sandbox";
import { runCreateosSandboxCheck } from "./createos-sandbox-check";

function execution(
  overrides: Partial<{
    stdout: string;
    stderr: string;
    exit_code: number;
    error: string;
    exec_ms: number;
  }> = {},
) {
  const { exec_ms = 37, ...resultOverrides } = overrides;
  return {
    result: {
      stdout: "closespan-createos-ready",
      stderr: "",
      exit_code: 0,
      ...resultOverrides,
    },
    exec_ms,
  };
}

function setup(result: ReturnType<typeof execution> | Error = execution()) {
  const sandbox = {
    id: "sandbox_test",
    runCommand: vi.fn().mockImplementation(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
    destroy: vi.fn().mockResolvedValue(undefined),
    waitUntilDestroyed: vi.fn().mockResolvedValue(undefined),
  };
  const client = {
    createSandbox: vi.fn().mockResolvedValue(sandbox),
  };
  return { sandbox, client };
}

describe("CreateOS sandbox connectivity check", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("runs only the fixed verification command in a restricted sandbox", async () => {
    const { sandbox, client } = setup();
    const times = [1_000, 1_250];
    const result = await runCreateosSandboxCheck({
      apiKey: "createos_test",
      baseUrl: "https://api.sb.createos.sh",
      now: () => times.shift()!,
      createClient: () => client,
    });

    expect(client.createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        shape: "s-1vcpu-256mb",
        rootfs: "devbox:1",
        ingress_enabled: false,
        egress: ["127.0.0.1:1"],
        auto_pause_after_seconds: 60,
      }),
      { timeoutMs: 30_000 },
    );
    expect(sandbox.runCommand).toHaveBeenCalledWith(
      "printf",
      ["closespan-createos-ready"],
      { timeoutMs: 10_000 },
    );
    expect(sandbox.destroy).toHaveBeenCalledWith({ timeoutMs: 30_000 });
    expect(sandbox.waitUntilDestroyed).toHaveBeenCalledWith({
      timeoutMs: 30_000,
    });
    expect(result).toMatchObject({
      status: "ok",
      sandboxId: "sandbox_test",
      executionDurationMs: 37,
      totalDurationMs: 250,
    });
  });

  it("rejects unexpected command output and still destroys the sandbox", async () => {
    const { sandbox, client } = setup(execution({ stdout: "unexpected" }));

    await expect(
      runCreateosSandboxCheck({
        apiKey: "createos_test",
        createClient: () => client,
      }),
    ).rejects.toMatchObject({ code: "execution_failed" });
    expect(sandbox.destroy).toHaveBeenCalledOnce();
    expect(sandbox.waitUntilDestroyed).toHaveBeenCalledOnce();
  });

  it("sanitizes provider timeouts and still cleans up", async () => {
    const { sandbox, client } = setup(
      new CreateosSandboxTimeoutError("provider detail that must not be returned"),
    );

    await expect(
      runCreateosSandboxCheck({
        apiKey: "createos_test",
        createClient: () => client,
      }),
    ).rejects.toMatchObject({
      code: "timeout",
      message: "The CreateOS sandbox did not become ready in time.",
    });
    expect(sandbox.destroy).toHaveBeenCalledOnce();
  });

  it("fails closed when sandbox destruction cannot be confirmed", async () => {
    const { sandbox, client } = setup();
    sandbox.waitUntilDestroyed.mockRejectedValue(new Error("cleanup failed"));

    await expect(
      runCreateosSandboxCheck({
        apiKey: "createos_test",
        createClient: () => client,
      }),
    ).rejects.toMatchObject({ code: "cleanup_failed" });
  });

  it("does not contact CreateOS without a server-side API key", async () => {
    const createClient = vi.fn();
    await expect(
      runCreateosSandboxCheck({ apiKey: "", createClient }),
    ).rejects.toMatchObject({ code: "not_configured" });
    expect(createClient).not.toHaveBeenCalled();
  });
});
