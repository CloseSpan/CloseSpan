import { NextRequest, NextResponse } from "next/server";
import { rejectAction } from "@/lib/store";
import { authorizeMutation, errorResponse, noStoreHeaders } from "@/lib/request-security";

export async function POST(request: NextRequest) {
  try { const context = await authorizeMutation(request); return NextResponse.json({ state: await rejectAction(context.orgId, context) }, { headers: noStoreHeaders }); }
  catch (error) { return errorResponse(error); }
}
