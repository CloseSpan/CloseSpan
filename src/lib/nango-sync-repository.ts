import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { databasePool, persistenceMode, transaction } from "./db";
import type { NormalizedFeedbackRecord } from "./nango-sync-normalizer";

export type NangoSyncJobStatus =
  | "Queued"
  | "Running"
  | "Retrying"
  | "Succeeded"
  | "Failed";

export interface NangoSyncJob {
  id: string;
  cursorId: string;
  orgId: string;
  integrationId: string;
  providerConfigKey: string;
  connectionId: string;
  nangoEnvironment: string;
  syncName: string;
  syncVariant: string;
  model: string;
  status: NangoSyncJobStatus;
  attempts: number;
  maxAttempts: number;
  recordsProcessed: number;
  pagesProcessed: number;
  cursor: string | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  lockedBy: string | null;
  leaseExpiresAt: string | null;
}

export type NangoSyncStatus = Omit<
  NangoSyncJob,
  | "cursorId"
  | "orgId"
  | "providerConfigKey"
  | "connectionId"
  | "nangoEnvironment"
  | "syncVariant"
  | "cursor"
  | "maxAttempts"
  | "lockedBy"
  | "leaseExpiresAt"
>;

export interface EnqueueNangoSyncInput {
  payloadHash: string;
  orgId: string;
  integrationId: string;
  providerConfigKey: string;
  connectionId: string;
  nangoEnvironment: string;
  syncName: string;
  syncVariant: string;
  model: string;
  modifiedAfter?: string;
}

interface MemoryCursor {
  id: string;
  key: string;
  cursor: string | null;
  modifiedAfter: string | null;
}

interface MemoryJob extends NangoSyncJob {
  webhookEventHash: string;
  availableAt: string;
  queueOrderAt: string;
}

const memoryCursors = new Map<string, MemoryCursor>();
const memoryJobs = new Map<string, MemoryJob>();
const memoryReceipts = new Map<string, NormalizedFeedbackRecord>();
const memoryFeedback = new Map<string, NormalizedFeedbackRecord["feedback"]>();

function streamKey(input: {
  orgId: string;
  integrationId: string;
  providerConfigKey: string;
  connectionId: string;
  nangoEnvironment: string;
  syncName: string;
  syncVariant: string;
  model: string;
}): string {
  return [
    input.orgId,
    input.integrationId,
    input.providerConfigKey,
    input.connectionId,
    input.nangoEnvironment,
    input.syncName,
    input.syncVariant,
    input.model,
  ].join("\0");
}

function safeErrorCode(value: string): string {
  const code = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return code || "sync_worker_failed";
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function statusFromJob(job: NangoSyncJob): NangoSyncStatus {
  return {
    id: job.id,
    integrationId: job.integrationId,
    syncName: job.syncName,
    model: job.model,
    status: job.status,
    attempts: job.attempts,
    recordsProcessed: job.recordsProcessed,
    pagesProcessed: job.pagesProcessed,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    nextAttemptAt: job.nextAttemptAt,
    lastErrorCode: job.lastErrorCode,
  };
}

/**
 * Returns the persistence clock used for fallback source timestamps. Queue and
 * lease mutations still resolve the clock again inside their own transaction.
 */
export async function getNangoSyncCurrentTime(): Promise<Date> {
  if (persistenceMode() !== "postgres") return new Date();
  const result = await databasePool().query<{ current_time: Date }>(
    "SELECT clock_timestamp() AS current_time",
  );
  return result.rows[0]!.current_time;
}

function memoryJobFromInput(
  input: EnqueueNangoSyncInput,
  cursor: MemoryCursor,
): MemoryJob {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    cursorId: cursor.id,
    webhookEventHash: input.payloadHash,
    orgId: input.orgId,
    integrationId: input.integrationId,
    providerConfigKey: input.providerConfigKey,
    connectionId: input.connectionId,
    nangoEnvironment: input.nangoEnvironment,
    syncName: input.syncName,
    syncVariant: input.syncVariant,
    model: input.model,
    status: "Queued",
    attempts: 0,
    maxAttempts: 8,
    recordsProcessed: 0,
    pagesProcessed: 0,
    cursor: null,
    queuedAt: now,
    startedAt: null,
    completedAt: null,
    nextAttemptAt: now,
    lastErrorCode: null,
    lockedBy: null,
    leaseExpiresAt: null,
    availableAt: now,
    queueOrderAt: now,
  };
}

