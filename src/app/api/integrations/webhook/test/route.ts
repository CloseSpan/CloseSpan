import { NextRequest, NextResponse } from "next/server";
import {
  buildWebhookUrl,
  ingestWebhookFeedback,
  loadWebhookSecret,
} from "@/lib/integration-repository";
import {
  authorizeAdminMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const integrationId = "int_webhook";
    const secret = await loadWebhookSecret(context.orgId, integrationId);
    if (!secret) {
      throw new HttpError(
        409,
        "Create the webhook endpoint before sending a test event.",
      );
    }
    const deliveryId = `setup_test_${Date.now()}`;
    const result = await ingestWebhookFeedback(
      context.orgId,
      integrationId,
      deliveryId,
      {
        id: deliveryId,
        customer: "Test customer",
        quote: "Test feedback event from the Feelow setup hub.",
        type: "Bug",
        severity: "Medium",
        environment: "setup-hub",
      },
    );
    return NextResponse.json(
      {
        ...result,
        webhookUrl: buildWebhookUrl(integrationId),
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
