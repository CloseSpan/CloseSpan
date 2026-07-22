import { NextRequest, NextResponse } from "next/server";
import {
  buildWebhookUrl,
  ingestWebhookFeedback,
  loadWebhookPublicId,
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
    const [secret, publicId] = await Promise.all([
      loadWebhookSecret(context.orgId, integrationId),
      loadWebhookPublicId(context.orgId, integrationId),
    ]);
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
        quote: "Test feedback event from the Closespan setup hub.",
        type: "Bug",
        severity: "Medium",
        environment: "setup-hub",
      },
    );
    return NextResponse.json(
      {
        ...result,
        ...(publicId ? { webhookUrl: buildWebhookUrl(publicId) } : {}),
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
