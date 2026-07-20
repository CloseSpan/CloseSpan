import { NextRequest, NextResponse } from "next/server";
import { markGithubPendingSetup } from "@/lib/integration-repository";
import {
  authorizeAdminMutation,
  errorResponse,
  noStoreHeaders,
} from "@/lib/request-security";

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const installUrl = await markGithubPendingSetup(
      context.orgId,
      context.actorId,
    );
    return NextResponse.json({ installUrl }, { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
