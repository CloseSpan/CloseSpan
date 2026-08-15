import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { agentImplementationReportSchema, validateAgentImplementationReport } from "@/lib/agent-run-verification";
import {
  completeAgentRun,
  failAgentRun,
  getAgentRunExecutionContext,
  markAgentRunRunning,
} from "@/lib/engineering-workflow-repository";
import { publishAgentRun } from "@/lib/github-agent-publisher";
import { noStoreHeaders } from "@/lib/request-security";
import {
  TenkiIndependentVerificationError,
  verifyAgentRunWithTenki,
  type TenkiVerificationResolvedEnvironment,
} from "@/lib/tenki-agent-verification";
import {
  executionProfileExecutor,
  sanitizeExecutionProfileConfig,
} from "@/lib/execution-profile";
import { resolveRuntimeSecretBindings } from "@/lib/runtime-secret-repository";
import { assertManagedTenkiBootSourceAllowed } from "@/lib/tenki-environment-catalog-repository";
import type { TrustedTenkiBootSource } from "@/lib/tenki-boot-source-attestation";
import { reconcileFullAutonomy } from "@/lib/autonomy-automation-repository";
import {
  assertGithubActionsRunIdentity,
  verifyGithubActionsOidcToken,
} from "@/lib/github-actions-oidc";
import { buildTenkiGithubActionsJob } from "@/lib/tenki-github-actions-job";
import { githubActionsRunnerLabel } from "@/lib/github-actions-runner-label";

export const maxDuration = 300;
const MAX_CALLBACK_BYTES = 6_000_000;

