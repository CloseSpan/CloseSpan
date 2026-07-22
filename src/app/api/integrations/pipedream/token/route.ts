import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureIntegrationCatalog } from "@/lib/integration-repository";
import {
  PIPEDREAM_CONNECTOR_IDS,
  pipedreamAppSlug,
} from "@/lib/pipedream-connectors";
import {
  getPipedreamClient,
  pipedreamExternalUserId,
} from "@/lib/pipedream";
import {
  authorizeAdminMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

export const runtime = "nodejs";
const schema = z.object({
  integrationId: z.enum(PIPEDREAM_CONNECTOR_IDS),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Select a supported connector.");
    await ensureIntegrationCatalog(context.orgId);
    const integrationId = parsed.data.integrationId;
    const app = pipedreamAppSlug(integrationId);
    const base = (process.env.AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin).replace(/\/$/, "");
    const success = new URL("/integrations", base);
    success.searchParams.set("pipedream", "connected");
    success.searchParams.set("integration", integrationId);
    const error = new URL("/integrations", base);
    error.searchParams.set("pipedream", "error");
    error.searchParams.set("integration", integrationId);
    const token = await getPipedreamClient().tokens.create({
      externalUserId: pipedreamExternalUserId(context.orgId),
      expiresIn: 900,
      successRedirectUri: success.toString(),
      errorRedirectUri: error.toString(),
      allowedOrigins: [request.nextUrl.origin],
    });
    const connectUrl = new URL(token.connectLinkUrl);
    connectUrl.searchParams.set("app", app);
    return NextResponse.json(
      { connectUrl: connectUrl.toString(), expiresAt: token.expiresAt },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error);
    console.error("[pipedream:token]", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(new HttpError(503, "This connector is unavailable right now."));
  }
}