export async function enqueueNangoSyncJob(
  input: EnqueueNangoSyncInput,
  client?: PoolClient,
): Promise<string> {
  if (persistenceMode() !== "postgres") {
    const duplicate = [...memoryJobs.values()].find(
      (job) => job.webhookEventHash === input.payloadHash,
    );
    if (duplicate) return duplicate.id;
    const key = streamKey(input);
    let cursor = memoryCursors.get(key);
    if (!cursor) {
      cursor = {
        id: randomUUID(),
        key,
        cursor: null,
        modifiedAfter: input.modifiedAfter ?? null,
      };
      memoryCursors.set(key, cursor);
    } else if (input.modifiedAfter) {
      cursor.modifiedAfter = input.modifiedAfter;
    }
    const job = memoryJobFromInput(input, cursor);
    memoryJobs.set(job.id, job);
    return job.id;
  }

  const work = async (queryClient: PoolClient): Promise<string> => {
    const cursorResult = await queryClient.query<{ id: string }>(
      `INSERT INTO nango_sync_cursors(
         org_id, integration_id, provider_config_key, connection_id,
         nango_environment, sync_name, sync_variant, model,
         source_modified_after
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (
         org_id, integration_id, provider_config_key, connection_id,
         nango_environment, sync_name, sync_variant, model
       ) DO UPDATE SET
         source_modified_after=coalesce(
           excluded.source_modified_after,
           nango_sync_cursors.source_modified_after
         ),
         updated_at=now()
       RETURNING id`,
      [
        input.orgId,
        input.integrationId,
        input.providerConfigKey,
        input.connectionId,
        input.nangoEnvironment,
        input.syncName,
        input.syncVariant,
        input.model,
        input.modifiedAfter ?? null,
      ],
    );
    const cursorId = cursorResult.rows[0]?.id;
    if (!cursorId) throw new Error("Nango sync cursor could not be created");
    const jobResult = await queryClient.query<{ id: string }>(
      `INSERT INTO nango_sync_jobs(
         cursor_id, webhook_event_hash, org_id, integration_id
       ) VALUES ($1,$2,$3,$4)
       ON CONFLICT (webhook_event_hash) DO UPDATE SET
         updated_at=nango_sync_jobs.updated_at
       RETURNING id`,
      [cursorId, input.payloadHash, input.orgId, input.integrationId],
    );
    const jobId = jobResult.rows[0]?.id;
    if (!jobId) throw new Error("Nango sync job could not be created");
    return jobId;
  };
  if (client) return work(client);
  return transaction(work);
}

interface JobRow {
  id: string;
  cursor_id: string;
  org_id: string;
  integration_id: string;
  provider_config_key: string;
  connection_id: string;
  nango_environment: string;
  sync_name: string;
  sync_variant: string;
  model: string;
  status: NangoSyncJobStatus;
  attempts: number;
  max_attempts: number;
  records_processed: number;
  pages_processed: number;
  cursor: string | null;
  queued_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  available_at: Date | string;
  last_error_code: string | null;
  locked_by: string | null;
  lease_expires_at: Date | string | null;
}

