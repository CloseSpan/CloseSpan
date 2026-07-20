import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { drainNangoSyncJobs } from "@/lib/nango-sync-worker";
import { noStoreHeaders } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FRIENDLY_ERROR =
  "The background import worker is unavailable right now.";

function positiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

export function workerRequestAuthorized(
  authorization: string | null,
  configuredSecret = process.env.CRON_SECRET?.trim() ?? "",
): boolean {
  if (configuredSecret.length < 16 || !authorization) return false;
  const expected = Buffer.from(`Bearer ${configuredSecret}`, "utf8");
  const supplied = Buffer.from(authorization, "utf8");
  return (
    expected.length === supplied.length && timingSafeEqual(expected, supplied)
  );
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json(
      { error: FRIENDLY_ERROR },
      { status: 503, headers: noStoreHeaders },
    );
  }
  if (!workerRequestAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: noStoreHeaders },
    );
  }

  try {
    const result = await drainNangoSyncJobs({
      workerId: `cron_${randomUUID()}`,
      maxJobs: positiveInteger(process.env.NANGO_SYNC_MAX_JOBS, 5, 25),
      maxPagesPerJob: positiveInteger(
        process.env.NANGO_SYNC_MAX_PAGES_PER_JOB,
        20,
        100,
      ),
      pageSize: positiveInteger(process.env.NANGO_SYNC_PAGE_SIZE, 100, 1_000),
      leaseMs: positiveInteger(
        process.env.NANGO_SYNC_LEASE_MS,
        5 * 60_000,
        30 * 60_000,
      ),
      maxRuntimeMs: positiveInteger(
        process.env.NANGO_SYNC_WORKER_BUDGET_MS,
        45_000,
        50_000,
      ),
    });
    return NextResponse.json(result, { headers: noStoreHeaders });
  } catch (error) {
    console.error("[nango:sync-cron]", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: FRIENDLY_ERROR },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
