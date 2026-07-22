import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPipedreamClient } from "@/lib/pipedream";
import { PIPEDREAM_CONNECTOR_IDS } from "@/lib/pipedream-connectors";
import {
  disconnectPipedreamAccount,
  getPipedreamConnection,
} from "@/lib/pipedream-repository";
import {
  authorizeAdminMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

export const runtime = "nodejs";
const schema = z.object({
  integrationId: z.enum(PIPEDREAM_CONNECTOR_IDS),
  accountId: z.string().trim().min(1).max(255),
}).strict();

function providerAccountIsMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    (error as { statusCode?: unknown }).statusCode === 404
  );
}

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Select a connected account.");
    const binding = await getPipedreamConnection(
      context.orgId,
      parsed.data.integrationId,
      parsed.data.accountId,
    );
    if (!binding) return NextResponse.json({ disconnected: true }, { headers: noStoreHeaders });
    try {
      await getPipedreamClient().accounts.delete(binding.accountId);
    } catch (error) {
      if (!providerAccountIsMissing(error)) throw error;
    }
    await disconnectPipedreamAccount({
      orgId: context.orgId,
      integrationId: parsed.data.integrationId,
      accountId: binding.accountId,
    });
    return NextResponse.json({ disconnected: true }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error);
    console.error("[pipedream:disconnect]", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(new HttpError(503, "This account could not be removed right now."));
  }
}