function jobFromRow(row: JobRow): NangoSyncJob {
  return {
    id: row.id,
    cursorId: row.cursor_id,
    orgId: row.org_id,
    integrationId: row.integration_id,
    providerConfigKey: row.provider_config_key,
    connectionId: row.connection_id,
    nangoEnvironment: row.nango_environment,
    syncName: row.sync_name,
    syncVariant: row.sync_variant,
    model: row.model,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    recordsProcessed: row.records_processed,
    pagesProcessed: row.pages_processed,
    cursor: row.cursor,
    queuedAt: iso(row.queued_at)!,
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    nextAttemptAt:
      row.status === "Queued" || row.status === "Retrying"
        ? iso(row.available_at)
        : null,
    lastErrorCode: row.last_error_code,
    lockedBy: row.locked_by,
    leaseExpiresAt: iso(row.lease_expires_at),
  };
}

const jobColumns = `
  job.id, job.cursor_id, job.org_id, job.integration_id,
  stream.provider_config_key, stream.connection_id, stream.nango_environment,
  stream.sync_name, stream.sync_variant, stream.model,
  job.status, job.attempts, job.max_attempts, job.records_processed,
  job.pages_processed, job.cursor, job.queued_at, job.started_at,
  job.completed_at, job.available_at, job.last_error_code, job.locked_by,
  job.lease_expires_at`;

export async function getNangoSyncStatus(
  orgId: string,
  integrationId: string,
): Promise<NangoSyncStatus | null> {
  if (persistenceMode() !== "postgres") {
    const latest = [...memoryJobs.values()]
      .filter(
        (job) => job.orgId === orgId && job.integrationId === integrationId,
      )
      .sort((a, b) => b.queuedAt.localeCompare(a.queuedAt))[0];
    return latest ? statusFromJob(latest) : null;
  }
  const result = await databasePool().query<JobRow>(
    `SELECT ${jobColumns}
       FROM nango_sync_jobs job
       JOIN nango_sync_cursors stream ON stream.id=job.cursor_id
      WHERE job.org_id=$1 AND job.integration_id=$2
      ORDER BY job.queued_at DESC, job.id DESC
      LIMIT 1`,
    [orgId, integrationId],
  );
  return result.rows[0] ? statusFromJob(jobFromRow(result.rows[0])) : null;
}

