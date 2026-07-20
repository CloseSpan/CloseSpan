import { NextRequest, NextResponse } from "next/server";
import { createWebhookIntegration } from "@/lib/integration-repository";
import {
  authorizeAdminMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const result = await createWebhookIntegration(
      context.orgId,
      context.actorId,
    );
    return NextResponse.json(result, { headers: noStoreHeaders });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Webhook setup failed";
    if (message.includes("AI_CREDENTIAL_ENCRYPTION_KEY")) {
      return errorResponse(new HttpError(503, message));
    }
    return errorResponse(error);
  }
}
