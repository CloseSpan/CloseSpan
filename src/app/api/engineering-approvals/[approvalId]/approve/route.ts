import { NextRequest, NextResponse } from "next/server";
import { approveImplementationRun, failAgentRun, getAgentRunExecutionContext } from "@/lib/engineering-workflow-repository";
import {
  agentRunDispatchFailureCode,
  assertAgentExecutorConfigured,
  dispatchAgentRun,
} from "@/lib/agent-executor-client";
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
        const failureMessage = dispatchError instanceof Error ? dispatchError.message : "Executor dispatch failed";
        const failureCode = agentRunDispatchFailureCode(failureMessage, "dispatch_failed");
        await failAgentRun(execution, failureCode, failureMessage);
        return NextResponse.json(
          { workflow: { ...workflow, run: { ...workflow.run, status: "Failed", failureCode, failureMessage } }, warning: "Approval was consumed, but the isolated executor could not start." },
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
