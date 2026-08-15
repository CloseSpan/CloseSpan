import { NextRequest, NextResponse } from "next/server";
import { deleteAgentRun } from "@/lib/engineering-workflow-repository";
import {
  authorizeAdminMutation,
  errorResponse,
  noStoreHeaders,
} from "@/lib/request-security";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const context = await authorizeAdminMutation(request);
    const { runId } = await params;
    await deleteAgentRun(context.orgId, runId, context);
    return NextResponse.json(
      { deleted: true, runId },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
