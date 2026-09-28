import { NextRequest } from "next/server";
import { z } from "zod";
import { authorizeMutation, errorResponse, HttpError, noStoreHeaders } from "@/lib/request-security";
import { authorizeVoiceSession } from "@/lib/issue-voice-repository";
import { voiceTranscriptStream } from "@/lib/issue-voice-transcript";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest, { params }: { params: Promise<{ problemId: string }> }) {
  try {
    const context = await authorizeMutation(request);
    const text = await request.text();
    if (text.length > 4000) throw new HttpError(413, "The voice request is too large.");
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new HttpError(400, "The voice session is invalid."); }
    const parsed = z.object({ ticket: z.string().min(1).max(2000) }).strict().safeParse(body);
    if (!parsed.success) throw new HttpError(400, "The voice session is invalid.");
    const { ticket, apiKey } = await authorizeVoiceSession(context, (await params).problemId, parsed.data.ticket);
    return new Response(voiceTranscriptStream(ticket.callId, apiKey, request.signal), {
      headers: { ...noStoreHeaders, "Content-Type": "application/x-ndjson", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) { return errorResponse(error instanceof HttpError ? error : new HttpError(503, "Live captions are unavailable. You can continue the conversation.")); }
}
