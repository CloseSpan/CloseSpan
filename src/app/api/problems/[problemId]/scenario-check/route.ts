import { NextRequest, NextResponse } from "next/server";
import { postIssueScenarioCheck, readIssueScenarioCheck } from "@/lib/issue-scenario-check-repository";
import { authorizeMutation, authorizeRead, errorResponse, HttpError, noStoreHeaders } from "@/lib/request-security";

export const maxDuration = 300;
function checkError(error: unknown) {
  return errorResponse(error instanceof HttpError ? error : new HttpError(503, "Scenario checks are temporarily unavailable"));
}
export async function GET(request: NextRequest, { params }: { params: Promise<{ problemId: string }> }) {
  try {
    const context = await authorizeRead(request);
    return NextResponse.json(await readIssueScenarioCheck(context.orgId, (await params).problemId), { headers: noStoreHeaders });
  } catch (error) { return checkError(error); }
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ problemId: string }> }) {
  try {
    const context = await authorizeMutation(request);
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 12_000) throw new HttpError(413, "The scenario is too large");
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new HttpError(400, "The scenario-check request is invalid"); }
    const result = await postIssueScenarioCheck(context, (await params).problemId, body);
    return NextResponse.json(result, { status: result.status === "processing" ? 202 : 200, headers: noStoreHeaders });
  } catch (error) { return checkError(error); }
}
