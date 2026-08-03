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
    schemaVersion: 1,
    orgId: context.orgId,
    verificationId: context.verificationId,
    repository: context.repository,
    baseSha: context.baseSha.toLowerCase(),
    promptId: context.promptId,
    promptHash: context.promptHash,
    pddPrompt: context.pddPrompt,
    pddVersion: context.pddVersion,
    budgetUsd: context.budgetUsd,
    repositoryArchiveUrl: archiveUrl,
    permittedPaths: context.permittedPaths,
    requiredCommands: context.requiredCommands,
    suspectedFiles: context.suspectedFiles,
    callbackUrl: `${config.callbackBaseUrl}/api/internal/pdd-verifications/${context.verificationId}`,
  });
  const signature = createHmac("sha256", config.secret).update(body).digest("hex");
  const response = await fetch(`${config.url}/verifications`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-closespan-signature": signature },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`PDD runner rejected the verification with HTTP ${response.status}`);
}
