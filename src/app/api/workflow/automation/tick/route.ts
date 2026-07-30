import { NextRequest, NextResponse } from "next/server";
import { runProblemAutomationTick } from "@/lib/problem-automation-repository";
import {
  authorizeMutation,
  errorResponse,
  noStoreHeaders,
} from "@/lib/request-security";

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeMutation(request);
    return NextResponse.json(
      { result: await runProblemAutomationTick(context.orgId) },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
