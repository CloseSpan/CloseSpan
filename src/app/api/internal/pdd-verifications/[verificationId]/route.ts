import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { completePddVerification } from "@/lib/engineering-workflow-repository";
import { noStoreHeaders } from "@/lib/request-security";
import { reconcileFullAutonomy } from "@/lib/autonomy-automation-repository";

function validSignature(body: string, provided: string, secret: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(provided)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const actual = Buffer.from(provided, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ verificationId: string }> },
) {
  const secret = process.env.PDD_RUNNER_SHARED_SECRET?.trim();
  if (!secret)
    return NextResponse.json({ error: "PDD callback is not configured" }, { status: 503, headers: noStoreHeaders });
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > 16_000_000)
    return NextResponse.json({ error: "PDD callback is too large" }, { status: 413, headers: noStoreHeaders });
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > 16_000_000)
    return NextResponse.json({ error: "PDD callback is too large" }, { status: 413, headers: noStoreHeaders });
  if (!validSignature(body, request.headers.get("x-closespan-signature") ?? "", secret))
    return NextResponse.json({ error: "Invalid PDD callback signature" }, { status: 401, headers: noStoreHeaders });
  try {
    const payload = JSON.parse(body) as { orgId?: string; result?: unknown };
    if (!payload.orgId || !payload.result) throw new Error("PDD callback is incomplete");
    const { verificationId } = await params;
    const workflow = await completePddVerification(
      payload.orgId,
      verificationId,
      payload.result,
      {
        actorId: "system:pdd-runner",
        actorName: "PDD runner",
        traceId: `pdd_${verificationId}`,
        idempotencyKey: `pdd_${verificationId}`,
      },
    );
    const autonomy = await reconcileFullAutonomy(payload.orgId).catch((error: unknown) => ({
      action: "blocked" as const,
      problemId: workflow.problemId,
      message: error instanceof Error ? error.message : "Full-autonomy reconciliation failed.",
    }));
    return NextResponse.json({ ok: true, workflow, autonomy }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "PDD callback failed" },
      { status: 409, headers: noStoreHeaders },
    );
  }
}
