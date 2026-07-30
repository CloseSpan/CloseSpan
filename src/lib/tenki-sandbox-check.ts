import { TenkiSandbox, type ExecResult } from "@tenkicloud/sandbox";

const CHECK_MARKER = "closespan-tenki-ready";
const CREATE_TIMEOUT_MS = 30_000;
const EXECUTION_TIMEOUT_MS = 10_000;

type TenkiSession = {
  id: string;
  exec(command: string, options?: {
    args?: string[];
    timeoutMs?: number;
  }): Promise<ExecResult>;
  close(): Promise<void>;
};

type TenkiClient = {
  createAndWait(options: {
    name: string;
    cpuCores: number;
    memoryMb: number;
    allowInbound: boolean;
    allowOutbound: boolean;
    maxDurationMs: number;
    idleTimeoutMinutes: number;
    metadata: Record<string, string>;
    timeoutMs: number;
  }): Promise<TenkiSession>;
  close(): void;
};

export type TenkiSandboxCheckCode =
  | "not_configured"
  | "unauthorized"
  | "quota_exceeded"
  | "timeout"
  | "execution_failed"
  | "cleanup_failed"
  | "unavailable";

export class TenkiSandboxCheckError extends Error {
  constructor(
    public readonly code: TenkiSandboxCheckCode,
    message: string,
  ) {
    super(message);
    this.name = "TenkiSandboxCheckError";
  }
}

export interface TenkiSandboxCheckResult {
  status: "ok";
  provider: "Tenki Sandbox";
  sessionId: string;
  executionDurationMs: number;
  totalDurationMs: number;
  checkedAt: string;
}

interface CheckDependencies {
  apiKey?: string;
  now?: () => number;
  createClient?: (apiKey: string) => TenkiClient;
}

function defaultClient(apiKey: string): TenkiClient {
  return new TenkiSandbox({
    authToken: apiKey,
    timeoutMs: CREATE_TIMEOUT_MS,
    dataPlaneReadyTimeoutMs: CREATE_TIMEOUT_MS,
  }) as TenkiClient;
}

function classifyProviderError(error: unknown): TenkiSandboxCheckError {
  const name = error instanceof Error ? error.name : "UnknownError";
  if (name === "UnauthorizedError" || name === "PermissionDeniedError") {
    return new TenkiSandboxCheckError(
      "unauthorized",
      "Tenki rejected the configured API key.",
    );
  }
  if (name === "QuotaExceededError" || name === "RateLimitedError") {
    return new TenkiSandboxCheckError(
      "quota_exceeded",
      "The Tenki workspace cannot start another sandbox right now.",
    );
  }
  if (
    name === "CommandTimeoutError" ||
    name === "PrimitiveTimeoutError" ||
    name === "WaitReadyFailedError"
  ) {
    return new TenkiSandboxCheckError(
      "timeout",
      "The Tenki sandbox did not become ready in time.",
    );
  }
  return new TenkiSandboxCheckError(
    "unavailable",
    "Tenki Sandbox is temporarily unavailable.",
  );
}

export function tenkiSandboxConfigured(): boolean {
  return Boolean(process.env.TENKI_API_KEY?.trim());
}

export async function runTenkiSandboxCheck(
  dependencies: CheckDependencies = {},
): Promise<TenkiSandboxCheckResult> {
  const apiKey = dependencies.apiKey ?? process.env.TENKI_API_KEY?.trim();
  if (!apiKey) {
    throw new TenkiSandboxCheckError(
      "not_configured",
      "Tenki Sandbox is not configured for this deployment.",
    );
  }

  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const client = (dependencies.createClient ?? defaultClient)(apiKey);
  let session: TenkiSession | undefined;
  let result: ExecResult | undefined;
  let operationError: unknown;
  let cleanupError: unknown;

  try {
    session = await client.createAndWait({
      name: `closespan-connectivity-${crypto.randomUUID().slice(0, 8)}`,
      cpuCores: 1,
      memoryMb: 512,
      allowInbound: false,
      allowOutbound: false,
      maxDurationMs: 60_000,
      idleTimeoutMinutes: 1,
      metadata: { purpose: "closespan-connectivity-check" },
      timeoutMs: CREATE_TIMEOUT_MS,
    });
    result = await session.exec("printf", {
      args: [CHECK_MARKER],
      timeoutMs: EXECUTION_TIMEOUT_MS,
    });
    const output = new TextDecoder().decode(result.stdout).trim();
    if (
      result.exitCode !== 0 ||
      result.status !== "SUCCEEDED" ||
      output !== CHECK_MARKER
    ) {
      throw new TenkiSandboxCheckError(
        "execution_failed",
        "The Tenki sandbox started but did not complete the verification command.",
      );
    }
  } catch (error) {
    operationError = error;
  } finally {
    if (session) {
      try {
        await session.close();
      } catch (error) {
        cleanupError = error;
      }
    }
    client.close();
  }

  if (cleanupError) {
    throw new TenkiSandboxCheckError(
      "cleanup_failed",
      "The verification ran, but CloseSpan could not confirm sandbox cleanup.",
    );
  }
  if (operationError) {
    if (operationError instanceof TenkiSandboxCheckError) throw operationError;
    throw classifyProviderError(operationError);
  }
  if (!session || !result) {
    throw new TenkiSandboxCheckError(
      "unavailable",
      "Tenki Sandbox did not return a verification result.",
    );
  }

  const finishedAt = now();
  return {
    status: "ok",
    provider: "Tenki Sandbox",
    sessionId: session.id,
    executionDurationMs: result.durationMs,
    totalDurationMs: Math.max(0, finishedAt - startedAt),
    checkedAt: new Date(finishedAt).toISOString(),
  };
}
