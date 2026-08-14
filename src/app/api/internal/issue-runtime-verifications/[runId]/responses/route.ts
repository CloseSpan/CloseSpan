import { NextRequest, NextResponse } from "next/server";
import { getAiRuntimeConfiguration } from "@/lib/ai-config";
import { verifyAgentRunnerModelToken } from "@/lib/agent-runner-model-token";
import { getIssueRuntimeVerificationContext } from "@/lib/issue-runtime-verification";
import { noStoreHeaders } from "@/lib/request-security";

export const maxDuration = 300;
// Runtime verification can include a bounded simulator transcript and a few
// targeted source excerpts. Keep this below common serverless body limits while
// leaving enough room for a long-running Responses conversation to finish and
// write its attested report.
const MAX_REQUEST_BYTES = 4_000_000;

function outputTokenCeiling(): number {
  const value = Number(process.env.AGENT_RUNNER_MAX_OUTPUT_TOKENS ?? 12_000);
  if (!Number.isSafeInteger(value) || value < 1 || value > 128_000) {
    throw new Error("AGENT_RUNNER_MAX_OUTPUT_TOKENS must be an integer from 1 to 128000");
  }
  return value;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_REQUEST_BYTES) {
    return NextResponse.json(
      { error: "Runtime verifier model request is too large" },
      { status: 413, headers: noStoreHeaders },
    );
  }
  try {
    const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!bearer) throw new Error("Runtime verifier model request requires a scoped token");
    const { runId } = await params;
    const claims = await verifyAgentRunnerModelToken(bearer);
    if (claims.sub !== runId) throw new Error("Runner model token does not match this run");
    const context = await getIssueRuntimeVerificationContext(claims.orgId, runId);
    if (
      context.repository !== claims.repository
      || context.promptHash !== claims.promptHash
      || context.executionProfileHash !== claims.executionProfileHash
    ) {
      throw new Error("Runner model token no longer matches the immutable verification run");
    }
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) {
      return NextResponse.json(
        { error: "Runtime verifier model request is too large" },
        { status: 413, headers: noStoreHeaders },
      );
    }
    const payload = JSON.parse(raw) as Record<string, unknown>;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Runtime verifier model request must be a JSON object");
    }
    const configuration = await getAiRuntimeConfiguration(context.orgId);
    if (
      configuration.provider !== "openai"
      || !configuration.configured
      || !configuration.apiKey
      || configuration.model !== claims.model
    ) {
      throw new Error("The workspace OpenAI configuration changed after runner access was issued");
    }
    const requestedMax = payload.max_output_tokens;
    if (
      requestedMax !== undefined
      && (!Number.isSafeInteger(requestedMax) || (requestedMax as number) < 1)
    ) {
      throw new Error("Runtime verifier max_output_tokens must be a positive integer");
    }
    const outputCeiling = outputTokenCeiling();
    const upstream = await fetch(`${configuration.baseUrl.replace(/\/$/, "")}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${configuration.apiKey}`,
        "content-type": "application/json",
        accept: request.headers.get("accept") ?? "application/json",
        ...(request.headers.get("openai-beta")
          ? { "openai-beta": request.headers.get("openai-beta")! }
          : {}),
      },
      body: JSON.stringify({
        ...payload,
        model: claims.model,
        store: false,
        background: false,
        max_output_tokens: Math.min(
          requestedMax as number | undefined ?? outputCeiling,
          outputCeiling,
        ),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(Math.min(configuration.timeoutMs, 290_000)),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...noStoreHeaders,
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        ...(upstream.headers.get("x-request-id")
          ? { "x-request-id": upstream.headers.get("x-request-id")! }
          : {}),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Runtime verifier model request failed" },
      { status: 409, headers: noStoreHeaders },
    );
  }
}
