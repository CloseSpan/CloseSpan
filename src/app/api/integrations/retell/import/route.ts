import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminMutation, errorResponse, HttpError, noStoreHeaders } from "@/lib/request-security";
import { listRetellCalls, readLimitedText, retellCallIdSchema } from "@/lib/retell-api";
import { readRetellCall } from "@/lib/retell-mcp";
import { ingestRetellCalls, loadRetellConnection } from "@/lib/retell-repository";
import { analyzeRetellFeedback } from "@/lib/retell-intake";

export const runtime = "nodejs";
export const maxDuration = 300;
const schema = z.object({ callId: retellCallIdSchema.optional() }).strict();

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const parsed = schema.safeParse(JSON.parse(await readLimitedText(request, 2_048)));
    if (!parsed.success) throw new HttpError(400, "Enter a valid Retell call ID, or import recent calls.");
    const connection = await loadRetellConnection({ orgId: context.orgId });
    if (!connection) throw new HttpError(409, "Connect Retell before importing calls.");
    const result = parsed.data.callId ? await readRetellCall(connection.apiKey, parsed.data.callId) : null;
    const calls = result ? [result.call] : await listRetellCalls(connection.apiKey);
    const counts = await ingestRetellCalls(connection, calls);
    after(async () => { await analyzeRetellFeedback(context.orgId); });
    return NextResponse.json({ ...counts, completedAt: new Date().toISOString(), transport: result?.transport ?? "api" }, { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error instanceof HttpError ? error : new HttpError(error instanceof SyntaxError ? 400 : 503, "Calls could not be imported. Check the connection and try again."));
  }
}
