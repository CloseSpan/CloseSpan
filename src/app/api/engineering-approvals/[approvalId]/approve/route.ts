import { NextRequest, NextResponse } from "next/server";
import { approveImplementationRun, failAgentRun, getAgentRunExecutionContext } from "@/lib/engineering-workflow-repository";
import { assertAgentExecutorConfigured, dispatchAgentRun } from "@/lib/agent-executor-client";
import {
  authorizeAdminMutation,
  errorResponse,
  noStoreHeaders,
} from "@/lib/request-security";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ approvalId: string }> },
) {
  try {
    const context = await authorizeAdminMutation(request);
    const { approvalId } = await params;
    if (process.env.APP_MODE === "production") assertAgentExecutorConfigured();
    const workflow = await approveImplementationRun(
      context.orgId,
      approvalId,
      context,
    );
    if (workflow.run) {
      const execution = await getAgentRunExecutionContext(context.orgId, workflow.run.id);
      try {
        await dispatchAgentRun(execution);
      } catch (dispatchError) {
        await failAgentRun(execution, "dispatch_failed", dispatchError instanceof Error ? dispatchError.message : "Executor dispatch failed");
        return NextResponse.json(
          { workflow: { ...workflow, run: { ...workflow.run, status: "Failed", failureCode: "dispatch_failed", failureMessage: dispatchError instanceof Error ? dispatchError.message : "Executor dispatch failed" } }, warning: "Approval was consumed, but the isolated executor could not start." },
          { headers: noStoreHeaders },
        );
      }
    }
    return NextResponse.json(
      { workflow },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