function validSignature(body: string, provided: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest();
  const actual = Buffer.from(provided, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim();
  if (!orgId) return NextResponse.json({ error: "Runner job request is missing the organization ID" }, { status: 400, headers: noStoreHeaders });
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return NextResponse.json({ error: "Runner job request requires GitHub OIDC authentication" }, { status: 401, headers: noStoreHeaders });
  try {
    const claims = await verifyGithubActionsOidcToken(bearer);
    const { runId } = await params;
    const context = await getAgentRunExecutionContext(orgId, runId);
    const profile = sanitizeExecutionProfileConfig(context.executionProfileSnapshot.config);
    const executor = executionProfileExecutor(profile);
    if (executor.kind !== "tenki_github_actions") {
      throw new Error("Agent run is not bound to a Tenki GitHub Actions execution profile");
    }
    assertGithubActionsRunIdentity({
      claims,
      repository: context.repository,
      runId,
      workflowPath: executor.workflowPath,
      expectedSha: context.baseSha,
    });
    const job = buildTenkiGithubActionsJob(context);
    const body = JSON.stringify(job);
    if (Buffer.byteLength(body, "utf8") > MAX_CALLBACK_BYTES) {
      return NextResponse.json({ error: "Runner job is too large" }, { status: 413, headers: noStoreHeaders });
    }
    return new NextResponse(body, {
      headers: { ...noStoreHeaders, "content-type": "application/json" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Runner job request failed" },
      { status: 409, headers: noStoreHeaders },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const secret = process.env.AGENT_EXECUTOR_SHARED_SECRET?.trim() ?? "";
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_CALLBACK_BYTES) return NextResponse.json({ error: "Executor callback is too large" }, { status: 413, headers: noStoreHeaders });
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_CALLBACK_BYTES) return NextResponse.json({ error: "Executor callback is too large" }, { status: 413, headers: noStoreHeaders });
  let payload: { event?: string; orgId?: string; sandboxId?: string; code?: string; message?: string; report?: unknown };
  try {
    payload = JSON.parse(body) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid executor callback" }, { status: 400, headers: noStoreHeaders });
  }
  const { runId } = await params;
  const signature = request.headers.get("x-closespan-signature") ?? "";
  const hmacAuthenticated = Boolean(secret) && /^[a-f0-9]{64}$/.test(signature)
    && validSignature(body, signature, secret);
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  let oidcClaims: Awaited<ReturnType<typeof verifyGithubActionsOidcToken>> | null = null;
  if (bearer) {
    try {
      oidcClaims = await verifyGithubActionsOidcToken(bearer);
    } catch {
      oidcClaims = null;
    }
  }
  if (!hmacAuthenticated && !oidcClaims)
    return NextResponse.json({ error: "Invalid executor signature" }, { status: 401, headers: noStoreHeaders });
  let failureContext: Awaited<ReturnType<typeof getAgentRunExecutionContext>> | null = null;
  try {
    if (!payload.orgId) throw new Error("Executor callback is missing the organization ID");
    const context = await getAgentRunExecutionContext(payload.orgId, runId);
    failureContext = context;
    const boundProfile = context.executionProfileSnapshot
      ? sanitizeExecutionProfileConfig(context.executionProfileSnapshot.config)
      : null;
    const boundExecutor = boundProfile
      ? executionProfileExecutor(boundProfile)
      : { kind: "tenki_sandbox" as const };
    if (boundExecutor.kind === "tenki_github_actions") {
      if (!oidcClaims) throw new Error("Tenki GitHub Actions callbacks require GitHub OIDC authentication");
      assertGithubActionsRunIdentity({
        claims: oidcClaims,
        repository: context.repository,
        runId,
        workflowPath: boundExecutor.workflowPath,
        expectedSha: context.baseSha,
      });
    } else if (!hmacAuthenticated) {
      throw new Error("Tenki Sandbox callbacks require the executor HMAC signature");
    }
    if (payload.event === "started") {
      if (!payload.sandboxId) throw new Error("Executor callback is missing the sandbox ID");
      await markAgentRunRunning(payload.orgId, runId, payload.sandboxId);
      return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
    }
    if (payload.event === "failed") {
      await failAgentRun(context, payload.code ?? "executor_failed", payload.message ?? "Agent executor failed");
      return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
    }
    if (payload.event !== "completed") throw new Error("Unknown executor callback event");
    const report = agentImplementationReportSchema.parse(payload.report);
    if (
      oidcClaims
      && report.independentVerification?.provider === "Tenki GitHub Actions"
    ) {
      assertGithubActionsRunIdentity({
        claims: oidcClaims,
        repository: context.repository,
        runId,
        workflowPath: boundExecutor.kind === "tenki_github_actions"
          ? boundExecutor.workflowPath
          : "",
        reportedWorkflowRunId: report.independentVerification.workflowRunId,
        expectedSha: context.baseSha,
      });
    }
    validateAgentImplementationReport(report, {
      runId,
      promptHash: context.promptHash,
      baseSha: context.baseSha,
      promptArtifactPath: context.promptArtifactPath,
      promptSnapshot: context.promptSnapshot,
      generatedTests: context.generatedTests,
    });
    if (report.status === "Failed" || report.status === "No changes") {
      await completeAgentRun(context, report);
      return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
    }
    await completeAgentRun(context, { ...report, status: "Tests passed" });
    after(async () => {
      let verificationPassed = false;
      try {
        const profile = context.executionProfileSnapshot
          ? sanitizeExecutionProfileConfig(context.executionProfileSnapshot.config)
          : null;
        const executor = profile ? executionProfileExecutor(profile) : { kind: "tenki_sandbox" as const };
        if (executor.kind === "tenki_github_actions") {
          const attestation = report.independentVerification;
          const expectedRunnerLabel = githubActionsRunnerLabel(executor);
          if (
            !attestation
            || attestation.provider !== "Tenki GitHub Actions"
            || attestation.status !== "passed"
            || attestation.runnerLabel !== expectedRunnerLabel
            || attestation.platform !== executor.platform
            || attestation.implementationJobId === attestation.verificationJobId
          ) {
            throw new Error("Tenki runner report is missing a matching independent fresh-job verification attestation");
          }
          verificationPassed = true;
          const publication = await publishAgentRun(context, report);
          await completeAgentRun(
            context,
            { ...report, status: "Draft PR opened" },
            publication,
          );
          await reconcileFullAutonomy(context.orgId).catch(() => undefined);
          return;
        }
        let runtimeEnvironment: TenkiVerificationResolvedEnvironment | undefined;
        let trustedBootSource: TrustedTenkiBootSource | undefined;
        if (context.executionProfileSnapshot) {
          const sandboxProfile = sanitizeExecutionProfileConfig(
            context.executionProfileSnapshot.config,
          );
          const managedEnvironment = await assertManagedTenkiBootSourceAllowed({
            orgId: context.orgId,
            repository: context.repository,
            workspaceRoot: context.executionProfileSnapshot.workspaceRoot,
            config: sandboxProfile,
            permitDeprecated: true,
          });
          if (managedEnvironment) {
            if (
              !managedEnvironment.registryDigestRef
              || !managedEnvironment.registryImageId
              || !managedEnvironment.tenkiWorkspaceId
              || !managedEnvironment.snapshotId
            ) {
              throw new Error("The managed Tenki environment is missing its immutable provider binding");
            }
            trustedBootSource = {
              registryDigestRef: managedEnvironment.registryDigestRef,
              registryImageId: managedEnvironment.registryImageId,
              workspaceId: managedEnvironment.tenkiWorkspaceId,
              snapshotId: managedEnvironment.snapshotId,
            };
          }
          if (sandboxProfile.schemaVersion === 2 || sandboxProfile.schemaVersion === 3) {
            const resolved = await resolveRuntimeSecretBindings({
              orgId: context.orgId,
              repository: context.repository,
              workspaceRoot: context.executionProfileSnapshot.workspaceRoot,
              bindings: sandboxProfile.secretBindings,
            });
            runtimeEnvironment = {
              setupEnv: resolved.setup,
              runtimeEnv: resolved.runtime,
              testEnv: resolved.test,
              redactionValues: resolved.redactionValues,
            };
          }
        }
        const verified = await verifyAgentRunWithTenki(context, report, {
          ...(runtimeEnvironment ? { runtimeEnvironment } : {}),
          ...(trustedBootSource ? { trustedBootSource } : {}),
        });
        if (verified.status === "Failed") {
          await completeAgentRun(context, verified);
          return;
        }
        verificationPassed = true;
        const publication = await publishAgentRun(context, verified);
        await completeAgentRun(
          context,
          { ...verified, status: "Draft PR opened" },
          publication,
        );
        await reconcileFullAutonomy(context.orgId).catch(() => undefined);
      } catch (error) {
        await failAgentRun(
          context,
          !verificationPassed || error instanceof TenkiIndependentVerificationError
            ? "independent_verification_failed"
            : "publication_failed",
          error instanceof Error
            ? error.message
            : "Independent verification or publication failed",
        );
      }
    });
    return NextResponse.json(
      { ok: true, status: "independent_verification_queued" },
      { status: 202, headers: noStoreHeaders },
    );
  } catch (error) {
    if (failureContext) {
      await failAgentRun(failureContext, "callback_processing_failed", error instanceof Error ? error.message : "Executor callback failed").catch(() => undefined);
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Executor callback failed" },
      { status: 409, headers: noStoreHeaders },
    );
  }
}
