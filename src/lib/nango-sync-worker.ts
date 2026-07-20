import type { Nango } from "@nangohq/node";
import { getNangoClient } from "./nango";
import {
  normalizeNangoRecord,
  type NormalizedFeedbackRecord,
} from "./nango-sync-normalizer";
import {
  applyNangoSyncPage,
  claimNextNangoSyncJob,
  completeNangoSyncJob,
  failNangoSyncJob,
  getNangoSyncCurrentTime,
  type NangoSyncJob,
  yieldNangoSyncJob,
} from "./nango-sync-repository";

export interface NangoRecordsClient {
  listRecords(config: {
    providerConfigKey: string;
    connectionId: string;
    model: string;
    variant?: string;
    limit?: number;
    cursor?: string | null;
  }): Promise<{ records: unknown[]; next_cursor: string | null }>;
}

export interface NangoSyncDrainResult {
  claimed: number;
  succeeded: number;
  yielded: number;
  retrying: number;
  failed: number;
  recordsProcessed: number;
}

type JobOutcome = {
  status: "Succeeded" | "Yielded" | "Retrying" | "Failed";
  recordsProcessed: number;
};

class UnsupportedNangoRecordError extends Error {
  constructor() {
    super("Nango returned a record that cannot be mapped to feedback");
    this.name = "UnsupportedNangoRecordError";
  }
}

function clientFromSdk(): NangoRecordsClient {
  return getNangoClient() as Pick<Nango, "listRecords">;
}

function errorCode(error: unknown): string {
  if (error instanceof UnsupportedNangoRecordError)
    return "unsupported_nango_record";
  if (error instanceof Error && error.name === "AbortError")
    return "nango_records_timeout";
  if (
    error instanceof Error &&
    error.message === "Nango sync job lease is no longer owned by this worker"
  ) {
    return "sync_job_lease_lost";
  }
  return "nango_records_unavailable";
}

export async function runNangoSyncJob(input: {
  job: NangoSyncJob;
  workerId: string;
  nango?: NangoRecordsClient;
  pageSize?: number;
  maxPages?: number;
  leaseMs?: number;
  deadlineAt?: number;
  clock?: () => Date;
}): Promise<JobOutcome> {
  const pageSize = Math.min(Math.max(input.pageSize ?? 100, 1), 1_000);
  const maxPages = Math.min(Math.max(input.maxPages ?? 25, 1), 250);
  let cursor = input.job.cursor;
  let processed = 0;
  try {
    const nango = input.nango ?? clientFromSdk();
    for (let page = 0; page < maxPages; page += 1) {
      const result = await nango.listRecords({
        providerConfigKey: input.job.providerConfigKey,
        connectionId: input.job.connectionId,
        model: input.job.model,
        ...(input.job.syncVariant
          ? { variant: input.job.syncVariant }
          : {}),
        limit: pageSize,
        cursor,
      });
      if (!Array.isArray(result.records))
        throw new Error("Nango returned an invalid records page");
      const now = input.clock?.() ?? (await getNangoSyncCurrentTime());
      const normalizedPage = result.records.map((record) =>
        normalizeNangoRecord(
          record,
          {
            orgId: input.job.orgId,
            integrationId: input.job.integrationId,
            sourceNamespace: `nango:${input.job.cursorId}`,
          },
          now,
        ),
      );
      if (
        normalizedPage.some(
          (record) => record === null || record.outcome === "Skipped",
        )
      ) {
        // The whole page is rejected before its receipt/cursor transaction so
        // an adapter update can safely replay the unsupported record later.
        throw new UnsupportedNangoRecordError();
      }
      const normalized = normalizedPage.filter(
        (record): record is NormalizedFeedbackRecord => record !== null,
      );
      const lastRecordCursor = [...normalized]
        .reverse()
        .find((record) => record.nangoCursor)?.nangoCursor;
      const pageCursor = result.next_cursor ?? lastRecordCursor ?? cursor;
      await applyNangoSyncPage({
        jobId: input.job.id,
        workerId: input.workerId,
        records: normalized,
        fetchedCount: result.records.length,
        pageCursor,
        ...(input.clock ? { now } : {}),
        leaseMs: input.leaseMs,
      });
      processed += result.records.length;

      const hasNextPage =
        result.next_cursor !== null && result.next_cursor !== cursor;
      cursor = pageCursor;
      if (!hasNextPage) {
        await completeNangoSyncJob({
          jobId: input.job.id,
          workerId: input.workerId,
          ...(input.clock ? { now: input.clock() } : {}),
        });
        return { status: "Succeeded", recordsProcessed: processed };
      }
      if (input.deadlineAt && Date.now() >= input.deadlineAt) break;
    }
    await yieldNangoSyncJob({
      jobId: input.job.id,
      workerId: input.workerId,
      ...(input.clock ? { now: input.clock() } : {}),
    });
    return { status: "Yielded", recordsProcessed: processed };
  } catch (error) {
    try {
      const status = await failNangoSyncJob({
        jobId: input.job.id,
        workerId: input.workerId,
        errorCode: errorCode(error),
        ...(input.clock ? { now: input.clock() } : {}),
      });
      return { status, recordsProcessed: processed };
    } catch (leaseError) {
      console.error("[nango:sync-worker]", {
        errorType:
          leaseError instanceof Error ? leaseError.name : "UnknownError",
        outcome: "lease_lost",
      });
      return { status: "Failed", recordsProcessed: processed };
    }
  }
}

export async function drainNangoSyncJobs(input: {
  workerId: string;
  maxJobs?: number;
  nango?: NangoRecordsClient;
  pageSize?: number;
  maxPagesPerJob?: number;
  leaseMs?: number;
  maxRuntimeMs?: number;
  clock?: () => Date;
}): Promise<NangoSyncDrainResult> {
  const maxJobs = Math.min(Math.max(input.maxJobs ?? 5, 1), 50);
  const maxRuntimeMs = Math.min(
    Math.max(input.maxRuntimeMs ?? 45_000, 1_000),
    50_000,
  );
  const deadlineAt = Date.now() + maxRuntimeMs;
  const result: NangoSyncDrainResult = {
    claimed: 0,
    succeeded: 0,
    yielded: 0,
    retrying: 0,
    failed: 0,
    recordsProcessed: 0,
  };
  for (let index = 0; index < maxJobs; index += 1) {
    if (Date.now() >= deadlineAt) break;
    const job = await claimNextNangoSyncJob({
      workerId: input.workerId,
      ...(input.clock ? { now: input.clock() } : {}),
      leaseMs: input.leaseMs,
    });
    if (!job) break;
    result.claimed += 1;
    const outcome = await runNangoSyncJob({
      job,
      workerId: input.workerId,
      nango: input.nango,
      pageSize: input.pageSize,
      maxPages: input.maxPagesPerJob,
      leaseMs: input.leaseMs,
      deadlineAt,
      clock: input.clock,
    });
    result.recordsProcessed += outcome.recordsProcessed;
    if (outcome.status === "Succeeded") result.succeeded += 1;
    else if (outcome.status === "Yielded") result.yielded += 1;
    else if (outcome.status === "Retrying") result.retrying += 1;
    else result.failed += 1;
  }
  return result;
}
