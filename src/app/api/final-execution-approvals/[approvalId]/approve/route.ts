import { NextRequest, NextResponse } from "next/server";
import { approveFinalExecution } from "@/lib/final-execution-repository";
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
    const approval = await approveFinalExecution(
      context.orgId,
      approvalId,
      context,
    );
    return NextResponse.json({ approval }, { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
