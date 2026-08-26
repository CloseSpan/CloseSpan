import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  askMitosisMemory,
  MitosisConfigurationError,
  MitosisRequestError,
} from "@/lib/mitosis-memory";
import {
  authorizeAdminMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

export const runtime = "nodejs";

const schema = z.object({
  question: z.string().trim().min(3).max(2_000),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 8_000)
      throw new HttpError(413, "The memory question is too large.");
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      throw new HttpError(400, "Enter a question between 3 and 2,000 characters.");
    return NextResponse.json(
      await askMitosisMemory({
        orgId: context.orgId,
        question: parsed.data.question,
        limit: 5,
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
