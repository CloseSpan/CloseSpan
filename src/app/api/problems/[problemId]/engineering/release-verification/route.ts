import { NextRequest, NextResponse } from "next/server";
import { recordReleaseVerification } from "@/lib/engineering-workflow-repository";
import { authorizeAdminMutation, errorResponse, noStoreHeaders } from "@/lib/request-security";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ problemId: string }> },
) {
  try {
    const context = await authorizeAdminMutation(request);
    const { problemId } = await params;
    const workflow = await recordReleaseVerification(
      context.orgId,
      problemId,
      await request.json(),
      context,
    );
    return NextResponse.json({ workflow }, { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
