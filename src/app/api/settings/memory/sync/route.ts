import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  MitosisConfigurationError,
  MitosisRequestError,
  syncSanitizedFeedbackToMitosis,
} from "@/lib/mitosis-memory";
import {
  authorizeAdminMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";
import { getWorkspaceData } from "@/lib/workspace-repository";

export const runtime = "nodejs";

const schema = z.object({
  feedbackIds: z.array(z.string().min(1).max(128)).min(1).max(25).optional(),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 16_000)
      throw new HttpError(413, "The memory sync request is too large.");
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success)
      throw new HttpError(400, "Select between 1 and 25 valid feedback records.");

    const workspace = await getWorkspaceData(context.orgId);
    const selected = parsed.data.feedbackIds
      ? workspace.feedback.filter((item) => parsed.data.feedbackIds!.includes(item.id))
      : workspace.feedback.filter((item) => item.redacted).slice(0, 10);
    if (parsed.data.feedbackIds && selected.length !== new Set(parsed.data.feedbackIds).size)
      throw new HttpError(404, "One or more feedback records were not found in this workspace.");

    return NextResponse.json(
      await syncSanitizedFeedbackToMitosis({
        orgId: context.orgId,
        feedback: selected,
      }),
      { headers: noStoreHeaders },
    );
  } catch (error) {
    if (error instanceof MitosisConfigurationError)
      return errorResponse(new HttpError(503, error.message));
    if (error instanceof MitosisRequestError)
      return errorResponse(new HttpError(502, error.message));
    return errorResponse(error);
  }
}
