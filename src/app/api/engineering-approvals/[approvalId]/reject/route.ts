import { NextRequest, NextResponse } from "next/server";
import { rejectImplementationApproval } from "@/lib/engineering-workflow-repository";
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
    return NextResponse.json(
      {
        workflow: await rejectImplementationApproval(
          context.orgId,
          approvalId,
          context,
        ),
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
