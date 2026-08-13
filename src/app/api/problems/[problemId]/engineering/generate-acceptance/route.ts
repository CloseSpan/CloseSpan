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
import { readAutonomyLevel } from "@/lib/workspace-settings-repository";
import {
  clearPddAcceptancePreparationFailure,
  recordPddAcceptancePreparationFailure,
} from "@/lib/pdd-prompt-evaluation-repository";

const MAX_BODY_BYTES = 8_192;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ problemId: string }> },
) {
  let preparationFailureTarget: {
    orgId: string;
    problemId: string;
    evaluationId: string;
    promptRevisionId: string;
  } | null = null;
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
    let body: {
      evaluationId?: unknown;
      userStory?: unknown;
      alignmentReceipt?: unknown;
    };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      return NextResponse.json(
        { error: "Acceptance-test request is invalid" },
        { status: 400, headers: noStoreHeaders },
      );
    }
    const { problemId } = await params;
    if (
      typeof body.evaluationId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.evaluationId)
    ) throw new Error("A valid prompt evaluation is required");
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
    preparationFailureTarget = {
      orgId: context.orgId,
      problemId,
      evaluationId: body.evaluationId,
      promptRevisionId: current.prompt.id,
    };
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
    await clearPddAcceptancePreparationFailure(preparationFailureTarget);
    preparationFailureTarget = null;
    return NextResponse.json(
      { ...result, autonomyLevel: await readAutonomyLevel(context.orgId) },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    if (preparationFailureTarget) {
      await recordPddAcceptancePreparationFailure({
        ...preparationFailureTarget,
        message: error instanceof Error
          ? error.message
          : "Agent approval preparation failed",
      }).catch((persistenceError: unknown) => {
        console.error("[pdd:acceptance-preparation] Failure state could not be saved", {
          errorType: persistenceError instanceof Error
            ? persistenceError.name
            : "UnknownError",
        });
      });
    }
    return errorResponse(error);
  }
}
