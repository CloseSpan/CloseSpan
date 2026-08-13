import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { createRepositoryArchiveUrl } from "./github-agent-publisher";
import type { PddVerificationExecutionContext } from "./engineering-workflow-repository";
import type { AiProvider } from "./ai-config";
import type { PromptEvaluationMode } from "./prompt-evaluation-policy";

function promptEvaluationConfiguration(): { url: string; secret: string } | null {
  const url = process.env.PDD_RUNNER_URL?.trim().replace(/\/$/, "");
  const secret = process.env.PDD_RUNNER_SHARED_SECRET?.trim();
  return url && secret ? { url, secret } : null;
}

function configuration(): { url: string; secret: string; callbackBaseUrl: string } | null {
  const base = promptEvaluationConfiguration();
  const callbackBaseUrl = process.env.CLOSESPAN_INTERNAL_BASE_URL?.trim().replace(/\/$/, "");
  return base && callbackBaseUrl ? { ...base, callbackBaseUrl } : null;
}

const promptEvaluationResultSchema = z.object({
  schemaVersion: z.literal(1),
  requestId: z.string().uuid(),
  promptHash: z.string().regex(/^[a-f0-9]{64}$/),
  verdict: z.enum(["Passed", "Needs revision"]),
  changes: z.array(z.string().trim().min(1).max(16_000)).max(8),
  acceptanceContract: z.string().trim().min(1).max(1_000_000).optional(),
  pddVersion: z.string().trim().min(1).max(64),
  executionMode: z.enum(["cloud", "local"]),
  model: z.string().trim().min(1).max(200).nullable(),
  costUsd: z.number().min(0).max(5).nullable(),
});

const promptEvaluationAcceptedSchema = z.object({
  schemaVersion: z.literal(1),
  accepted: z.literal(true),
  requestId: z.string().uuid(),
  promptHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.literal("Queued"),
});

const promptEvaluationPendingSchema = z.object({
  schemaVersion: z.literal(1),
  requestId: z.string().uuid(),
  promptHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["Queued", "Running"]),
});

function signedHeaders(secret: string, body: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-closespan-signature": createHmac("sha256", secret).update(body).digest("hex"),
  };
}

async function pddResponseError(response: Response): Promise<Error> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => null) as { error?: unknown } | null;
    if (typeof payload?.error === "string" && payload.error.trim()) {
      return new Error(payload.error.trim().slice(0, 1_000));
    }
  } else if (response.body) {
    await response.body.cancel().catch(() => undefined);
  }
  return new Error(`The prompt evaluation runner could not evaluate this prompt (HTTP ${response.status})`);
}

export type PddPromptEvaluationResult = z.infer<typeof promptEvaluationResultSchema>;

interface LocalPddRuntimeBase {
  provider: AiProvider;
  model: string;
}

export type LocalPddRuntime = LocalPddRuntimeBase & (
  | { apiKey: string; credentialSource?: never }
  | { credentialSource: "runner"; apiKey?: never }
);

function assertCredentialTransport(url: string): void {
  const parsed = new URL(url);
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !localHost) {
    throw new Error(
      "Local Prompt Driven evaluation requires an HTTPS runner connection",
    );
  }
}

