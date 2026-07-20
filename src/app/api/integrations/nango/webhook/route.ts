import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getNangoEnvironmentName,
  getNangoWebhookClient,
} from "@/lib/nango";
import {
  markNangoConnectionNeedsReconnect,
  reconcileNangoAuthEvent,
  updateNangoSyncState,
} from "@/lib/nango-repository";
import { scheduleNangoSyncDrain } from "@/lib/nango-sync-scheduler";
import { errorResponse, HttpError, noStoreHeaders } from "@/lib/request-security";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_WEBHOOK_BYTES = 1_000_000;
const FRIENDLY_ERROR =
  "The connector event could not be processed. Please try again later.";

const identifier = z.string().trim().min(1).max(255);
const tagsSchema = z
  .record(z.string().min(1).max(128), z.string().max(512))
  .refine((tags) => Object.keys(tags).length <= 32);
const errorSchema = z
  .object({ type: z.string().trim().min(1).max(160).optional() })
  .passthrough()
  .optional();

const authSchema = z
  .object({
    type: z.literal("auth"),
    operation: z.enum(["creation", "override", "refresh", "unknown"]),
    success: z.boolean(),
    connectionId: identifier,
    providerConfigKey: identifier,
    provider: identifier,
    environment: z
      .string()
      .trim()
      .regex(/^[A-Z0-9][A-Z0-9_-]{0,79}$/),
    tags: tagsSchema.optional(),
    endUser: z
      .object({ tags: tagsSchema.optional() })
      .passthrough()
      .optional(),
    error: errorSchema,
  })
  .passthrough();

const syncSchema = z
  .object({
    type: z.literal("sync"),
    success: z.boolean(),
    connectionId: identifier,
    providerConfigKey: identifier,
    syncName: z.string().trim().min(1).max(255),
    syncVariant: z.string().trim().max(255).default(""),
    model: z.string().trim().min(1).max(255),
    modifiedAfter: z.string().datetime().optional(),
    failedAt: z.string().datetime().optional(),
    error: errorSchema,
  })
  .passthrough();

function webhookErrorResponse(error: unknown): Response {
  console.error("[nango:webhook]", {
    errorType: error instanceof Error ? error.name : "UnknownError",
  });
  return errorResponse(new HttpError(503, FRIENDLY_ERROR));
}

function invalidWebhook(message: string, status = 400): Response {
  return NextResponse.json(
    { error: message },
    { status, headers: noStoreHeaders },
  );
}

export async function POST(request: NextRequest) {
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES)
      return invalidWebhook("Webhook payload is too large", 413);

    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES)
      return invalidWebhook("Webhook payload is too large", 413);

    const headers = Object.fromEntries(request.headers.entries());
    if (!getNangoWebhookClient().verifyIncomingWebhookRequest(rawBody, headers))
      return invalidWebhook("Invalid webhook signature", 401);

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return invalidWebhook("Invalid webhook payload");
    }
    if (!payload || typeof payload !== "object" || !("type" in payload))
      return invalidWebhook("Invalid webhook payload");

    const payloadHash = createHash("sha256").update(rawBody).digest("hex");
    const eventType = (payload as { type?: unknown }).type;
    if (eventType === "auth") {
      const parsed = authSchema.safeParse(payload);
      if (!parsed.success) return invalidWebhook("Invalid auth webhook payload");
      const event = parsed.data;
      if (
        event.success &&
        (event.operation === "creation" || event.operation === "override")
      ) {
        await reconcileNangoAuthEvent({
          payloadHash,
          operation: event.operation,
          providerConfigKey: event.providerConfigKey,
          connectionId: event.connectionId,
          provider: event.provider,
          nangoEnvironment: event.environment,
          tags: event.tags ?? event.endUser?.tags ?? {},
        });
      } else if (!event.success && event.operation === "refresh") {
        await markNangoConnectionNeedsReconnect({
          payloadHash,
          providerConfigKey: event.providerConfigKey,
          connectionId: event.connectionId,
          nangoEnvironment: event.environment,
          errorCode: event.error?.type,
        });
      }
      return new Response(null, { status: 204, headers: noStoreHeaders });
    }

    if (eventType === "sync") {
      const parsed = syncSchema.safeParse(payload);
      if (!parsed.success) return invalidWebhook("Invalid sync webhook payload");
      const event = parsed.data;
      const outcome = await updateNangoSyncState({
        payloadHash,
        providerConfigKey: event.providerConfigKey,
        connectionId: event.connectionId,
        nangoEnvironment: getNangoEnvironmentName(),
        syncName: event.syncName,
        syncVariant: event.syncVariant,
        model: event.model,
        modifiedAfter: event.modifiedAfter,
        success: event.success,
        completedAt: event.failedAt ? new Date(event.failedAt) : new Date(),
        errorCode: event.error?.type,
      });
      if (event.success && outcome === "processed") scheduleNangoSyncDrain();
      return new Response(null, { status: 204, headers: noStoreHeaders });
    }

    return new Response(null, { status: 204, headers: noStoreHeaders });
  } catch (error) {
    return webhookErrorResponse(error);
  }
}
