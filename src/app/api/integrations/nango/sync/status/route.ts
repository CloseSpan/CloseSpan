import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { NANGO_CONNECTOR_IDS } from "@/lib/nango-connectors";
import { getNangoConnectionStatus } from "@/lib/nango-repository";
import { getNangoSyncStatus } from "@/lib/nango-sync-repository";
import {
  authorizeRead,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  integrationId: z.enum(NANGO_CONNECTOR_IDS),
});

const FRIENDLY_ERROR =
  "Import status is unavailable right now. Please try again later.";

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeRead(request);
    const parsed = querySchema.safeParse({
      integrationId: request.nextUrl.searchParams.get("integrationId"),
    });
    if (!parsed.success) {
      throw new HttpError(400, "Select a supported connector to continue.");
    }

    const { integrationId } = parsed.data;
    const [connection, sync] = await Promise.all([
      getNangoConnectionStatus(context.orgId, integrationId),
      getNangoSyncStatus(context.orgId, integrationId),
    ]);

    return NextResponse.json(
      {
        integrationId,
        connectionState: connection?.state ?? null,
        sync,
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error);
    console.error("[nango:sync-status]", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(new HttpError(503, FRIENDLY_ERROR));
  }
}
