import { NextRequest, NextResponse } from "next/server";
import { requeueFailedBillingShadow } from "@/lib/billing-outbox";
import {
  authorizeAdminMutation,
  errorResponse,
  noStoreHeaders,
} from "@/lib/request-security";

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const result = await requeueFailedBillingShadow(context.orgId);
    return NextResponse.json(result, { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
