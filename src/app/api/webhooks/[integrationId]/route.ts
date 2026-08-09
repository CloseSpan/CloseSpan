import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  ingestWebhookFeedback,
  loadWebhookSecret,
  resolveWebhookIntegration,
  verifyWebhookSignature,
} from "@/lib/integration-repository";
import { HttpError, noStoreHeaders } from "@/lib/request-security";

const maximumCustomerSinceYear = new Date().getUTCFullYear() + 1;
const deliveryHeaderNames = [
  "x-closespan-delivery-id",
  "x-feelow-delivery-id",
] as const;

function resolveDeliveryId(request: NextRequest, payloadId?: string): string {
  for (const headerName of deliveryHeaderNames) {
    const headerValue = request.headers.get(headerName);
    if (headerValue === null || headerValue.trim().length === 0) continue;

    const normalized = headerValue.trim();
    if (normalized.length > 256 || !/^[\x21-\x7e]+$/.test(normalized)) {
      throw new HttpError(
        400,
        `${headerName} must be a visible ASCII identifier no longer than 256 characters`,
      );
    }
    return normalized;
  }

  if (payloadId) return payloadId;
  throw new HttpError(
    400,
    "A stable delivery header or webhook payload id is required",
  );
}

const payloadSchema = z
  .object({
    id: z.string().trim().min(1).max(128).optional(),
    customerId: z.string().trim().min(1).max(512).optional(),
    customer: z.string().trim().max(160).optional(),
    customerDomain: z.string().trim().min(1).max(255).optional(),
    customerSince: z
      .number()
      .int()
      .min(1900)
      .max(maximumCustomerSinceYear)
      .optional(),
    churnRisk: z
      .enum(["Unknown", "Low", "Medium", "Elevated", "High"])
      .optional(),
    sourceUpdatedAt: z
      .string()
      .trim()
      .datetime({ offset: true })
      .optional(),
    quote: z.string().trim().min(1).max(4000),
    type: z.string().trim().max(64).optional(),
    severity: z.string().trim().max(32).optional(),
    environment: z.string().trim().max(256).optional(),
    accountTier: z.string().trim().max(32).optional(),
    arr: z.number().int().min(0).max(1_000_000_000).optional(),
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.customerId && !payload.customer) {
      context.addIssue({
        code: "custom",
        path: ["customer"],
        message: "customer is required when customerId is provided",
      });
    }
    if (payload.customerId && !payload.sourceUpdatedAt) {
      context.addIssue({
        code: "custom",
        path: ["sourceUpdatedAt"],
        message: "sourceUpdatedAt is required when customerId is provided",
      });
    }
    if (
      !payload.customerId &&
      (payload.customerDomain !== undefined ||
        payload.customerSince !== undefined ||
        payload.churnRisk !== undefined ||
        payload.sourceUpdatedAt !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["customerId"],
        message: "customerId is required for customer account metadata",
      });
    }
  });

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ integrationId: string }> },
) {
  try {
    const { integrationId: endpointId } = await context.params;
    const integration = await resolveWebhookIntegration(endpointId);
    if (!integration) throw new HttpError(404, "Webhook integration not found");

    const secret = await loadWebhookSecret(
      integration.orgId,
      integration.integrationId,
    );
    if (!secret) throw new HttpError(503, "Webhook signing secret is unavailable");

    const body = await request.text();
    const signature =
      request.headers.get("x-closespan-signature") ||
      request.headers.get("x-feelow-signature") ||
      request.headers.get("x-webhook-signature");
    if (!verifyWebhookSignature(secret, body, signature)) {
      throw new HttpError(401, "Invalid webhook signature");
    }

    const parsed = payloadSchema.safeParse(JSON.parse(body));
    if (!parsed.success) {
      throw new HttpError(
        400,
        parsed.error.issues[0]?.message ?? "Invalid webhook payload",
      );
    }
    const deliveryId = resolveDeliveryId(request, parsed.data.id);

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
