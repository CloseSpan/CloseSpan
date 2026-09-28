import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeMutation, authorizeRead, errorResponse, HttpError, noStoreHeaders } from "@/lib/request-security";
import { endIssueVoice, issueVoiceAvailability, startIssueVoice } from "@/lib/issue-voice-repository";

export const runtime = "nodejs";
export const maxDuration = 60;
type RouteContext = { params: Promise<{ problemId: string }> };
function fail(error: unknown) { return errorResponse(error instanceof HttpError ? error : new HttpError(503, "Voice is temporarily unavailable. You can continue in text.")); }

async function voiceRequestBody(request: NextRequest) {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 4000) throw new HttpError(413, "The voice request is too large.");
  try { return JSON.parse(text); } catch { throw new HttpError(400, "The voice request is invalid."); }
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const context = await authorizeRead(request);
    return NextResponse.json(await issueVoiceAvailability(context, (await params).problemId), { headers: noStoreHeaders });
  } catch (error) { return fail(error); }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const context = await authorizeMutation(request);
    const parsed = z.object({ consent: z.literal(true) }).strict().safeParse(await voiceRequestBody(request));
    if (!parsed.success) throw new HttpError(400, "Confirm that you want to start a voice conversation.");
    return NextResponse.json(await startIssueVoice(context, (await params).problemId), { status: 201, headers: noStoreHeaders });
  } catch (error) { return fail(error); }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const context = await authorizeMutation(request);
    const parsed = z.object({ ticket: z.string().min(1).max(2000) }).strict().safeParse(await voiceRequestBody(request));
    if (!parsed.success) throw new HttpError(400, "The voice session is invalid.");
    await endIssueVoice(context, (await params).problemId, parsed.data.ticket);
    return NextResponse.json({ ended: true }, { headers: noStoreHeaders });
  } catch (error) { return fail(error); }
}
