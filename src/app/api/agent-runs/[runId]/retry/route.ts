import { NextRequest, NextResponse } from "next/server";
import {
  approveImplementationRun,
  failAgentRun,
  getAgentRunExecutionContext,
  prepareImplementationRunRetry,
  rejectImplementationApproval,
} from "@/lib/engineering-workflow-repository";
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
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const context = await authorizeAdminMutation(request);
    const { runId } = await params;
    if (process.env.APP_MODE === "production") assertAgentExecutorConfigured();

    const prepared = await prepareImplementationRunRetry(
      context.orgId,
      runId,
      context,
    );
    if (!prepared.approval || prepared.approval.status !== "Pending") {
      throw new Error("CloseSpan could not create a fresh one-run authorization");
    }
    const approval = prepared.approval;

    const workflow = await approveImplementationRun(
      context.orgId,
      approval.id,
      context,
    ).catch(async (error) => {
      await rejectImplementationApproval(
        context.orgId,
        approval.id,
        context,
      ).catch(() => undefined);
      throw error;
    });
    if (workflow.run) {
      const execution = await getAgentRunExecutionContext(
        context.orgId,
        workflow.run.id,
      );
      try {
        await dispatchAgentRun(execution);
      } catch (dispatchError) {
        const failureMessage = dispatchError instanceof Error
          ? dispatchError.message
          : "Executor dispatch failed";
        const failureCode = agentRunDispatchFailureCode(
          failureMessage,
          "dispatch_failed",
        );
        await failAgentRun(execution, failureCode, failureMessage);
        return NextResponse.json(
          {
            workflow: {
              ...workflow,
              run: {
                ...workflow.run,
                status: "Failed" as const,
                failureCode,
                failureMessage,
              },
            },
            warning: "The retry was authorized, but the isolated executor could not start.",
          },
          { headers: noStoreHeaders },
        );
      }
    }
    return NextResponse.json({ workflow }, { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
