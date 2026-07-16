import { NextRequest, NextResponse } from "next/server";
import { approveNotifications } from "@/lib/store";
import { authorizeMutation, errorResponse, noStoreHeaders } from "@/lib/request-security";

export async function POST(request: NextRequest) {
  try { const context = authorizeMutation(request); return NextResponse.json({ state: approveNotifications(context.orgId, context) }, { headers: noStoreHeaders }); }
  catch (error) { return errorResponse(error); }
}
