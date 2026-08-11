import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  listConnectedFeedbackSources,
  pullConnectedFeedbackSources,
} from "@/lib/connected-feedback-pull";
import { PIPEDREAM_CONNECTOR_IDS } from "@/lib/pipedream-connectors";
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
  integrationIds: z.array(z.enum(PIPEDREAM_CONNECTOR_IDS)).min(1).max(20).optional(),
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
    );
    if (result.connectedSources === 0)
      throw new HttpError(
        409,
        parsed.data.integrationIds
          ? "The selected feedback source is no longer connected. Refresh and choose another source."
          : "Connect a feedback source before pulling feedback.",
      );
    return NextResponse.json(result, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error);
    console.error("[feedback:connected-pull]", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(
      new HttpError(502, "Connected feedback sources could not be checked right now. Retry shortly."),
    );
  }
}
