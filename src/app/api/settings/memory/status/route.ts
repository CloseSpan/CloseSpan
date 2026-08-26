import { NextRequest, NextResponse } from "next/server";
import { checkMitosisPilotStatus } from "@/lib/mitosis-memory";
import {
  authorizeAdminRead,
  errorResponse,
  noStoreHeaders,
} from "@/lib/request-security";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeAdminRead(request);
    return NextResponse.json(
      await checkMitosisPilotStatus(context.orgId),
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
