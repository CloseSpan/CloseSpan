import { NextRequest, NextResponse } from "next/server";
import { approveAction } from "@/lib/store";
import { authorizeMutation, errorResponse, noStoreHeaders } from "@/lib/request-security";

export async function POST(request: NextRequest) {
  try { const context = authorizeMutation(request); return NextResponse.json({ state: await approveAction(context.orgId, context) }, { headers: noStoreHeaders }); }
  catch (error) { return errorResponse(error); }
}
