import { NextRequest, NextResponse } from "next/server";
import {
  failPddVerification,
  getEngineeringWorkflow,
  getPddVerificationExecutionContext,
  markPddVerificationGenerating,
  testUserStoryAgainstPrompt,
} from "@/lib/engineering-workflow-repository";
import {
  assertPddRunnerConfigured,
  dispatchPddVerification,
  pddRunnerConfigured,
} from "@/lib/pdd-runner-client";
import {
  authorizeMutation,
  errorResponse,
  noStoreHeaders,
} from "@/lib/request-security";

const MAX_BODY_BYTES = 8_192;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ problemId: string }> },
) {
  try {
    const context = await authorizeMutation(request);
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "User story is too large" },
        { status: 413, headers: noStoreHeaders },
      );
    }
    const bodyText = await request.text();
    if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "User story is too large" },
        { status: 413, headers: noStoreHeaders },
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return NextResponse.json(
        { error: "User story request is invalid" },
        { status: 400, headers: noStoreHeaders },
      );
    }
    const userStory =
      typeof body === "object" && body !== null && "userStory" in body
        ? (body as { userStory: unknown }).userStory
        : undefined;
    const { problemId } = await params;
    if (process.env.APP_MODE === "production") assertPddRunnerConfigured();
    const result = await testUserStoryAgainstPrompt(
        context.orgId,
        problemId,
        userStory,
        context,
      );
    if (result.storyTest.status === "Queued" && pddRunnerConfigured()) {
      try {
        const execution = await getPddVerificationExecutionContext(context.orgId, result.storyTest.id);
        await markPddVerificationGenerating(context.orgId, result.storyTest.id);
        await dispatchPddVerification(execution);
        result.workflow = await getEngineeringWorkflow(context.orgId, problemId);
        result.storyTest = { ...result.storyTest, status: "Generating tests", message: "PDD is translating the story into repository-native acceptance tests." };
      } catch (dispatchError) {
        const message = dispatchError instanceof Error ? dispatchError.message : "PDD runner dispatch failed";
        await failPddVerification(context.orgId, result.storyTest.id, message);
        result.workflow = await getEngineeringWorkflow(context.orgId, problemId);
        result.storyTest = { ...result.storyTest, status: "Failed", message };
      }
    }
    return NextResponse.json(
      result,
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
