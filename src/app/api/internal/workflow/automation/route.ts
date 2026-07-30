import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runProblemAutomationForAllOrganizations } from "@/lib/problem-automation-repository";
import { noStoreHeaders } from "@/lib/request-security";

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!secret || !provided) return false;
  const expectedBytes = Buffer.from(secret);
  const providedBytes = Buffer.from(provided);
  return (
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: noStoreHeaders },
    );
  }
  try {
    const results = await runProblemAutomationForAllOrganizations();
    return NextResponse.json({ results }, { headers: noStoreHeaders });
  } catch {
    return NextResponse.json(
      { error: "Workflow automation failed" },
      { status: 500, headers: noStoreHeaders },
    );
  }
}
