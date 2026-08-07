import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  claimQueuedAgentRun,
  getAgentRunExecutionContext,
} from "@/lib/engineering-workflow-repository";
import {
  executeTenkiCodingJob,
  assertTenkiExecutionProfileBinding,
  tenkiAgentJobSchema,
  type TenkiAgentJob,
} from "@/lib/tenki-coding-executor";
import { noStoreHeaders } from "@/lib/request-security";
import { sanitizeExecutionProfileConfig } from "@/lib/execution-profile";
import { resolveRuntimeSecretBindings } from "@/lib/runtime-secret-repository";
import {
  assertManagedTenkiBootSourceAllowed,
  markManagedTenkiEnvironmentUsed,
} from "@/lib/tenki-environment-catalog-repository";
import type { TrustedTenkiBootSource } from "@/lib/tenki-boot-source-attestation";

export const maxDuration = 300;

function validSignature(body: string, provided: string, secret: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(provided)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const actual = Buffer.from(provided, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function callback(job: TenkiAgentJob, payload: Record<string, unknown>, secret: string): Promise<void> {
  const body = JSON.stringify({ orgId: job.orgId, ...payload });
  const response = await fetch(job.callbackUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-closespan-signature": createHmac("sha256", secret).update(body).digest("hex"),
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`CloseSpan callback failed with HTTP ${response.status}`);
}

function sameList(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function sameGeneratedTests(
  actual: TenkiAgentJob["generatedTests"],
  expected: NonNullable<TenkiAgentJob["generatedTests"]>,
): boolean {
  const received = actual ?? [];
  return received.length === expected.length && received.every((test, index) => {
    const approved = expected[index];
    return approved !== undefined
      && test.path === approved.path
      && test.content === approved.content
      && test.contentHash === approved.contentHash
      && test.command === approved.command;
  });
}

function sameExecutionProfileSnapshot(
  actual: Extract<TenkiAgentJob, { schemaVersion: 2 }>["executionProfileSnapshot"],
  expected: Extract<TenkiAgentJob, { schemaVersion: 2 }>["executionProfileSnapshot"],
): boolean {
  return actual.profileId === expected.profileId
    && actual.version === expected.version
    && actual.source === expected.source
    && actual.repository === expected.repository
    && actual.workspaceRoot === expected.workspaceRoot
    && actual.contentHash === expected.contentHash;
}

function assertCurrentApproval(job: TenkiAgentJob, context: Awaited<ReturnType<typeof getAgentRunExecutionContext>>): void {
  assertTenkiExecutionProfileBinding(job);
  const ticket = context.promptSnapshot.ticket;
  const generatedTests = context.generatedTests ?? [];
  const requiredCommands = [...new Set([...ticket.requiredCommands, ...generatedTests.map((test) => test.command)])];
  if (
    job.orgId !== context.orgId
    || job.runId !== context.runId
    || job.repository !== context.repository
    || job.baseSha !== context.baseSha.toLowerCase()
    || job.promptHash !== context.promptHash
    || job.promptContent !== context.promptContent
    || job.promptArtifactPath !== context.promptArtifactPath
    || job.executionProfileId !== context.executionProfileId
    || job.executionProfileHash !== context.executionProfileHash
    || !sameExecutionProfileSnapshot(job.executionProfileSnapshot, context.executionProfileSnapshot)
    || !sameList(job.requiredCommands, requiredCommands)
    || !sameList(job.permittedPaths, ticket.permittedPaths)
    || !sameGeneratedTests(job.generatedTests, generatedTests)
    || !sameList(job.capabilities, context.allowedCapabilities)
    || Date.parse(job.expiresAt) !== Date.parse(context.expiresAt)
  ) throw new Error("Queued executor payload no longer matches the approval-bound run");
}

export async function POST(request: NextRequest) {
  const secret = process.env.AGENT_EXECUTOR_SHARED_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Tenki executor is not configured" }, { status: 503, headers: noStoreHeaders });
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > 1_000_000) return NextResponse.json({ error: "Executor job is too large" }, { status: 413, headers: noStoreHeaders });
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > 1_000_000)
    return NextResponse.json({ error: "Executor job is too large" }, { status: 413, headers: noStoreHeaders });
  const signature = request.headers.get("x-closespan-signature") ?? "";
  if (!validSignature(body, signature, secret))
    return NextResponse.json({ error: "Invalid executor signature" }, { status: 401, headers: noStoreHeaders });

  let job: TenkiAgentJob;
  try {
    job = tenkiAgentJobSchema.parse(JSON.parse(body));
  } catch {
    return NextResponse.json({ error: "Invalid executor job" }, { status: 400, headers: noStoreHeaders });
  }

  let claimed = false;
  try {
    const context = await getAgentRunExecutionContext(job.orgId, job.runId);
    assertCurrentApproval(job, context);
    const claim = await claimQueuedAgentRun(job.orgId, job.runId);
    if (claim === "active")
      return NextResponse.json({ error: "Executor run is still active" }, { status: 503, headers: noStoreHeaders });
    if (claim === "terminal")
      return NextResponse.json({ ok: true, duplicate: true }, { headers: noStoreHeaders });
    claimed = true;
    let runtimeEnvironment:
      | Awaited<ReturnType<typeof resolveRuntimeSecretBindings>>
      | undefined;
    let trustedBootSource: TrustedTenkiBootSource | undefined;
    if (job.schemaVersion === 2) {
      const profile = sanitizeExecutionProfileConfig(
        job.executionProfileSnapshot.config,
      );
      const managedEnvironment = await assertManagedTenkiBootSourceAllowed({
        orgId: job.orgId,
        repository: job.repository,
        workspaceRoot: job.executionProfileSnapshot.workspaceRoot,
        config: profile,
        permitDeprecated: true,
      });
      if (managedEnvironment) {
        await markManagedTenkiEnvironmentUsed({
          artifactId: managedEnvironment.id,
          orgId: job.orgId,
          runId: job.runId,
        });
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
      if (profile.schemaVersion === 2) {
        runtimeEnvironment = await resolveRuntimeSecretBindings({
          orgId: job.orgId,
          repository: job.repository,
          workspaceRoot: job.executionProfileSnapshot.workspaceRoot,
          bindings: profile.secretBindings,
        });
      }
    }
    const report = await executeTenkiCodingJob(job, {
      started: (sessionId) => callback(job, { event: "started", sandboxId: sessionId, provider: "Tenki Sandbox" }, secret),
    }, {
      ...(runtimeEnvironment ? { runtimeEnvironment } : {}),
      ...(trustedBootSource ? { trustedBootSource } : {}),
    });
    await callback(job, { event: "completed", report }, secret);
    return NextResponse.json({ ok: true, runId: job.runId }, { headers: noStoreHeaders });
  } catch (error) {
    if (!claimed) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Tenki executor rejected the job" },
        { status: 409, headers: noStoreHeaders },
      );
    }
    try {
      await callback(job, {
        event: "failed",
        code: "tenki_executor_failed",
        message: error instanceof Error ? error.message : "Tenki coding execution failed",
      }, secret);
      return NextResponse.json({ ok: false, reported: true }, { headers: noStoreHeaders });
    } catch {
      return NextResponse.json({ error: "Tenki execution failed and CloseSpan could not record the failure" }, { status: 503, headers: noStoreHeaders });
    }
  }
}
