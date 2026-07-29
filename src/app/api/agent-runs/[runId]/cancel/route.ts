import { NextRequest, NextResponse } from "next/server";
import { cancelAgentRun } from "@/lib/engineering-workflow-repository";
import { authorizeAdminMutation, errorResponse, noStoreHeaders } from "@/lib/request-security";

export async function POST(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const context = await authorizeAdminMutation(request);
    const { runId } = await params;
    return NextResponse.json({ workflow: await cancelAgentRun(context.orgId, runId, context) }, { headers: noStoreHeaders });
  } catch (error) { return errorResponse(error); }
}
