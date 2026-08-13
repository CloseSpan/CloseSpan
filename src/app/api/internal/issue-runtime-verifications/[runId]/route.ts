import { NextRequest, NextResponse } from "next/server";
import {
  TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH,
  buildIssueRuntimeVerificationJob,
} from "@/lib/issue-runtime-verification-executor";
import {
  completeIssueRuntimeVerification,
  failIssueRuntimeVerification,
  getIssueRuntimeVerificationContext,
  issueRuntimeVerificationReportSchema,
  markIssueRuntimeVerificationRunning,
} from "@/lib/issue-runtime-verification";
import {
  assertGithubActionsRunIdentity,
  verifyGithubActionsOidcToken,
} from "@/lib/github-actions-oidc";
import { noStoreHeaders } from "@/lib/request-security";

export const maxDuration = 60;
const MAX_CALLBACK_BYTES = 2_000_000;

function bearerToken(request: NextRequest): string {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) throw new Error("Runtime verifier requires GitHub OIDC authentication");
  return bearer;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const orgId = request.nextUrl.searchParams.get("orgId")?.trim();
    if (!orgId) throw new Error("Runtime verifier job request is missing the organization ID");
    const [{ runId }, claims] = await Promise.all([
      params,
      verifyGithubActionsOidcToken(bearerToken(request)),
    ]);
    const context = await getIssueRuntimeVerificationContext(orgId, runId);
    assertGithubActionsRunIdentity({
      claims,
      repository: context.repository,
      runId,
      workflowPath: TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH,
      expectedSha: context.baseSha,
    });
    const body = JSON.stringify(buildIssueRuntimeVerificationJob(context));
    if (Buffer.byteLength(body, "utf8") > MAX_CALLBACK_BYTES) {
      return NextResponse.json(
        { error: "Runtime verification job is too large" },
        { status: 413, headers: noStoreHeaders },
      );
    }
    return new NextResponse(body, {
      headers: { ...noStoreHeaders, "content-type": "application/json" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Runtime verifier job request failed" },
      { status: 409, headers: noStoreHeaders },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_CALLBACK_BYTES) {
    return NextResponse.json(
      { error: "Runtime verification callback is too large" },
      { status: 413, headers: noStoreHeaders },
    );
  }
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_CALLBACK_BYTES) {
      return NextResponse.json(
        { error: "Runtime verification callback is too large" },
        { status: 413, headers: noStoreHeaders },
      );
    }
    const payload = JSON.parse(raw) as {
      event?: unknown;
      orgId?: unknown;
      message?: unknown;
      report?: unknown;
    };
    if (typeof payload.orgId !== "string" || !payload.orgId.trim()) {
      throw new Error("Runtime verification callback is missing the organization ID");
    }
    const [{ runId }, claims] = await Promise.all([
      params,
      verifyGithubActionsOidcToken(bearerToken(request)),
    ]);
    const context = await getIssueRuntimeVerificationContext(payload.orgId.trim(), runId);
    assertGithubActionsRunIdentity({
      claims,
      repository: context.repository,
      runId,
      workflowPath: TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH,
      expectedSha: context.baseSha,
    });
    if (payload.event === "started") {
      await markIssueRuntimeVerificationRunning(context.orgId, runId);
      return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
    }
    if (payload.event === "failed") {
      await failIssueRuntimeVerification(
        context.orgId,
        runId,
        typeof payload.message === "string"
          ? payload.message
          : "The Tenki runner did not return runtime evidence.",
      );
      return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
    }
    if (payload.event !== "completed") throw new Error("Unknown runtime verification callback event");
    const report = issueRuntimeVerificationReportSchema.parse(payload.report);
    assertGithubActionsRunIdentity({
      claims,
      repository: context.repository,
      runId,
      workflowPath: TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH,
      reportedWorkflowRunId: report.environment.workflowRunId,
      expectedSha: context.baseSha,
    });
    await completeIssueRuntimeVerification(context, report);
    return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Runtime verification callback failed" },
      { status: 409, headers: noStoreHeaders },
    );
  }
}
