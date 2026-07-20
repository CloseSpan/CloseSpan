import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureIntegrationCatalog } from "@/lib/integration-repository";
import {
  getNangoClient,
  getNangoEnvironmentName,
  getNangoHost,
  getNangoWebhookSigningKey,
  NangoConfigurationError,
  resolveNangoProviderConfigKey,
} from "@/lib/nango";
import { NANGO_CONNECTOR_IDS } from "@/lib/nango-connectors";
import {
  createNangoConnectionAttempt,
  NangoConnectionInProgressError,
  NANGO_TAGS,
} from "@/lib/nango-repository";
import {
  authorizeAdminMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

export const runtime = "nodejs";

const requestSchema = z
  .object({ integrationId: z.enum(NANGO_CONNECTOR_IDS) })
  .strict();

const FRIENDLY_ERROR =
  "This connector is unavailable right now. Please try again later.";

function safeErrorResponse(error: unknown, traceId?: string): Response {
  if (error instanceof HttpError) return errorResponse(error);
  if (error instanceof NangoConnectionInProgressError)
    return errorResponse(new HttpError(409, error.message));
  console.error("[nango:session]", {
    traceId,
    errorType: error instanceof Error ? error.name : "UnknownError",
  });
  return errorResponse(new HttpError(503, FRIENDLY_ERROR));
}

export async function POST(request: NextRequest) {
  let traceId: string | undefined;
  try {
    const context = await authorizeAdminMutation(request);
    traceId = context.traceId;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new HttpError(400, "Select a supported connector to continue.");
    }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success)
      throw new HttpError(400, "Select a supported connector to continue.");

    const integrationId = parsed.data.integrationId;
    if (!getNangoWebhookSigningKey())
      throw new NangoConfigurationError(
        "Nango webhook verification is not configured.",
      );
    const providerConfigKey = resolveNangoProviderConfigKey(integrationId);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1_000);
    await ensureIntegrationCatalog(context.orgId);
    const attempt = await createNangoConnectionAttempt({
      orgId: context.orgId,
      integrationId,
      providerConfigKey,
      nangoEnvironment: getNangoEnvironmentName(),
      actorId: context.actorId,
      actorName: context.actorName,
      actorEmail: context.actorEmail,
      idempotencyKey: context.idempotencyKey,
      traceId: context.traceId,
      expiresAt,
    });
    const tags = {
      [NANGO_TAGS.attemptId]: attempt.id,
      [NANGO_TAGS.integrationId]: attempt.integrationId,
      [NANGO_TAGS.organizationId]: attempt.orgId,
      [NANGO_TAGS.endUserId]: `${attempt.orgId}:${attempt.actorId}`,
      [NANGO_TAGS.endUserEmail]: attempt.actorEmail,
      [NANGO_TAGS.endUserDisplayName]: attempt.actorName,
    };
    const { data } = await getNangoClient().createConnectSession({
      allowed_integrations: [providerConfigKey],
      end_user: {
        id: `${attempt.orgId}:${attempt.actorId}`,
        email: attempt.actorEmail,
        display_name: attempt.actorName,
      },
      organization: {
        id: context.orgId,
        display_name: context.organizationName,
      },
      tags,
    });

    return NextResponse.json(
      {
        token: data.token,
        expiresAt: data.expires_at,
        apiUrl: getNangoHost() ?? "https://api.nango.dev",
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return safeErrorResponse(error, traceId);
  }
}
