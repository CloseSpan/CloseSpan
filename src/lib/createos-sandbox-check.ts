import {
  CreateosSandboxAuthError,
  CreateosSandboxClient,
  CreateosSandboxConnectionError,
  CreateosSandboxPaymentRequiredError,
  CreateosSandboxPermissionError,
  CreateosSandboxRateLimitError,
  CreateosSandboxServerError,
  CreateosSandboxTimeoutError,
  type ExecResponse,
} from "@nodeops-createos/sandbox";

const CHECK_MARKER = "closespan-createos-ready";
const CREATE_TIMEOUT_MS = 30_000;
const EXECUTION_TIMEOUT_MS = 10_000;
const CLEANUP_TIMEOUT_MS = 30_000;
const EGRESS_SINK = "127.0.0.1:1";
const SANDBOX_NAME_PREFIX = "cs-test-";

type CreateosSandbox = {
  id: string;
  runCommand(
    command: string,
    args?: string[],
    options?: { timeoutMs?: number },
  ): Promise<ExecResponse>;
  destroy(options?: { timeoutMs?: number }): Promise<unknown>;
  waitUntilDestroyed(options?: { timeoutMs?: number }): Promise<unknown>;
};

type CreateosClient = {
  createSandbox(
    options: {
      shape: string;
      rootfs: string;
      name: string;
      ingress_enabled: boolean;
      egress: string[];
      auto_pause_after_seconds: number;
    },
    requestOptions?: { timeoutMs?: number },
  ): Promise<CreateosSandbox>;
};

export type CreateosSandboxCheckCode =
  | "not_configured"
  | "unauthorized"
  | "quota_exceeded"
  | "timeout"
  | "execution_failed"
  | "cleanup_failed"
  | "unavailable";

export class CreateosSandboxCheckError extends Error {
  constructor(
    public readonly code: CreateosSandboxCheckCode,
    message: string,
  ) {
    super(message);
    this.name = "CreateosSandboxCheckError";
  }
}

export interface CreateosSandboxCheckResult {
  status: "ok";
  provider: "CreateOS Sandbox";
  sandboxId: string;
  executionDurationMs: number;
  totalDurationMs: number;
  checkedAt: string;
}

interface CheckDependencies {
  apiKey?: string;
  baseUrl?: string;
  now?: () => number;
  createClient?: (apiKey: string, baseUrl?: string) => CreateosClient;
}

function defaultClient(apiKey: string, baseUrl?: string): CreateosClient {
  return new CreateosSandboxClient({
    apiKey,
    baseUrl,
    timeoutMs: CREATE_TIMEOUT_MS,
  }) as CreateosClient;
}

function classifyProviderError(error: unknown): CreateosSandboxCheckError {
  if (
    error instanceof CreateosSandboxAuthError ||
    error instanceof CreateosSandboxPermissionError
  ) {
    return new CreateosSandboxCheckError(
      "unauthorized",
      "CreateOS rejected the configured API key or workspace access.",
    );
  }
  if (
    error instanceof CreateosSandboxPaymentRequiredError ||
    error instanceof CreateosSandboxRateLimitError
  ) {
    return new CreateosSandboxCheckError(
      "quota_exceeded",
      "The CreateOS workspace cannot start another sandbox right now.",
    );
  }
  if (error instanceof CreateosSandboxTimeoutError) {
    return new CreateosSandboxCheckError(
      "timeout",
      "The CreateOS sandbox did not become ready in time.",
    );
  }
  if (
    error instanceof CreateosSandboxConnectionError ||
    error instanceof CreateosSandboxServerError
  ) {
    return new CreateosSandboxCheckError(
      "unavailable",
      "CreateOS Sandbox is temporarily unavailable.",
    );
  }
  return new CreateosSandboxCheckError(
    "unavailable",
    "CreateOS Sandbox is temporarily unavailable.",
  );
}

export function createosSandboxConfigured(): boolean {
  return Boolean(process.env.CREATEOS_SANDBOX_API_KEY?.trim());
}

export async function runCreateosSandboxCheck(
  dependencies: CheckDependencies = {},
): Promise<CreateosSandboxCheckResult> {
  const apiKey =
    dependencies.apiKey ?? process.env.CREATEOS_SANDBOX_API_KEY?.trim();
  if (!apiKey) {
    throw new CreateosSandboxCheckError(
      "not_configured",
      "CreateOS Sandbox is not configured for this deployment.",
    );
  }

  const baseUrl =
    dependencies.baseUrl ?? process.env.CREATEOS_SANDBOX_BASE_URL?.trim();
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const client = (dependencies.createClient ?? defaultClient)(apiKey, baseUrl);
  let sandbox: CreateosSandbox | undefined;
  let result: ExecResponse | undefined;
  let operationError: unknown;
  let cleanupError: unknown;

  try {
    sandbox = await client.createSandbox(
      {
        // CreateOS limits sandbox names to 22 characters.
        name: `${SANDBOX_NAME_PREFIX}${crypto.randomUUID().slice(0, 8)}`,
        shape: "s-1vcpu-256mb",
        rootfs: "devbox:1",
        ingress_enabled: false,
        // CreateOS treats an empty egress list as allow-all. A single loopback
        // sink keeps this offline check from reaching an external service.
        egress: [EGRESS_SINK],
        auto_pause_after_seconds: 60,
      },
      { timeoutMs: CREATE_TIMEOUT_MS },
    );
    result = await sandbox.runCommand("printf", [CHECK_MARKER], {
      timeoutMs: EXECUTION_TIMEOUT_MS,
    });
    if (
      result.result.exit_code !== 0 ||
      result.result.error ||
      result.result.stdout.trim() !== CHECK_MARKER
    ) {
      throw new CreateosSandboxCheckError(
        "execution_failed",
        "The CreateOS sandbox started but did not complete the verification command.",
      );
    }
  } catch (error) {
    operationError = error;
  } finally {
    if (sandbox) {
      try {
        await sandbox.destroy({ timeoutMs: CLEANUP_TIMEOUT_MS });
        await sandbox.waitUntilDestroyed({ timeoutMs: CLEANUP_TIMEOUT_MS });
      } catch (error) {
        cleanupError = error;
      }
    }
  }

  if (cleanupError) {
    throw new CreateosSandboxCheckError(
      "cleanup_failed",
      "The verification ran, but CloseSpan could not confirm sandbox cleanup.",
    );
  }
  if (operationError) {
    if (operationError instanceof CreateosSandboxCheckError) {
      throw operationError;
    }
    throw classifyProviderError(operationError);
  }
  if (!sandbox || !result) {
    throw new CreateosSandboxCheckError(
      "unavailable",
      "CreateOS Sandbox did not return a verification result.",
    );
  }

  const finishedAt = now();
  return {
    status: "ok",
    provider: "CreateOS Sandbox",
    sandboxId: sandbox.id,
    executionDurationMs: result.exec_ms,
    totalDurationMs: Math.max(0, finishedAt - startedAt),
    checkedAt: new Date(finishedAt).toISOString(),
  };
}
