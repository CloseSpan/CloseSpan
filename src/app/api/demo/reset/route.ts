import { NextRequest, NextResponse } from "next/server";
import { resetWorkspaceDemoWorkflow } from "@/lib/demo-guide-repository";
import {
  authorizeAdminMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const workflow = await resetWorkspaceDemoWorkflow(context.orgId);
    return NextResponse.json(
      { reset: true, ...workflow },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error);
    const message = error instanceof Error ? error.message : "";
    if (
      message === "Guided demo is not enabled" ||
      message === "Guided demo workflow is incomplete"
    ) return errorResponse(new HttpError(404, "Guided demo is unavailable."));
    console.error("[demo:reset]", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(
      new HttpError(503, "The guided demo could not be reset right now."),
    );
  }
}
