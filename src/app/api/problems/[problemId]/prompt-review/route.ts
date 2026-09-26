import { NextRequest, NextResponse } from "next/server";
import { recordProblemReviewDecision } from "@/lib/problem-prompt-review-repository";
import { authorizeMutation, errorResponse, HttpError, noStoreHeaders } from "@/lib/request-security";

export async function POST(request: NextRequest, { params }: { params: Promise<{ problemId: string }> }) {
  try {
    const context = await authorizeMutation(request);
    const { problemId } = await params;
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 8192) throw new HttpError(413, "Review message is too large.");
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new HttpError(400, "Invalid review message."); }
    const review = await recordProblemReviewDecision(context, problemId, body);
    return NextResponse.json({ review }, { headers: noStoreHeaders });
  } catch (error) { return errorResponse(error); }
}
