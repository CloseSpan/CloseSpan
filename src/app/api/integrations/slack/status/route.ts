import { NextRequest, NextResponse } from "next/server";
import { getSlackIntakeStatus } from "@/lib/slack-intake";
import {
  authorizeRead,
  errorResponse,
  noStoreHeaders,
} from "@/lib/request-security";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeRead(request);
    return NextResponse.json(
      { slackIntake: await getSlackIntakeStatus(context.orgId) },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
