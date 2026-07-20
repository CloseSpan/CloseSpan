import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { drainNangoSyncJobs } from "./nango-sync-worker";

function positiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

/**
 * Starts a bounded worker after the signed Nango webhook response is committed.
 * The database job remains the source of truth; the protected cron route later
 * recovers a job if this best-effort execution is interrupted by the runtime.
 */
export function scheduleNangoSyncDrain(): void {
  // Route handlers are invoked directly in unit tests without Next's request
  // lifecycle, where `after()` is intentionally unavailable.
  if (process.env.NODE_ENV === "test") return;

  after(async () => {
    try {
      await drainNangoSyncJobs({
        workerId: `webhook_${randomUUID()}`,
        // A yielded job is placed at the back of the durable queue. Multiple
        // bounded claims therefore continue large imports promptly while also
        // giving every ready stream a turn inside the 60-second route budget.
        maxJobs: positiveInteger(
          process.env.NANGO_SYNC_WEBHOOK_MAX_JOBS,
          6,
          10,
        ),
        maxPagesPerJob: positiveInteger(
          process.env.NANGO_SYNC_WEBHOOK_MAX_PAGES,
          5,
          10,
        ),
        pageSize: positiveInteger(
          process.env.NANGO_SYNC_PAGE_SIZE,
          100,
          1_000,
        ),
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
    } catch (error) {
      console.error("[nango:sync-scheduler]", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
  });
}
