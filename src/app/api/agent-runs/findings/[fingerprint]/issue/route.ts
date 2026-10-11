import { NextRequest, NextResponse } from "next/server";
import { createFindingIssue } from "@/lib/agent-run-findings-repository";
import { authorizeAdminMutation, errorResponse, noStoreHeaders } from "@/lib/request-security";

export async function POST(request: NextRequest, { params }: { params: Promise<{ fingerprint: string }> }) {
  try {
    const context = await authorizeAdminMutation(request);
    const { fingerprint } = await params;
    return NextResponse.json(await createFindingIssue(context, fingerprint), { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
