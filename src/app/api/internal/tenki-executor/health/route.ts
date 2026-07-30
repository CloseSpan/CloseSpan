import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runTenkiSandboxCheck, TenkiSandboxCheckError } from "@/lib/tenki-sandbox-check";
import { noStoreHeaders } from "@/lib/request-security";

export const maxDuration = 90;

function authorized(request: NextRequest, secret: string): boolean {
  const provided = request.headers.get("x-closespan-signature") ?? "";
  if (!/^[a-f0-9]{64}$/.test(provided)) return false;
  const expected = createHmac("sha256", secret).update("").digest();
  const actual = Buffer.from(provided, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: NextRequest) {
  const secret = process.env.AGENT_EXECUTOR_SHARED_SECRET?.trim();
  if (!secret || !authorized(request, secret)) return new NextResponse("Not found", { status: 404, headers: noStoreHeaders });
  try {
    const result = await runTenkiSandboxCheck();
    return NextResponse.json({ status: "ok", provider: result.provider, timestamp: result.checkedAt }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json({
      status: "degraded",
      code: error instanceof TenkiSandboxCheckError ? error.code : "provider_unavailable",
      timestamp: new Date().toISOString(),
    }, { status: 503, headers: noStoreHeaders });
  }
}
