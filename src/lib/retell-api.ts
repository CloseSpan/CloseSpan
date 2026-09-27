import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { HttpError } from "./request-security";
import { redactUntrustedText } from "./redaction";

export const retellCallIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const retellCallSchema = z.object({
  call_id: retellCallIdSchema,
  call_status: z.string().max(64),
  start_timestamp: z.number().int().nonnegative().max(8_640_000_000_000_000).optional(),
  end_timestamp: z.number().int().nonnegative().max(8_640_000_000_000_000).optional(),
  transcript: z.string().max(1_000_000).nullish(),
  call_analysis: z.object({
    call_summary: z.string().max(100_000).nullish(),
    user_sentiment: z.string().max(64).nullish(),
  }).nullish(),
});
export type RetellCall = z.infer<typeof retellCallSchema>;

export function verifyRetellSignature(rawBody: string, apiKey: string, signature: string | null, now = Date.now()): boolean {
  const parts = /^v=(\d{13}),d=([a-f\d]{64})$/i.exec(signature ?? "");
  if (!parts || Math.abs(now - Number(parts[1])) > 300_000) return false;
  const expected = createHmac("sha256", apiKey).update(rawBody + parts[1]).digest();
  return timingSafeEqual(expected, Buffer.from(parts[2], "hex"));
}

/** Only text useful for feedback is retained; no phone numbers, recordings, or arbitrary metadata. */
export function retellFeedback(call: RetellCall): { quote: string; observedAt: string } | null {
  if (call.call_status !== "ended" || !call.call_analysis) return null;
  const transcript = call.transcript?.trim() ?? "";
  const summary = call.call_analysis.call_summary?.trim() ?? "";
  if (!transcript && !summary) return null;
  const summaryExcerpt = summary.slice(0, 2_000);
  // Bound before regex redaction: huge unbroken strings can make pattern scanning quadratic.
  const transcriptExcerpt = transcript.slice(0, 5_900);
  const quote = redactUntrustedText([
    summaryExcerpt && `Call summary (Retell): ${summaryExcerpt}`,
    transcript && `${transcript.length > transcriptExcerpt.length ? "Transcript excerpt" : "Transcript"}:\n${transcriptExcerpt}`,
  ].filter(Boolean).join("\n\n"));
  return { quote, observedAt: new Date(call.end_timestamp ?? call.start_timestamp ?? Date.now()).toISOString() };
}

export async function readLimitedText(response: { body: ReadableStream<Uint8Array> | null }, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, "The Retell payload is too large.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

async function retellRequest(apiKey: string, path: string, body?: unknown): Promise<unknown> {
  try {
    const response = await fetch(`https://api.retellai.com${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 401 || response.status === 403) throw new HttpError(422, "Retell rejected this API key. Check its call-reading permissions.");
    if (response.status === 429) throw new HttpError(429, "Retell is rate limiting requests. Try again shortly.");
    if (!response.ok) throw new HttpError(502, "Retell could not return call data. Try again shortly.");
    return JSON.parse(await readLimitedText(response, 8_000_000));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    // Never pass through provider responses, headers, or credential-bearing errors.
    throw new HttpError(502, "Retell could not be reached. Try again shortly.");
  }
}

export async function listRetellCalls(apiKey: string, limit = 25): Promise<RetellCall[]> {
  const payload = await retellRequest(apiKey, "/v3/list-calls", { limit: Math.min(Math.max(limit, 1), 25), sort_order: "descending" });
  const parsed = z.object({ items: z.array(retellCallSchema).max(25) }).safeParse(payload);
  if (!parsed.success) throw new HttpError(502, "Retell returned an unsupported call response.");
  return parsed.data.items;
}

export async function getRetellCall(apiKey: string, callId: string): Promise<RetellCall> {
  if (!retellCallIdSchema.safeParse(callId).success) throw new HttpError(400, "Enter a valid Retell call ID.");
  const parsed = retellCallSchema.safeParse(await retellRequest(apiKey, `/v2/get-call/${encodeURIComponent(callId)}`));
  if (!parsed.success || parsed.data.call_id !== callId) throw new HttpError(502, "Retell returned an unexpected call.");
  return parsed.data;
}
