import { NextRequest, NextResponse } from "next/server";
import { rejectFinalExecution } from "@/lib/final-execution-repository";
import {
  authorizeAdminMutation,
  errorResponse,
  noStoreHeaders,
} from "@/lib/request-security";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ approvalId: string }> },
) {
  try {
    const context = await authorizeAdminMutation(request);
    const { approvalId } = await params;
    const approval = await rejectFinalExecution(
      context.orgId,
      approvalId,
      context,
    );
    return NextResponse.json({ approval }, { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
