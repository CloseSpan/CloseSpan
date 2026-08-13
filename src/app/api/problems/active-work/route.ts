import { NextRequest, NextResponse } from "next/server";
import { readProblemActiveWork } from "@/lib/problem-active-work-repository";
import {
  authorizeRead,
  errorResponse,
  noStoreHeaders,
} from "@/lib/request-security";

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeRead(request);
    return NextResponse.json(
      { activeWork: await readProblemActiveWork(context.orgId) },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
