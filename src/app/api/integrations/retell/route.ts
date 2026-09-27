import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminMutation, authorizeRead, errorResponse, HttpError, noStoreHeaders } from "@/lib/request-security";
import { connectRetell, disconnectRetell, retellStatus } from "@/lib/retell-repository";
import { listRetellCalls, readLimitedText } from "@/lib/retell-api";
import { readPresentationDemo } from "@/lib/presentation-demo";
import { credentialVaultConfigured } from "@/lib/credential-crypto";
import { workspacePersistenceMode } from "@/lib/workspace-persistence";

export const runtime = "nodejs";
const keySchema = z.object({ apiKey: z.string().trim().min(8).max(512).regex(/^[\x21-\x7e]+$/) }).strict();
function failure(error: unknown) { return errorResponse(error instanceof HttpError ? error : new HttpError(503, "Retell setup is temporarily unavailable. Try again shortly.")); }

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeRead(request);
    return NextResponse.json({ ...await retellStatus(context.orgId), canManage: context.role === "Admin" && !await readPresentationDemo(context.orgId) }, { headers: noStoreHeaders });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    if (!credentialVaultConfigured() || workspacePersistenceMode(context.orgId) !== "postgres") throw new HttpError(503, "Secure credential storage is not configured for this workspace.");
    const raw = await readLimitedText(request, 2_048);
    const parsed = keySchema.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new HttpError(400, "Enter a valid Retell API key.");
    // Validate the credential without importing a call or changing anything in Retell.
    await listRetellCalls(parsed.data.apiKey, 1);
    return NextResponse.json({ ...await connectRetell(context.orgId, context.actorId, parsed.data.apiKey), canManage: true }, { headers: noStoreHeaders });
  } catch (error) { return failure(error instanceof SyntaxError ? new HttpError(400, "Enter a valid Retell connection.") : error); }
}

export async function DELETE(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    await disconnectRetell(context.orgId, context.actorId);
    return NextResponse.json({ ...await retellStatus(context.orgId), canManage: true }, { headers: noStoreHeaders });
  } catch (error) { return failure(error); }
}
