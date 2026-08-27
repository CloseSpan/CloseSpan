import { NextRequest, NextResponse } from "next/server";
import {
  authorizeAdminMutation,
  errorResponse,
  noStoreHeaders,
} from "@/lib/request-security";
import {
  CreateosSandboxCheckError,
  runCreateosSandboxCheck,
} from "@/lib/createos-sandbox-check";

export const runtime = "nodejs";

const errorStatus: Record<CreateosSandboxCheckError["code"], number> = {
  not_configured: 503,
  unauthorized: 503,
  quota_exceeded: 429,
  timeout: 504,
  execution_failed: 502,
  cleanup_failed: 502,
  unavailable: 503,
};

export async function POST(request: NextRequest) {
  try {
    await authorizeAdminMutation(request);
    return NextResponse.json(await runCreateosSandboxCheck(), {
      headers: noStoreHeaders,
    });
  } catch (error) {
    if (error instanceof CreateosSandboxCheckError) {
      console.error("[createos:sandbox-check]", { code: error.code });
      return NextResponse.json(
        {
          status: "failed",
          code: error.code,
          error: error.message,
          checkedAt: new Date().toISOString(),
        },
        { status: errorStatus[error.code], headers: noStoreHeaders },
      );
    }
    return errorResponse(error);
  }
}
