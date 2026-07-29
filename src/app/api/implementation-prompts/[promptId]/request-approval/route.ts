import { NextRequest, NextResponse } from "next/server";
import { requestImplementationApproval } from "@/lib/engineering-workflow-repository";
import {
  authorizeAdminMutation,
  errorResponse,
  noStoreHeaders,
} from "@/lib/request-security";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ promptId: string }> },
) {
  try {
    const context = await authorizeAdminMutation(request);
    const { promptId } = await params;
    return NextResponse.json(
      {
        workflow: await requestImplementationApproval(
          context.orgId,
          promptId,
          context,
        ),
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
