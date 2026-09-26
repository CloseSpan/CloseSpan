import { NextRequest, NextResponse } from "next/server";
import { postIssueConversation, readIssueConversation } from "@/lib/issue-conversation-repository";
import { authorizeMutation, authorizeRead, errorResponse, HttpError, noStoreHeaders } from "@/lib/request-security";

export const maxDuration = 120;

function discussionError(error: unknown): Response {
  return errorResponse(error instanceof HttpError ? error : new HttpError(503, "Issue discussion is temporarily unavailable"));
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ problemId: string }> }) {
  try {
    const context = await authorizeRead(request);
    const { problemId } = await params;
    return NextResponse.json(await readIssueConversation(context.orgId, problemId), { headers: noStoreHeaders });
  } catch (error) { return discussionError(error); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ problemId: string }> }) {
  try {
    const context = await authorizeMutation(request);
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 12_000) throw new HttpError(413, "The discussion message is too large");
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new HttpError(400, "The discussion message is invalid"); }
    const { problemId } = await params;
    const result = await postIssueConversation(context, problemId, body);
    return NextResponse.json(result, { status: result.status === "processing" ? 202 : 200, headers: noStoreHeaders });
  } catch (error) { return discussionError(error); }
}
