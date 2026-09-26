import { NextRequest, NextResponse } from "next/server";
import { authorizeIssueResultRework, failUndispatchedIssueResultRework } from "@/lib/issue-result-review-rework";
import { getAgentRunExecutionContext, failAgentRun } from "@/lib/engineering-workflow-repository";
import { assertAgentExecutorConfigured, dispatchAgentRun, agentRunDispatchFailureCode } from "@/lib/agent-executor-client";
import { authorizeAdminMutation, errorResponse, HttpError, noStoreHeaders } from "@/lib/request-security";

export async function POST(request: NextRequest, { params }: { params: Promise<{ problemId: string }> }) {
  try {
    const context = await authorizeAdminMutation(request);
    const { problemId } = await params;
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 4096) throw new HttpError(413, "Follow-up authorization is too large.");
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new HttpError(400, "Invalid follow-up authorization."); }
    assertAgentExecutorConfigured();
    const result = await authorizeIssueResultRework(context, problemId, body);
    if (!result.replayed) {
      let execution: Awaited<ReturnType<typeof getAgentRunExecutionContext>> | null = null;
      try {
        execution = await getAgentRunExecutionContext(context.orgId, result.runId);
        await dispatchAgentRun(execution);
      }
      catch (error) {
        const message = error instanceof Error ? error.message : "The follow-up executor could not start.";
        if (execution) await failAgentRun(execution, agentRunDispatchFailureCode(message, "dispatch_failed"), message);
        else await failUndispatchedIssueResultRework(context.orgId, problemId, result.runId, message);
        return NextResponse.json({ ...result, warning: "The follow-up was authorized, but the isolated executor could not start." }, { status: 202, headers: noStoreHeaders });
      }
    }
    return NextResponse.json(result, { status: 202, headers: noStoreHeaders });
  } catch (error) { return errorResponse(error); }
}
