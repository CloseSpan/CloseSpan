import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  ingestWebhookFeedback,
  loadWebhookSecret,
  resolveWebhookIntegration,
  verifyWebhookSignature,
} from "@/lib/integration-repository";
import { HttpError, noStoreHeaders } from "@/lib/request-security";

const payloadSchema = z
  .object({
    id: z.string().trim().min(1).max(128).optional(),
    customer: z.string().trim().max(160).optional(),
    quote: z.string().trim().min(1).max(4000),
    type: z.string().trim().max(64).optional(),
    severity: z.string().trim().max(32).optional(),
    environment: z.string().trim().max(256).optional(),
    accountTier: z.string().trim().max(32).optional(),
    arr: z.number().int().min(0).max(1_000_000_000).optional(),
  })
  .strict();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ integrationId: string }> },
) {
  try {
    const { integrationId } = await context.params;
    const integration = await resolveWebhookIntegration(integrationId);
    if (!integration) throw new HttpError(404, "Webhook integration not found");

    const secret = await loadWebhookSecret(
      integration.orgId,
      integration.integrationId,
    );
    if (!secret) throw new HttpError(503, "Webhook signing secret is unavailable");

    const body = await request.text();
    const signature =
      request.headers.get("x-feelow-signature") ??
      request.headers.get("x-webhook-signature");
    if (!verifyWebhookSignature(secret, body, signature)) {
      throw new HttpError(401, "Invalid webhook signature");
    }

    const deliveryId =
      request.headers.get("x-feelow-delivery-id") ??
      request.headers.get("x-request-id") ??
      `delivery_${Date.now()}`;

    const parsed = payloadSchema.safeParse(JSON.parse(body));
    if (!parsed.success) {
      throw new HttpError(
        400,
        parsed.error.issues[0]?.message ?? "Invalid webhook payload",
      );
    }

    const result = await ingestWebhookFeedback(
      integration.orgId,
      integration.integrationId,
      deliveryId,
      parsed.data,
    );

    return NextResponse.json(result, {
      status: result.created ? 201 : 200,
      headers: noStoreHeaders,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json(
        { error: "Webhook body must be valid JSON" },
        { status: 400, headers: noStoreHeaders },
      );
    }
    if (error instanceof HttpError) {
      return Response.json(
        { error: error.message },
        { status: error.status, headers: noStoreHeaders },
      );
    }
    return Response.json(
      { error: "Webhook ingestion failed" },
      { status: 500, headers: noStoreHeaders },
    );
  }
}
