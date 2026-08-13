import { NextRequest, NextResponse } from "next/server";
import { getAiRuntimeConfiguration } from "@/lib/ai-config";
import { issueAgentRunnerModelToken } from "@/lib/agent-runner-model-token";
import {
  assertGithubActionsRunIdentity,
  verifyGithubActionsOidcToken,
} from "@/lib/github-actions-oidc";
import { TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH } from "@/lib/issue-runtime-verification-executor";
import { getIssueRuntimeVerificationContext } from "@/lib/issue-runtime-verification";
import { noStoreHeaders } from "@/lib/request-security";

export const maxDuration = 30;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!bearer) throw new Error("Runtime verifier model access requires GitHub OIDC authentication");
    const body = await request.json() as { orgId?: unknown };
    if (typeof body.orgId !== "string" || !body.orgId.trim()) {
      throw new Error("Runtime verifier model access is missing the organization ID");
    }
    const [{ runId }, claims] = await Promise.all([
      params,
      verifyGithubActionsOidcToken(bearer),
    ]);
    const context = await getIssueRuntimeVerificationContext(body.orgId.trim(), runId);
    assertGithubActionsRunIdentity({
      claims,
      repository: context.repository,
      runId,
      workflowPath: TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH,
      expectedSha: context.baseSha,
    });
    const configuration = await getAiRuntimeConfiguration(context.orgId);
    if (
      configuration.provider !== "openai"
      || !configuration.configured
      || !configuration.apiKey
    ) {
      throw new Error("Runtime verification requires the workspace OpenAI provider");
    }
    const issued = await issueAgentRunnerModelToken({
      runId,
      orgId: context.orgId,
      repository: context.repository,
      promptHash: context.promptHash,
      executionProfileHash: context.executionProfileHash,
      provider: "openai",
      model: configuration.model,
    });
    const origin = process.env.CLOSESPAN_INTERNAL_BASE_URL?.trim().replace(/\/$/, "");
    if (!origin) throw new Error("CLOSESPAN_INTERNAL_BASE_URL is required for runner model access");
    return NextResponse.json({
      token: issued.token,
      model: configuration.model,
      responsesApiEndpoint: `${origin}/api/internal/issue-runtime-verifications/${runId}/responses`,
      expiresAt: issued.expiresAt,
    }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Runtime verifier model access failed" },
      { status: 409, headers: noStoreHeaders },
    );
  }
}