export async function claimNextNangoSyncJob(input: {
  workerId: string;
  now?: Date;
  leaseMs?: number;
}): Promise<NangoSyncJob | null> {
  const leaseMs = Math.min(Math.max(input.leaseMs ?? 5 * 60_000, 10_000), 30 * 60_000);
  const workerId = input.workerId.trim().slice(0, 160);
  if (!workerId) throw new Error("A worker ID is required");

  if (persistenceMode() !== "postgres") {
    const now = input.now ?? new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);
    for (const job of memoryJobs.values()) {
      if (
        job.status === "Running" &&
        job.leaseExpiresAt &&
        Date.parse(job.leaseExpiresAt) <= now.getTime() &&
        job.attempts >= job.maxAttempts
      ) {
        job.status = "Failed";
        job.completedAt = now.toISOString();
        job.lockedBy = null;
        job.leaseExpiresAt = null;
      }
    }
    const candidates = [...memoryJobs.values()]
      .filter((job) => {
        const available = Date.parse(job.availableAt) <= now.getTime();
        const stale =
          job.status === "Running" &&
          job.leaseExpiresAt !== null &&
          Date.parse(job.leaseExpiresAt) <= now.getTime();
        const waiting = job.status === "Queued" || job.status === "Retrying";
        if ((!waiting && !stale) || !available || job.attempts >= job.maxAttempts)
          return false;
        return ![...memoryJobs.values()].some(
          (active) =>
            active.id !== job.id &&
            active.cursorId === job.cursorId &&
            active.status === "Running" &&
            active.leaseExpiresAt !== null &&
            Date.parse(active.leaseExpiresAt) > now.getTime(),
        );
      })
      .sort(
        (a, b) =>
          a.queueOrderAt.localeCompare(b.queueOrderAt) ||
          a.queuedAt.localeCompare(b.queuedAt) ||
          a.id.localeCompare(b.id),
      );
    const job = candidates[0];
    if (!job) return null;
    const cursor = [...memoryCursors.values()].find(
      (candidate) => candidate.id === job.cursorId,
    );
    const firstAttempt = job.attempts === 0;
    job.status = "Running";
    job.attempts += 1;
    job.startedAt ??= now.toISOString();
    job.completedAt = null;
    job.lockedBy = workerId;
    job.leaseExpiresAt = leaseExpiresAt.toISOString();
    job.lastErrorCode = null;
    if (firstAttempt) job.cursor = cursor?.cursor ?? null;
    else job.cursor ??= cursor?.cursor ?? null;
    return { ...job };
  }

  return transaction(async (client) => {
    const now =
      input.now ??
      (
        await client.query<{ current_time: Date }>(
          "SELECT clock_timestamp() AS current_time",
        )
      ).rows[0]!.current_time;
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);
    await client.query(
      `UPDATE nango_sync_jobs
          SET status='Failed', completed_at=$1, locked_by=NULL,
              lease_expires_at=NULL, last_error_code='lease_exhausted',
              updated_at=$1
        WHERE status='Running' AND lease_expires_at <= $1
          AND attempts >= max_attempts`,
      [now],
    );
    const candidate = await client.query<{ id: string }>(
      `SELECT job.id
         FROM nango_sync_jobs job
         JOIN nango_sync_cursors stream ON stream.id=job.cursor_id
        WHERE job.available_at <= $1
          AND job.attempts < job.max_attempts
          AND (
            job.status IN ('Queued','Retrying') OR
            (job.status='Running' AND job.lease_expires_at <= $1)
          )
          AND NOT EXISTS (
            SELECT 1 FROM nango_sync_jobs active
             WHERE active.cursor_id=job.cursor_id AND active.id<>job.id
               AND active.status='Running' AND active.lease_expires_at > $1
          )
        ORDER BY job.queue_order_at, job.queued_at, job.id
        FOR UPDATE OF job, stream SKIP LOCKED
        LIMIT 1`,
      [now],
    );
    const id = candidate.rows[0]?.id;
    if (!id) return null;
    await client.query(
      `UPDATE nango_sync_jobs job
          SET status='Running', attempts=attempts+1,
              started_at=coalesce(started_at,$2), completed_at=NULL,
              locked_by=$3, lease_expires_at=$4,
              last_error_code=NULL,
              cursor=CASE WHEN job.attempts=0 THEN stream.cursor
                          ELSE coalesce(job.cursor,stream.cursor) END,
              updated_at=$2
         FROM nango_sync_cursors stream
        WHERE job.id=$1 AND stream.id=job.cursor_id`,
      [id, now, workerId, leaseExpiresAt],
    );
    const claimed = await client.query<JobRow>(
      `SELECT ${jobColumns}
         FROM nango_sync_jobs job
         JOIN nango_sync_cursors stream ON stream.id=job.cursor_id
        WHERE job.id=$1`,
      [id],
    );
    return claimed.rows[0] ? jobFromRow(claimed.rows[0]) : null;
  });
}

function ensureMemoryLease(
  jobId: string,
  workerId: string,
  now: Date,
): MemoryJob {
  const job = memoryJobs.get(jobId);
  if (
    !job ||
    job.status !== "Running" ||
    job.lockedBy !== workerId ||
    !job.leaseExpiresAt ||
    Date.parse(job.leaseExpiresAt) <= now.getTime()
  ) {
    throw new Error("Nango sync job lease is no longer owned by this worker");
  }
  return job;
}

