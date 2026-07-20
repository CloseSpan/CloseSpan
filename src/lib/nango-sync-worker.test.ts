import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyNangoSyncPage,
  claimNextNangoSyncJob,
  completeNangoSyncJob,
  enqueueNangoSyncJob,
  getNangoSyncStatus,
  resetNangoSyncMemoryState,
  yieldNangoSyncJob,
} from "./nango-sync-repository";
import {
  drainNangoSyncJobs,
  type NangoRecordsClient,
} from "./nango-sync-worker";

const baseJob = {
  payloadHash: "a".repeat(64),
  orgId: "org_alpha",
  integrationId: "int_zendesk",
  providerConfigKey: "zendesk",
  connectionId: "connection-alpha",
  nangoEnvironment: "DEV",
  syncName: "zendesk-tickets",
  syncVariant: "",
  model: "Ticket",
  modifiedAfter: "2026-07-20T09:00:00.000Z",
};

function record(
  id: string,
  cursor: string,
  body = `Feedback ${id}`,
) {
  return {
    id,
    body,
    _nango_metadata: {
      last_action: "UPDATED",
      cursor,
      last_modified_at: "2026-07-20T10:00:00.000Z",
    },
  };
}

describe("Nango leased sync worker", () => {
  beforeEach(() => {
    process.env.PERSISTENCE_MODE = "memory";
    process.env.APP_MODE = "demo";
    resetNangoSyncMemoryState();
  });

  afterEach(() => {
    resetNangoSyncMemoryState();
    delete process.env.PERSISTENCE_MODE;
    delete process.env.APP_MODE;
  });

  it("paginates from a durable cursor and completes a normalized import", async () => {
    await enqueueNangoSyncJob(baseJob);
    const listRecords = vi
      .fn<NangoRecordsClient["listRecords"]>()
      .mockResolvedValueOnce({
        records: [record("one", "record-cursor-1"), record("two", "record-cursor-2")],
        next_cursor: "page-cursor-2",
      })
      .mockResolvedValueOnce({
        records: [record("three", "record-cursor-3")],
        next_cursor: null,
      });

    const drained = await drainNangoSyncJobs({
      workerId: "worker-one",
      maxJobs: 1,
      nango: { listRecords },
      clock: () => new Date("2026-07-20T10:05:00.000Z"),
    });

    expect(drained).toEqual({
      claimed: 1,
      succeeded: 1,
      yielded: 0,
      retrying: 0,
      failed: 0,
      recordsProcessed: 3,
    });
    expect(listRecords).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ cursor: null, model: "Ticket", limit: 100 }),
    );
    expect(listRecords).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: "page-cursor-2" }),
    );
    expect(await getNangoSyncStatus("org_alpha", "int_zendesk")).toEqual(
      expect.objectContaining({
        status: "Succeeded",
        recordsProcessed: 3,
        pagesProcessed: 2,
        attempts: 1,
        lastErrorCode: null,
      }),
    );
  });

  it("retries after a failed page and resumes after the last committed cursor", async () => {
    await enqueueNangoSyncJob(baseJob);
    const firstClient: NangoRecordsClient = {
      listRecords: vi
        .fn<NangoRecordsClient["listRecords"]>()
        .mockResolvedValueOnce({
          records: [record("one", "record-cursor-1")],
          next_cursor: "after-page-one",
        })
        .mockRejectedValueOnce(new Error("upstream secret must not be stored")),
    };
    const first = await drainNangoSyncJobs({
      workerId: "worker-retry",
      maxJobs: 1,
      nango: firstClient,
      clock: () => new Date("2026-07-20T10:00:00.000Z"),
    });
    expect(first.retrying).toBe(1);
    expect(await getNangoSyncStatus("org_alpha", "int_zendesk")).toEqual(
      expect.objectContaining({
        status: "Retrying",
        pagesProcessed: 1,
        recordsProcessed: 1,
        lastErrorCode: "nango_records_unavailable",
        nextAttemptAt: "2026-07-20T10:01:00.000Z",
      }),
    );

    const resumed = vi
      .fn<NangoRecordsClient["listRecords"]>()
      .mockResolvedValue({
        records: [record("two", "record-cursor-2")],
        next_cursor: null,
      });
    const second = await drainNangoSyncJobs({
      workerId: "worker-retry",
      maxJobs: 1,
      nango: { listRecords: resumed },
      clock: () => new Date("2026-07-20T10:01:01.000Z"),
    });

    expect(second.succeeded).toBe(1);
    expect(resumed).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "after-page-one" }),
    );
    expect(await getNangoSyncStatus("org_alpha", "int_zendesk")).toEqual(
      expect.objectContaining({
        status: "Succeeded",
        attempts: 2,
        pagesProcessed: 2,
        recordsProcessed: 2,
        lastErrorCode: null,
      }),
    );
  });

  it("yields bounded work without consuming a retry attempt", async () => {
    await enqueueNangoSyncJob(baseJob);
    const listRecords = vi
      .fn<NangoRecordsClient["listRecords"]>()
      .mockResolvedValue({
        records: [record("one", "record-cursor-1")],
        next_cursor: "more-records",
      });

    const result = await drainNangoSyncJobs({
      workerId: "worker-bounded",
      maxJobs: 1,
      maxPagesPerJob: 1,
      nango: { listRecords },
      clock: () => new Date("2026-07-20T10:00:00.000Z"),
    });

    expect(result.yielded).toBe(1);
    expect(await getNangoSyncStatus("org_alpha", "int_zendesk")).toEqual(
      expect.objectContaining({
        status: "Queued",
        attempts: 0,
        pagesProcessed: 1,
        recordsProcessed: 1,
      }),
    );
  });

  it("moves a yielded stream behind other ready work", async () => {
    await enqueueNangoSyncJob(baseJob);
    await enqueueNangoSyncJob({
      ...baseJob,
      payloadHash: "b".repeat(64),
      syncName: "zendesk-comments",
      model: "Comment",
    });
    const first = await claimNextNangoSyncJob({
      workerId: "worker-fairness",
      now: new Date("2030-01-01T00:00:00.000Z"),
    });
    expect(first).not.toBeNull();
    await yieldNangoSyncJob({
      jobId: first!.id,
      workerId: "worker-fairness",
      now: new Date("2030-01-01T00:00:01.000Z"),
    });

    const next = await claimNextNangoSyncJob({
      workerId: "worker-fairness",
      now: new Date("2030-01-01T00:00:02.000Z"),
    });
    expect(next).not.toBeNull();
    expect(next?.model).not.toBe(first?.model);
  });

  it("continues a chunked import within one bounded drain", async () => {
    await enqueueNangoSyncJob(baseJob);
    const listRecords = vi
      .fn<NangoRecordsClient["listRecords"]>()
      .mockResolvedValueOnce({
        records: [record("one", "record-cursor-1")],
        next_cursor: "page-one",
      })
      .mockResolvedValueOnce({
        records: [record("two", "record-cursor-2")],
        next_cursor: "page-two",
      })
      .mockResolvedValueOnce({
        records: [record("three", "record-cursor-3")],
        next_cursor: null,
      });

    const result = await drainNangoSyncJobs({
      workerId: "worker-continuation",
      maxJobs: 3,
      maxPagesPerJob: 1,
      nango: { listRecords },
      clock: () => new Date("2030-01-01T00:00:00.000Z"),
    });

    expect(result).toEqual({
      claimed: 3,
      succeeded: 1,
      yielded: 2,
      retrying: 0,
      failed: 0,
      recordsProcessed: 3,
    });
    expect(listRecords).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: "page-one" }),
    );
    expect(listRecords).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ cursor: "page-two" }),
    );
  });

  it("retries an unsupported record without committing its page cursor", async () => {
    await enqueueNangoSyncJob(baseJob);
    const unsupported = vi
      .fn<NangoRecordsClient["listRecords"]>()
      .mockResolvedValue({
        records: [{ id: "opaque", arbitrary: { nested: "not feedback" } }],
        next_cursor: "must-not-commit",
      });
    const first = await drainNangoSyncJobs({
      workerId: "worker-unsupported",
      maxJobs: 1,
      nango: { listRecords: unsupported },
      clock: () => new Date("2026-07-20T10:00:00.000Z"),
    });

    expect(first.retrying).toBe(1);
    expect(await getNangoSyncStatus("org_alpha", "int_zendesk")).toEqual(
      expect.objectContaining({
        status: "Retrying",
        pagesProcessed: 0,
        recordsProcessed: 0,
        lastErrorCode: "unsupported_nango_record",
      }),
    );

    const recovered = vi
      .fn<NangoRecordsClient["listRecords"]>()
      .mockResolvedValue({ records: [record("supported", "cursor-ok")], next_cursor: null });
    await drainNangoSyncJobs({
      workerId: "worker-unsupported",
      maxJobs: 1,
      nango: { listRecords: recovered },
      clock: () => new Date("2026-07-20T10:01:01.000Z"),
    });
    expect(recovered).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: null }),
    );
  });

  it("serializes jobs for one stream and gives the next job the saved cursor", async () => {
    await enqueueNangoSyncJob(baseJob);
    await enqueueNangoSyncJob({ ...baseJob, payloadHash: "b".repeat(64) });
    const now = new Date("2026-07-20T10:00:00.000Z");
    const first = await claimNextNangoSyncJob({ workerId: "worker-a", now });
    expect(first).not.toBeNull();
    expect(
      await claimNextNangoSyncJob({ workerId: "worker-b", now }),
    ).toBeNull();

    await applyNangoSyncPage({
      jobId: first!.id,
      workerId: "worker-a",
      records: [],
      fetchedCount: 0,
      pageCursor: "saved-stream-cursor",
      now,
    });

    await completeNangoSyncJob({
      jobId: first!.id,
      workerId: "worker-a",
      now,
    });
    const second = await claimNextNangoSyncJob({ workerId: "worker-b", now });
    expect(second?.id).not.toBe(first?.id);
    expect(second?.cursor).toBe("saved-stream-cursor");
  });

  it("deduplicates a replayed sync webhook job by payload hash", async () => {
    const first = await enqueueNangoSyncJob(baseJob);
    const replay = await enqueueNangoSyncJob(baseJob);
    expect(replay).toBe(first);
  });
});
