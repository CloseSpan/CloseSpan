import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ingestRetellCalls, loadRetellConnection } from "@/lib/retell-repository";
import { readLimitedText, retellCallSchema, verifyRetellSignature } from "@/lib/retell-api";
import { analyzeRetellFeedback } from "@/lib/retell-intake";
import { errorResponse, HttpError, noStoreHeaders } from "@/lib/request-security";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest, { params }: { params: Promise<{ endpointId: string }> }) {
  try {
    const { endpointId } = await params;
    if (!/^retell_[a-f0-9]{32}$/.test(endpointId)) throw new HttpError(404, "Retell endpoint not found.");
    const connection = await loadRetellConnection({ publicId: endpointId });
    if (!connection) throw new HttpError(404, "Retell endpoint not found.");
    const body = await readLimitedText(request, 2_000_000);
    if (!verifyRetellSignature(body, connection.apiKey, request.headers.get("x-retell-signature"))) throw new HttpError(401, "Invalid Retell signature.");
    const event = z.object({ event: z.string() }).safeParse(JSON.parse(body));
    if (!event.success) throw new HttpError(400, "Invalid Retell event.");
    if (event.data.event !== "call_analyzed") return NextResponse.json({ ignored: true }, { headers: noStoreHeaders });
    const payload = z.object({ call: retellCallSchema }).safeParse(JSON.parse(body));
    if (!payload.success) throw new HttpError(400, "Invalid Retell call.");
    const counts = await ingestRetellCalls(connection, [payload.data.call]);
    if (counts.imported) after(() => analyzeRetellFeedback(connection.orgId));
    return NextResponse.json(counts, { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error instanceof HttpError ? error : new HttpError(error instanceof SyntaxError ? 400 : 503, "Retell event could not be processed."));
  }
}
