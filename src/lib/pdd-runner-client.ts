import { createHmac } from "node:crypto";
import { createRepositoryArchiveUrl } from "./github-agent-publisher";
import type { PddVerificationExecutionContext } from "./engineering-workflow-repository";

function configuration(): { url: string; secret: string; callbackBaseUrl: string } | null {
  const url = process.env.PDD_RUNNER_URL?.trim().replace(/\/$/, "");
  const secret = process.env.PDD_RUNNER_SHARED_SECRET?.trim();
  const callbackBaseUrl = process.env.CLOSESPAN_INTERNAL_BASE_URL?.trim().replace(/\/$/, "");
  return url && secret && callbackBaseUrl ? { url, secret, callbackBaseUrl } : null;
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