export async function applyNangoSyncPage(input: {
  jobId: string;
  workerId: string;
  records: NormalizedFeedbackRecord[];
  fetchedCount: number;
  pageCursor: string | null;
  now?: Date;
  leaseMs?: number;
}): Promise<void> {
  const leaseMs = Math.min(Math.max(input.leaseMs ?? 5 * 60_000, 10_000), 30 * 60_000);
  if (persistenceMode() !== "postgres") {
    const now = input.now ?? new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);
    const job = ensureMemoryLease(input.jobId, input.workerId, now);
    const stream = [...memoryCursors.values()].find(
      (cursor) => cursor.id === job.cursorId,
    );
    if (!stream) throw new Error("Nango sync cursor was not found");
    for (const record of input.records) {
      const receiptKey = `${job.cursorId}\0${record.externalId}`;
      memoryReceipts.set(receiptKey, record);
      const feedbackKey = `${job.orgId}\0${job.integrationId}\0nango:${job.cursorId}\0${record.externalId}`;
      if (record.action === "DELETED") memoryFeedback.delete(feedbackKey);
      else if (record.feedback) memoryFeedback.set(feedbackKey, record.feedback);
    }
    const checkpoint = input.pageCursor ?? job.cursor;
    job.cursor = checkpoint;
    stream.cursor = checkpoint;
    job.recordsProcessed += input.fetchedCount;
    job.pagesProcessed += 1;
    job.leaseExpiresAt = leaseExpiresAt.toISOString();
    return;
  }

  await transaction(async (client) => {
    const now =
      input.now ??
      (
        await client.query<{ current_time: Date }>(
          "SELECT clock_timestamp() AS current_time",
        )
      ).rows[0]!.current_time;
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);
    const jobResult = await client.query<{
      cursor_id: string;
      org_id: string;
      integration_id: string;
      cursor: string | null;
    }>(
      `SELECT cursor_id, org_id, integration_id, cursor
         FROM nango_sync_jobs
        WHERE id=$1 AND status='Running' AND locked_by=$2
          AND lease_expires_at > $3
        FOR UPDATE`,
      [input.jobId, input.workerId, now],
    );
    const job = jobResult.rows[0];
    if (!job)
      throw new Error("Nango sync job lease is no longer owned by this worker");

    for (const record of input.records) {
      let feedbackId: string | null = null;
      if (record.action === "DELETED") {
        await client.query(
          `DELETE FROM feedback_items
            WHERE org_id=$1 AND integration_id=$2
              AND source_namespace=$3 AND external_id=$4`,
          [
            job.org_id,
            job.integration_id,
            `nango:${job.cursor_id}`,
            record.externalId,
          ],
        );
      } else if (record.feedback) {
        const feedback = record.feedback;
        const saved = await client.query<{ id: string }>(
          `INSERT INTO feedback_items(
             id, org_id, source, customer_name, account_tier, arr, type,
             severity, redacted, environment, confidence, observed_at, quote,
             integration_id, source_namespace, external_id
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,false,$9,$10,$11,$12,$13,$14,$15
           )
           ON CONFLICT (org_id,integration_id,source_namespace,external_id)
             WHERE external_id IS NOT NULL
           DO UPDATE SET
             source=excluded.source,
             customer_name=excluded.customer_name,
             account_tier=excluded.account_tier,
             arr=excluded.arr,
             type=excluded.type,
             severity=excluded.severity,
             environment=excluded.environment,
             confidence=excluded.confidence,
             observed_at=excluded.observed_at,
             quote=excluded.quote,
             updated_at=now()
           RETURNING id`,
          [
            feedback.id,
            job.org_id,
            feedback.source,
            feedback.customerName,
            feedback.accountTier,
            feedback.arr,
            feedback.type,
            feedback.severity,
            feedback.environment,
            feedback.confidence,
            feedback.observedAt,
            feedback.quote,
            job.integration_id,
            `nango:${job.cursor_id}`,
            record.externalId,
          ],
        );
        feedbackId = saved.rows[0]?.id ?? feedback.id;
      }
      await client.query(
        `INSERT INTO nango_sync_record_receipts(
           cursor_id, org_id, integration_id, external_id, nango_cursor,
           payload_hash, last_action, outcome, feedback_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (cursor_id,external_id) DO UPDATE SET
           nango_cursor=excluded.nango_cursor,
           payload_hash=excluded.payload_hash,
           last_action=excluded.last_action,
           outcome=excluded.outcome,
           feedback_id=excluded.feedback_id,
           last_processed_at=now()`,
        [
          job.cursor_id,
          job.org_id,
          job.integration_id,
          record.externalId,
          record.nangoCursor,
          record.payloadHash,
          record.action,
          record.outcome,
          feedbackId,
        ],
      );
    }
    const checkpoint = input.pageCursor ?? job.cursor;
    await client.query(
      `UPDATE nango_sync_cursors
          SET cursor=$2, updated_at=$3
        WHERE id=$1`,
      [job.cursor_id, checkpoint, now],
    );
    await client.query(
      `UPDATE nango_sync_jobs
          SET cursor=$2, records_processed=records_processed+$3,
              pages_processed=pages_processed+1, lease_expires_at=$4,
              updated_at=$5
        WHERE id=$1`,
      [input.jobId, checkpoint, input.fetchedCount, leaseExpiresAt, now],
    );
  });
}

