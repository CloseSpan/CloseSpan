import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  CONNECTED_FEEDBACK_SOURCE_IDS,
  listConnectedFeedbackSources,
  pullConnectedFeedbackSources,
} from "@/lib/connected-feedback-pull";
import {
  N8nConfigurationError,
  N8nConnectionError,
} from "@/lib/n8n-client";
import {
  authorizeAdminRead,
  authorizeAdminMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  integrationIds: z.array(z.enum(CONNECTED_FEEDBACK_SOURCE_IDS)).min(1).max(20).optional(),
  accountIds: z.array(z.string().trim().min(1).max(200)).min(1).max(50).optional(),
}).strict();

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeAdminRead(request);
    const sources = await listConnectedFeedbackSources(context.orgId);
    return NextResponse.json({ sources }, { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      throw new HttpError(400, "Pull feedback from the connected workspace sources.");
    const result = await pullConnectedFeedbackSources(
      context,
      parsed.data.integrationIds,
      parsed.data.accountIds,
    );
    if (!result.routed && result.connectedSources === 0)
      throw new HttpError(
        409,
        parsed.data.integrationIds
          ? "The selected feedback source is no longer connected. Refresh and choose another source."
          : "Connect a feedback source before pulling feedback.",
      );
    return NextResponse.json(result, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error);
    if (error instanceof N8nConfigurationError) {
      return errorResponse(new HttpError(409, error.message));
    }
    if (error instanceof N8nConnectionError) {
      return errorResponse(new HttpError(502, error.message));
    }
    console.error("[feedback:connected-pull]", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(
      new HttpError(502, "Connected feedback sources could not be checked right now. Retry shortly."),
    );
  }
}
