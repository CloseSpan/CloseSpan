import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { completePostReleaseVerification } from "@/lib/release-lifecycle-repository";
import { noStoreHeaders } from "@/lib/request-security";

function authorized(request: NextRequest): boolean {
  const secret = process.env.RELEASE_VERIFIER_SHARED_SECRET?.trim();
  const authorization = request.headers.get("authorization") ?? "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!secret || !provided) return false;
  const expectedBytes = Buffer.from(secret);
  const providedBytes = Buffer.from(provided);
  return expectedBytes.length === providedBytes.length
    && timingSafeEqual(expectedBytes, providedBytes);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  if (!authorized(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders });
  try {
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > 4_250_000)
      return NextResponse.json({ error: "Verification evidence is too large" }, { status: 413, headers: noStoreHeaders });
    const { jobId } = await context.params;
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > 4_250_000)
      return NextResponse.json({ error: "Verification evidence is too large" }, { status: 413, headers: noStoreHeaders });
    const body = JSON.parse(rawBody) as { orgId?: unknown; status?: unknown; evidence?: unknown; result?: unknown };
    const orgId = typeof body.orgId === "string" ? body.orgId.trim() : "";
    const status = body.status === "Passed" || body.status === "Failed" ? body.status : null;
    const evidence = typeof body.evidence === "string" ? body.evidence.trim() : "";
    if (!orgId || !status || !evidence)
      return NextResponse.json({ error: "orgId, status, and evidence are required" }, { status: 400, headers: noStoreHeaders });
    await completePostReleaseVerification(orgId, jobId, { status, evidence, result: body.result });
    return NextResponse.json({ accepted: true }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Release verification callback failed" },
      { status: 409, headers: noStoreHeaders },
    );
  }
}