export async function completeNangoSyncJob(input: {
  jobId: string;
  workerId: string;
  now?: Date;
}): Promise<void> {
  if (persistenceMode() !== "postgres") {
    const now = input.now ?? new Date();
    const job = ensureMemoryLease(input.jobId, input.workerId, now);
    job.status = "Succeeded";
    job.completedAt = now.toISOString();
    job.nextAttemptAt = null;
    job.lockedBy = null;
    job.leaseExpiresAt = null;
    return;
  }
  await transaction(async (client) => {
    const now =
      input.now ??
      (
        await client.query<{ current_time: Date }>(
          "SELECT clock_timestamp() AS current_time",
        )
      ).rows[0]!.current_time;
    const completed = await client.query<{
      org_id: string;
      integration_id: string;
      cursor_id: string;
    }>(
      `UPDATE nango_sync_jobs
          SET status='Succeeded', completed_at=$3, locked_by=NULL,
              lease_expires_at=NULL, last_error_code=NULL, updated_at=$3
        WHERE id=$1 AND status='Running' AND locked_by=$2
          AND lease_expires_at > $3
        RETURNING org_id,integration_id,cursor_id`,
      [input.jobId, input.workerId, now],
    );
    const job = completed.rows[0];
    if (!job)
      throw new Error("Nango sync job lease is no longer owned by this worker");
    await client.query(
      `UPDATE integration_connections connection
          SET last_sync_status='Success', last_sync_at=$2,
              last_error_code=NULL, updated_at=$2
         FROM nango_sync_cursors stream
        WHERE stream.id=$1
          AND connection.org_id=stream.org_id
          AND connection.integration_id=stream.integration_id
          AND connection.nango_environment=stream.nango_environment
          AND connection.provider_config_key=stream.provider_config_key
          AND connection.connection_id=stream.connection_id`,
      [job.cursor_id, now],
    );
    await client.query(
      `UPDATE integrations SET last_sync_at=$3,error_message=NULL
        WHERE org_id=$1 AND id=$2`,
      [job.org_id, job.integration_id, now],
    );
  });
}

function retryDelay(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 60 * 60_000);
}

