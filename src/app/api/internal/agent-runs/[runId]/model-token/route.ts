import { NextRequest, NextResponse } from "next/server";
import { getAiRuntimeConfiguration } from "@/lib/ai-config";
import { issueAgentRunnerModelToken } from "@/lib/agent-runner-model-token";
import { getAgentRunExecutionContext } from "@/lib/engineering-workflow-repository";
import {
  executionProfileExecutor,
  sanitizeExecutionProfileConfig,
} from "@/lib/execution-profile";
import {
  assertGithubActionsRunIdentity,
  verifyGithubActionsOidcToken,
} from "@/lib/github-actions-oidc";
import { noStoreHeaders } from "@/lib/request-security";

export const maxDuration = 30;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) {
    return NextResponse.json(
      { error: "Runner model-token exchange requires GitHub OIDC authentication" },
      { status: 401, headers: noStoreHeaders },
    );
  }
  try {
    const body = await request.json() as { orgId?: unknown };
    if (typeof body.orgId !== "string" || !body.orgId.trim()) {
      throw new Error("Runner model-token exchange is missing the organization ID");
    }
    const { runId } = await params;
    const claims = await verifyGithubActionsOidcToken(bearer);
    const context = await getAgentRunExecutionContext(body.orgId.trim(), runId);
    const profile = sanitizeExecutionProfileConfig(context.executionProfileSnapshot.config);
    const executor = executionProfileExecutor(profile);
    if (executor.kind !== "tenki_github_actions") {
      throw new Error("Agent run is not bound to a Tenki GitHub Actions execution profile");
    }
    assertGithubActionsRunIdentity({
      claims,
      repository: context.repository,
      runId,
      workflowPath: executor.workflowPath,
    });
    const configuration = await getAiRuntimeConfiguration(context.orgId);
    if (
      configuration.provider !== "openai"
      || !configuration.configured
      || !configuration.apiKey
    ) {
      throw new Error(
        "Tenki runner coding requires the workspace OpenAI provider or the server OPENAI_API_KEY fallback",
      );
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
      responsesApiEndpoint: `${origin}/api/internal/agent-runs/${runId}/responses`,
      expiresAt: issued.expiresAt,
    }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Runner model-token exchange failed" },
      { status: 409, headers: noStoreHeaders },
    );
  }
}
