import { NextRequest, NextResponse } from "next/server";
import {
  dispatchIssueRuntimeVerification,
  runtimeVerifierWorkflowHash,
} from "@/lib/issue-runtime-verification-executor";
import {
  failIssueRuntimeVerification,
  latestIssueRuntimeVerification,
  startIssueRuntimeVerification,
} from "@/lib/issue-runtime-verification";
import {
  authorizeMutation,
  authorizeRead,
  errorResponse,
  noStoreHeaders,
} from "@/lib/request-security";

export const maxDuration = 60;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ problemId: string }> },
) {
  try {
    const [context, { problemId }] = await Promise.all([
      authorizeRead(request),
      params,
    ]);
    return NextResponse.json(
      { run: await latestIssueRuntimeVerification(context.orgId, problemId) },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ problemId: string }> },
) {
  try {
    const [context, { problemId }, workflowHash] = await Promise.all([
      authorizeMutation(request),
      params,
      runtimeVerifierWorkflowHash(),
    ]);
    const origin = process.env.CLOSESPAN_INTERNAL_BASE_URL?.trim().replace(/\/$/, "");
    if (!origin) throw new Error("CLOSESPAN_INTERNAL_BASE_URL is required for runtime verification");
    const run = await startIssueRuntimeVerification({
      orgId: context.orgId,
      problemId,
      workflowHash,
      actor: {
        actorId: context.actorId,
        actorName: context.actorName,
        traceId: context.traceId,
      },
    });
    try {
      await dispatchIssueRuntimeVerification(run, origin);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Runtime verification dispatch failed";
      await failIssueRuntimeVerification(context.orgId, run.runId, message);
      throw error;
    }
    return NextResponse.json(
      { run: await latestIssueRuntimeVerification(context.orgId, problemId) },
      { status: 202, headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