export async function failNangoSyncJob(input: {
  jobId: string;
  workerId: string;
  errorCode: string;
  now?: Date;
}): Promise<"Retrying" | "Failed"> {
  const errorCode = safeErrorCode(input.errorCode);
  if (persistenceMode() !== "postgres") {
    const now = input.now ?? new Date();
    const job = memoryJobs.get(input.jobId);
    if (!job || job.status !== "Running" || job.lockedBy !== input.workerId)
      throw new Error("Nango sync job lease is no longer owned by this worker");
    const exhausted = job.attempts >= job.maxAttempts;
    job.status = exhausted ? "Failed" : "Retrying";
    job.lastErrorCode = errorCode;
    job.completedAt = exhausted ? now.toISOString() : null;
    job.availableAt = new Date(
      now.getTime() + retryDelay(job.attempts),
    ).toISOString();
    job.nextAttemptAt = exhausted ? null : job.availableAt;
    job.queueOrderAt = job.availableAt;
    job.lockedBy = null;
    job.leaseExpiresAt = null;
    return job.status;
  }
  return transaction(async (client) => {
    const now =
      input.now ??
      (
        await client.query<{ current_time: Date }>(
          "SELECT clock_timestamp() AS current_time",
        )
      ).rows[0]!.current_time;
    const current = await client.query<{
      attempts: number;
      max_attempts: number;
      cursor_id: string;
      org_id: string;
      integration_id: string;
    }>(
      `SELECT attempts,max_attempts,cursor_id,org_id,integration_id
         FROM nango_sync_jobs
        WHERE id=$1 AND status='Running' AND locked_by=$2
        FOR UPDATE`,
      [input.jobId, input.workerId],
    );
    const job = current.rows[0];
    if (!job)
      throw new Error("Nango sync job lease is no longer owned by this worker");
    const exhausted = job.attempts >= job.max_attempts;
    const status = exhausted ? "Failed" : "Retrying";
    const availableAt = new Date(now.getTime() + retryDelay(job.attempts));
    await client.query(
      `UPDATE nango_sync_jobs
          SET status=$3, available_at=$4, completed_at=$5,
              locked_by=NULL, lease_expires_at=NULL,
              last_error_code=$6, updated_at=$7, queue_order_at=$4
        WHERE id=$1 AND locked_by=$2`,
      [
        input.jobId,
        input.workerId,
        status,
        availableAt,
        exhausted ? now : null,
        errorCode,
        now,
      ],
    );
    if (exhausted) {
      await client.query(
        `UPDATE integration_connections connection
            SET last_sync_status='Failed', last_error_code=$2, updated_at=$3
           FROM nango_sync_cursors stream
          WHERE stream.id=$1
            AND connection.org_id=stream.org_id
            AND connection.integration_id=stream.integration_id
            AND connection.nango_environment=stream.nango_environment
            AND connection.provider_config_key=stream.provider_config_key
            AND connection.connection_id=stream.connection_id`,
        [job.cursor_id, errorCode, now],
      );
      await client.query(
        `UPDATE integrations
            SET error_message='Feedback import is delayed. Feelow will retry after the connector is available.'
          WHERE org_id=$1 AND id=$2`,
        [job.org_id, job.integration_id],
      );
    }
    return status;
  });
}

export async function yieldNangoSyncJob(input: {
  jobId: string;
  workerId: string;
  now?: Date;
}): Promise<void> {
  if (persistenceMode() !== "postgres") {
    const now = input.now ?? new Date();
    const job = memoryJobs.get(input.jobId);
    if (!job || job.status !== "Running" || job.lockedBy !== input.workerId)
      throw new Error("Nango sync job lease is no longer owned by this worker");
    job.status = "Queued";
    job.attempts = Math.max(0, job.attempts - 1);
    job.availableAt = now.toISOString();
    job.queueOrderAt = now.toISOString();
    job.nextAttemptAt = now.toISOString();
    job.lockedBy = null;
    job.leaseExpiresAt = null;
    return;
  }
  await transaction(async (client) => {
    const now =
      input.now ??
      (
        await client.query<{ current_time: Date }>(
          "SELECT clock_timestamp() AS current_time",
        )
      ).rows[0]!.current_time;
    const result = await client.query(
      `UPDATE nango_sync_jobs
          SET status='Queued', attempts=greatest(attempts-1,0),
              available_at=$3, queue_order_at=$3, locked_by=NULL,
              lease_expires_at=NULL, updated_at=$3
        WHERE id=$1 AND status='Running' AND locked_by=$2`,
      [input.jobId, input.workerId, now],
    );
    if (!result.rowCount)
      throw new Error("Nango sync job lease is no longer owned by this worker");
  });
}

export function resetNangoSyncMemoryState(): void {
  if (process.env.NODE_ENV !== "test") return;
  memoryCursors.clear();
  memoryJobs.clear();
  memoryReceipts.clear();
  memoryFeedback.clear();
}
