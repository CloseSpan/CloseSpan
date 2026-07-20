import { NextRequest, NextResponse } from "next/server";
import { findState } from "@/lib/store";
import { authorizeRead, errorResponse, HttpError, noStoreHeaders } from "@/lib/request-security";

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeRead(request);
    const state = await findState(context.orgId);
    if (!state)
      throw new HttpError(404,"No approval workflow exists in this workspace");
    return NextResponse.json({ state }, { headers: noStoreHeaders });
  }
  catch (error) { return errorResponse(error); }
}
