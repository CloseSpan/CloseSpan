import { NextRequest, NextResponse } from "next/server";
import {
  recordInvestigationVerification,
  type InvestigationVerificationMethod,
  type InvestigationVerificationStatus,
} from "@/lib/investigation-repository";
import {
  authorizeMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

const MAX_BODY_BYTES = 4_096;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ problemId: string }> },
) {
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "Verification evidence is too large" },
        { status: 413, headers: noStoreHeaders },
      );
    }
    const [context, { problemId }] = await Promise.all([
      authorizeMutation(request),
      params,
    ]);
    const bodyText = await request.text();
    if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "Verification evidence is too large" },
        { status: 413, headers: noStoreHeaders },
      );
    }
    let body: { status?: unknown; method?: unknown; summary?: unknown };
    try {
      body = JSON.parse(bodyText) as typeof body;
    } catch {
      throw new HttpError(400, "Verification request is invalid");
    }
    await recordInvestigationVerification({
      orgId: context.orgId,
      problemId,
      status: body.status as InvestigationVerificationStatus,
      method: body.method as InvestigationVerificationMethod,
      summary: typeof body.summary === "string" ? body.summary : "",
      actor: {
        actorId: context.actorId,
        actorName: context.actorName,
        traceId: context.traceId,
      },
    });
    return NextResponse.json(
      { recorded: true },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
