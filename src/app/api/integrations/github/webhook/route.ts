import { after, NextRequest, NextResponse } from "next/server";
import { dispatchAgentRun, agentRunDispatchFailureCode } from "@/lib/agent-executor-client";
import {
  failAgentRun,
  getAgentRunExecutionContext,
} from "@/lib/engineering-workflow-repository";
import { processGithubWebhook } from "@/lib/github-webhook-repository";
import {
  GITHUB_WEBHOOK_MAX_BYTES,
  requireGithubDeliveryId,
  requireGithubEvent,
  verifyGithubWebhookSignature,
} from "@/lib/github-webhook-security";
import { HttpError, noStoreHeaders } from "@/lib/request-security";

export const runtime = "nodejs";

const responseHeaders = {
  ...noStoreHeaders,
  "X-Content-Type-Options": "nosniff",
};

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
    if (contentType !== "application/json") throw new HttpError(415, "JSON is required");
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > GITHUB_WEBHOOK_MAX_BYTES)
      throw new HttpError(413, "GitHub webhook payload is too large");

    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > GITHUB_WEBHOOK_MAX_BYTES)
      throw new HttpError(413, "GitHub webhook payload is too large");
    if (!verifyGithubWebhookSignature(rawBody, request.headers.get("x-hub-signature-256")))
      throw new HttpError(401, "Invalid GitHub webhook signature");

    const deliveryId = requireGithubDeliveryId(request.headers.get("x-github-delivery"));
    const event = requireGithubEvent(request.headers.get("x-github-event"));
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new HttpError(400, "GitHub webhook body must be an object");

    const result = await processGithubWebhook({
      deliveryId,
      event,
      rawBody,
      payload: parsed,
    });
    if (result.queuedAgentRuns?.length) {
      after(async () => {
        await Promise.all(result.queuedAgentRuns!.map(async ({ orgId, runId }) => {
          const context = await getAgentRunExecutionContext(orgId, runId);
          try {
            await dispatchAgentRun(context);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Tenki review correction dispatch failed";
            await failAgentRun(
              context,
              agentRunDispatchFailureCode(message, "autonomy_dispatch_failed"),
              message,
            );
          }
        }));
      });
    }
    return NextResponse.json(result, { status: 202, headers: responseHeaders });
  } catch (error) {
    if (error instanceof SyntaxError)
      return Response.json({ error: "GitHub webhook body must be valid JSON" }, { status: 400, headers: responseHeaders });
    if (error instanceof HttpError)
      return Response.json({ error: error.message }, { status: error.status, headers: responseHeaders });
    console.error("GitHub webhook processing failed", error);
    return Response.json({ error: "GitHub webhook processing failed" }, { status: 500, headers: responseHeaders });
  }
}
