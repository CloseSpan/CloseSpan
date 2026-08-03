import { NextRequest, NextResponse } from "next/server";
import {
  analyzeAndClusterSlackSignals,
  deliverSlackNotifications,
  reconcileSlackNotifications,
  syncSlackIntake,
} from "@/lib/slack-intake";
import {
  authorizeAdminMutation,
  errorResponse,
  noStoreHeaders,
} from "@/lib/request-security";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const sync = await syncSlackIntake(context.orgId);
    const intelligence = await analyzeAndClusterSlackSignals(context.orgId);
    await reconcileSlackNotifications(context.orgId);
    const notifications = await deliverSlackNotifications(context.orgId);
    return NextResponse.json(
      { sync, intelligence, notifications },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
