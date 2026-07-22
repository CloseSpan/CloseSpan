import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  pullAllPipedreamFeedback,
  pullPipedreamFeedback,
} from "@/lib/pipedream-feedback-import";
import { PIPEDREAM_CONNECTOR_IDS } from "@/lib/pipedream-connectors";
import {
  authorizeAdminMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.union([
  z.object({ integrationId: z.enum(PIPEDREAM_CONNECTOR_IDS), accountId: z.string().min(3).max(256) }).strict(),
  z.object({}).strict(),
]);

function safeError(error: unknown): HttpError {
  const code = error instanceof Error ? error.message : "";
  if (code === "connection_not_available") return new HttpError(404, "This connected account is no longer available.");
  if (code === "manual_import_not_supported") return new HttpError(409, "Manual pull is not available for this source yet.");
  if (code === "import_in_progress") return new HttpError(409, "A feedback pull is already running for this account.");
  return new HttpError(502, "Feedback could not be pulled right now. Retry shortly or reconnect the account.");
}

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Select a connected account to pull feedback.");
    if ("integrationId" in parsed.data) {
      const result = await pullPipedreamFeedback({
        orgId: context.orgId,
        integrationId: parsed.data.integrationId,
        accountId: parsed.data.accountId,
      });
      return NextResponse.json({ results: [result], failed: 0, unsupported: 0 }, { headers: noStoreHeaders });
    }
    const result = await pullAllPipedreamFeedback(context.orgId);
    if (result.results.length === 0 && result.failed === 0) {
      throw new HttpError(409, "Connect Zendesk to pull feedback. Other source importers are being added next.");
    }
    return NextResponse.json(result, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error);
    console.error("[pipedream:manual-pull]", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(safeError(error));
  }
}
