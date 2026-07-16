import { NextRequest, NextResponse } from "next/server";
import { getState } from "@/lib/store";
import { authorizeRead, errorResponse, noStoreHeaders } from "@/lib/request-security";

export async function GET(request: NextRequest) {
  try { const context = authorizeRead(request); return NextResponse.json({ state: getState(context.orgId) }, { headers: noStoreHeaders }); }
  catch (error) { return errorResponse(error); }
}
