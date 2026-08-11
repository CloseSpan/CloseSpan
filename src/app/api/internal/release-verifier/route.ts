import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { NextRequest, NextResponse } from "next/server";
import {
  claimPostReleaseVerificationExecution,
  completePostReleaseVerification,
  getReleaseVerifierJob,
} from "@/lib/release-lifecycle-repository";
import {
  executeTenkiReleaseVerification,
  releaseVerifierJobSchema,
} from "@/lib/tenki-release-verifier";
import { noStoreHeaders } from "@/lib/request-security";
import { z } from "zod";

export const maxDuration = 300;
const dispatchSchema = z.object({
  schemaVersion: z.literal(1),
  jobId: z.string().uuid(),
  orgId: z.string().min(1).max(200),
}).strict();

function validSignature(body: string, provided: string, secret: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(provided)) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

export async function POST(request: NextRequest) {
  const executorSecret = process.env.RELEASE_VERIFIER_EXECUTOR_SHARED_SECRET?.trim();
  const callbackSecret = process.env.RELEASE_VERIFIER_SHARED_SECRET?.trim();
  if (!executorSecret || !callbackSecret)
    return NextResponse.json({ error: "Release verifier is not configured" }, { status: 503, headers: noStoreHeaders });
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > 16_384)
    return NextResponse.json({ error: "Release verification job is too large" }, { status: 413, headers: noStoreHeaders });
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > 16_384)
    return NextResponse.json({ error: "Release verification job is too large" }, { status: 413, headers: noStoreHeaders });
  if (!validSignature(body, request.headers.get("x-closespan-signature") ?? "", executorSecret))
    return NextResponse.json({ error: "Invalid release verifier signature" }, { status: 401, headers: noStoreHeaders });
  let dispatch;
  try {
    dispatch = dispatchSchema.parse(JSON.parse(body));
  } catch {
    return NextResponse.json({ error: "Invalid release verification job" }, { status: 400, headers: noStoreHeaders });
  }

  const claim = await claimPostReleaseVerificationExecution(dispatch.orgId, dispatch.jobId);
  if (claim === "active")
    return NextResponse.json({ error: "Release verification is already running" }, { status: 503, headers: noStoreHeaders });
  if (claim === "terminal")
    return NextResponse.json({ ok: true, duplicate: true }, { headers: noStoreHeaders });
  if (claim === "exhausted") {
    await completePostReleaseVerification(dispatch.orgId, dispatch.jobId, {
      status: "Failed",
      evidence: "Production verification infrastructure exhausted three safe retry attempts.",
    });
    return NextResponse.json({ ok: false, exhausted: true }, { headers: noStoreHeaders });
  }

  try {
    const job = releaseVerifierJobSchema.parse(
      await getReleaseVerifierJob(dispatch.orgId, dispatch.jobId),
    );
    const verification = await executeTenkiReleaseVerification(job, {
      storageState: process.env.RELEASE_VERIFIER_STORAGE_STATE_JSON?.trim(),
      syntheticBearerToken: process.env.RELEASE_VERIFIER_SYNTHETIC_BEARER_TOKEN?.trim(),
    });
    const response = await fetch(job.callbackUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${callbackSecret}`,
      },
      body: JSON.stringify({
        orgId: job.orgId,
        status: verification.status,
        evidence: verification.evidence,
        result: verification.result,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`CloseSpan callback returned HTTP ${response.status}`);
    return NextResponse.json({ ok: true, status: verification.status }, { headers: noStoreHeaders });
  } catch (error) {
    console.error("Release verification execution failed", {
      jobId: dispatch.jobId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ error: "Release verification execution failed" }, { status: 503, headers: noStoreHeaders });
  }
}
