import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceSetupStatus } from "@/lib/integration-repository";
import {
  authorizeRead,
  errorResponse,
  noStoreHeaders,
} from "@/lib/request-security";

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeRead(request);
    const status = await getWorkspaceSetupStatus(context.orgId);
    return NextResponse.json(status, { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
