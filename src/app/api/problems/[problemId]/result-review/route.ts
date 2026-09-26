import { NextRequest, NextResponse } from "next/server";
import { recordIssueResultReview } from "@/lib/issue-result-review-repository";
import { authorizeMutation, errorResponse, HttpError, noStoreHeaders } from "@/lib/request-security";

export async function POST(request: NextRequest, { params }: { params: Promise<{ problemId: string }> }) {
  try {
    const context = await authorizeMutation(request);
    const { problemId } = await params;
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 24_000) throw new HttpError(413, "Result feedback is too large.");
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new HttpError(400, "Invalid result feedback."); }
    const review = await recordIssueResultReview(context, problemId, body);
    return NextResponse.json({ review }, { headers: noStoreHeaders });
  } catch (error) { return errorResponse(error); }
}
