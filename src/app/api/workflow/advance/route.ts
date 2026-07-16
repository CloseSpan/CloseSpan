import { NextRequest, NextResponse } from "next/server";
import { advanceLifecycle } from "@/lib/store";
import { authorizeMutation, errorResponse, noStoreHeaders } from "@/lib/request-security";

export async function POST(request: NextRequest) {
  try { const context = authorizeMutation(request); return NextResponse.json({ state: advanceLifecycle(context.orgId, context) }, { headers: noStoreHeaders }); }
  catch (error) { return errorResponse(error); }
}
