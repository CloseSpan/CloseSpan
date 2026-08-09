import { NextRequest, NextResponse } from "next/server";
import {
  failPddVerification,
  generatePddAcceptanceContract,
  getEngineeringWorkflow,
  getPddVerificationExecutionContext,
  markPddVerificationGenerating,
} from "@/lib/engineering-workflow-repository";
import { assertPromptAlignmentReceipt } from "@/lib/prompt-alignment-receipt";
import { sha256 } from "@/lib/pdd-verification";
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
    if (declaredLength > MAX_BODY_BYTES)
      return NextResponse.json(
        { error: "User story is too large" },
        { status: 413, headers: noStoreHeaders },
      );
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES)
      return NextResponse.json(
        { error: "User story is too large" },
        { status: 413, headers: noStoreHeaders },
      );
    let body: { userStory?: unknown; alignmentReceipt?: unknown };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      return NextResponse.json(
        { error: "Acceptance-test request is invalid" },
        { status: 400, headers: noStoreHeaders },
      );
    }
    const { problemId } = await params;
    if (typeof body.userStory !== "string")
      throw new Error("A valid user story is required");
    const current = await getEngineeringWorkflow(context.orgId, problemId);
    if (!current.prompt)
      throw new Error("A reviewable implementation prompt is required");
    assertPromptAlignmentReceipt(body.alignmentReceipt, {
      orgId: context.orgId,
      problemId,
      promptHash: current.prompt.contentHash,
      storyHash: sha256(body.userStory.replace(/\s+/g, " ").trim()),
    });
    if (process.env.APP_MODE === "production") assertPddRunnerConfigured();
    const result = await generatePddAcceptanceContract(
      context.orgId,
      problemId,
      body.userStory,
      context,
    );
    if (result.storyTest.status === "Queued" && pddRunnerConfigured()) {
      try {
        const execution = await getPddVerificationExecutionContext(
          context.orgId,
          result.storyTest.id,
        );
        await markPddVerificationGenerating(context.orgId, result.storyTest.id);
        await dispatchPddVerification(execution);
        result.workflow = await getEngineeringWorkflow(context.orgId, problemId);
        result.storyTest = {
          ...result.storyTest,
          status: "Generating tests",
          message:
            "PDD is translating the approved story into repository-native acceptance tests.",
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "PDD runner dispatch failed";
        await failPddVerification(context.orgId, result.storyTest.id, message);
        result.workflow = await getEngineeringWorkflow(context.orgId, problemId);
        result.storyTest = { ...result.storyTest, status: "Failed", message };
      }
    }
    return NextResponse.json(result, { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
