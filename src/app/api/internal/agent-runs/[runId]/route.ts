import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { agentImplementationReportSchema, validateAgentImplementationReport } from "@/lib/agent-run-verification";
import {
  completeAgentRun,
  failAgentRun,
  getAgentRunExecutionContext,
  markAgentRunRunning,
} from "@/lib/engineering-workflow-repository";
import { publishAgentRun } from "@/lib/github-agent-publisher";
import { noStoreHeaders } from "@/lib/request-security";

function validSignature(body: string, provided: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest();
  const actual = Buffer.from(provided, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const secret = process.env.AGENT_EXECUTOR_SHARED_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Executor callback is not configured" }, { status: 503, headers: noStoreHeaders });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 6_000_000) return NextResponse.json({ error: "Executor callback is too large" }, { status: 413, headers: noStoreHeaders });
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > 6_000_000) return NextResponse.json({ error: "Executor callback is too large" }, { status: 413, headers: noStoreHeaders });
  const signature = request.headers.get("x-closespan-signature") ?? "";
  if (!/^[a-f0-9]{64}$/.test(signature) || !validSignature(body, signature, secret))
    return NextResponse.json({ error: "Invalid executor signature" }, { status: 401, headers: noStoreHeaders });
  let failureContext: Awaited<ReturnType<typeof getAgentRunExecutionContext>> | null = null;
  try {
    const payload = JSON.parse(body) as { event?: string; orgId?: string; sandboxId?: string; code?: string; message?: string; report?: unknown };
    if (!payload.orgId) throw new Error("Executor callback is missing the organization ID");
    const { runId } = await params;
    const context = await getAgentRunExecutionContext(payload.orgId, runId);
    failureContext = context;
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
    validateAgentImplementationReport(report, {
      runId,
      promptHash: context.promptHash,
      baseSha: context.baseSha,
      promptArtifactPath: context.promptArtifactPath,
      promptSnapshot: context.promptSnapshot,
    });
    if (report.status === "Failed" || report.status === "No changes") {
      await completeAgentRun(context, report);
      return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
    }
    const publication = await publishAgentRun(context, report);
    await completeAgentRun(context, { ...report, status: "Draft PR opened" }, publication);
    return NextResponse.json({ ok: true, pullRequestUrl: publication.pullRequestUrl }, { headers: noStoreHeaders });
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