export async function evaluatePromptWithPdd(input: {
  promptHash: string;
  userStory: string;
  implementationPrompt: string;
  acceptanceContract?: string;
  pddVersion: string;
  evaluationMode: PromptEvaluationMode;
  localRuntime?: LocalPddRuntime;
  budgetUsd?: number;
}): Promise<PddPromptEvaluationResult> {
  const config = promptEvaluationConfiguration();
  if (!config) {
    throw new Error("The prompt evaluation runner is not configured");
  }
  if (input.localRuntime) assertCredentialTransport(config.url);
  const requestId = randomUUID();
  // Local Prompt Driven evaluations build a contract and then evaluate it in
  // separate bounded provider calls. The detector carries the complete PDD
  // contract, so its input alone can legitimately cost more than the old
  // $0.05 stage allocation. Prompt Driven's full detector contract can exceed
  // 120k input tokens before the provider is invoked, so local and fallback
  // runs need the runner's maximum bounded ceiling. This is a hard cap rather
  // than a charge: actual provider usage is still measured and reported.
  // Keep Cloud's existing lower cap because Cloud performs its own routing.
  const defaultBudgetUsd = input.evaluationMode === "pdd_cloud" ? 0.25 : 5;
  const body = JSON.stringify({
    schemaVersion: 1,
    requestId,
    promptHash: input.promptHash,
    userStory: input.userStory,
    implementationPrompt: input.implementationPrompt,
    ...(input.acceptanceContract
      ? { acceptanceContract: input.acceptanceContract }
      : {}),
    pddVersion: input.pddVersion,
    evaluationMode: input.evaluationMode,
    ...(input.localRuntime ? { localRuntime: input.localRuntime } : {}),
    budgetUsd: input.budgetUsd ?? defaultBudgetUsd,
  });
  const response = await fetch(`${config.url}/prompt-evaluations`, {
    method: "POST",
    headers: signedHeaders(config.secret, body),
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 200) {
    const legacyResult = promptEvaluationResultSchema.parse(await response.json());
    if (legacyResult.requestId !== requestId || legacyResult.promptHash !== input.promptHash) {
      throw new Error("The prompt evaluation runner returned a result for a different prompt");
    }
    return legacyResult;
  }
  if (response.status !== 202) {
    throw await pddResponseError(response);
  }
  const accepted = promptEvaluationAcceptedSchema.parse(await response.json());
  if (accepted.requestId !== requestId || accepted.promptHash !== input.promptHash) {
    throw new Error("The prompt evaluation runner accepted a different prompt evaluation");
  }

  const deadline = Date.now() + 270_000;
  while (Date.now() < deadline) {
    const statusBody = JSON.stringify({
      schemaVersion: 1,
      requestId,
      promptHash: input.promptHash,
    });
    const statusResponse = await fetch(`${config.url}/prompt-evaluations/status`, {
      method: "POST",
      headers: signedHeaders(config.secret, statusBody),
      body: statusBody,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (statusResponse.status === 200) {
      const result = promptEvaluationResultSchema.parse(await statusResponse.json());
      if (result.requestId !== requestId || result.promptHash !== input.promptHash) {
        throw new Error("The prompt evaluation runner returned a result for a different prompt");
      }
      return result;
    }
    if (statusResponse.status !== 202) {
      throw await pddResponseError(statusResponse);
    }
    const pending = promptEvaluationPendingSchema.parse(await statusResponse.json());
    if (pending.requestId !== requestId || pending.promptHash !== input.promptHash) {
      throw new Error("The prompt evaluation runner returned status for a different prompt");
    }
    await new Promise((resolve) => setTimeout(resolve, 1_250));
  }
  throw new Error("Prompt evaluation timed out; try again");
}

export function pddRunnerConfigured(): boolean {
  return configuration() !== null;
}

export function assertPddRunnerConfigured(): void {
  if (!configuration())
    throw new Error("PDD_RUNNER_URL, PDD_RUNNER_SHARED_SECRET, and CLOSESPAN_INTERNAL_BASE_URL are required for PDD verification");
}

export async function probePddRunner(): Promise<boolean> {
  const config = configuration();
  if (!config) return false;
  const health = await fetch(`${config.url}/health`, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!health.ok) return false;
  const payload = await health.json() as {
    status?: unknown;
    pddVersion?: unknown;
    executionProfileSchemaVersions?: unknown;
  };
  if (
    payload.status !== "ok"
    || typeof payload.pddVersion !== "string"
    || !Array.isArray(payload.executionProfileSchemaVersions)
    || !payload.executionProfileSchemaVersions.includes(1)
    || !payload.executionProfileSchemaVersions.includes(2)
  ) return false;

  // An empty signed object is intentionally invalid as a job. HTTP 400 proves
  // the deployed app and runner share the HMAC key without starting work;
  // HTTP 401 would mean the secrets diverged.
  const body = "{}";
  const signature = createHmac("sha256", config.secret).update(body).digest("hex");
  const signedProbe = await fetch(`${config.url}/verifications`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-closespan-signature": signature },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (signedProbe.body) await signedProbe.body.cancel();
  return signedProbe.status === 400;
}

export async function dispatchPddVerification(
  context: PddVerificationExecutionContext,
): Promise<void> {
  const config = configuration();
  if (!config) {
    if (process.env.APP_MODE === "production") assertPddRunnerConfigured();
    return;
  }
  const archiveUrl = await createRepositoryArchiveUrl(context);
  const body = JSON.stringify({
    schemaVersion: 2,
    orgId: context.orgId,
    verificationId: context.verificationId,
    repository: context.repository,
    baseSha: context.baseSha.toLowerCase(),
    promptId: context.promptId,
    promptHash: context.promptHash,
    pddPrompt: context.pddPrompt,
    pddVersion: context.pddVersion,
    executionProfileId: context.executionProfileId,
    executionProfileHash: context.executionProfileHash,
    executionProfileSnapshot: context.executionProfileSnapshot,
    budgetUsd: context.budgetUsd,
    repositoryArchiveUrl: archiveUrl,
    permittedPaths: context.permittedPaths,
    requiredCommands: context.requiredCommands,
    suspectedFiles: context.suspectedFiles,
    callbackUrl: `${config.callbackBaseUrl}/api/internal/pdd-verifications/${context.verificationId}`,
  });
  const signature = createHmac("sha256", config.secret).update(body).digest("hex");
  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(`${config.url}/verifications`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-closespan-signature": signature },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (![404, 502, 503, 504].includes(response.status) || attempt === 2) break;
    if (response.body) await response.body.cancel();
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  if (!response) throw new Error("PDD runner did not return a response");
  if (!response.ok) throw new Error(`PDD runner rejected the verification with HTTP ${response.status}`);
}
