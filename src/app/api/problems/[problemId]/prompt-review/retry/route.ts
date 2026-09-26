import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { retryProblemPromptReview } from "@/lib/problem-prompt-review-repository";
import { authorizeAdminMutation, errorResponse, HttpError, noStoreHeaders } from "@/lib/request-security";

export async function POST(request: NextRequest, { params }: { params: Promise<{ problemId: string }> }) {
  try {
    const context = await authorizeAdminMutation(request);
    const { problemId } = await params;
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 256) throw new HttpError(413, "Invalid retry request.");
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new HttpError(400, "Invalid retry request."); }
    const parsed = z.object({ version: z.number().int().positive() }).strict().safeParse(body);
    if (!parsed.success) throw new HttpError(400, "Invalid review version.");
    await retryProblemPromptReview(context, problemId, parsed.data.version);
    return NextResponse.json({ queued: true }, { status: 202, headers: noStoreHeaders });
  } catch (error) { return errorResponse(error); }
}
