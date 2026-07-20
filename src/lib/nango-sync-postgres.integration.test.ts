import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { databasePool } from "./db";
import {
  claimNextNangoSyncJob,
  enqueueNangoSyncJob,
  getNangoSyncStatus,
} from "./nango-sync-repository";
import { runNangoSyncJob, type NangoRecordsClient } from "./nango-sync-worker";

const enabled =
  process.env.RUN_POSTGRES_INTEGRATION_TESTS === "true" &&
  process.env.PERSISTENCE_MODE === "postgres" &&
  Boolean(process.env.DATABASE_URL);

const describePostgres = enabled ? describe : describe.skip;

describePostgres("Nango PostgreSQL ingestion", () => {
  const suffix = randomUUID().replaceAll("-", "");
  const orgId = `org_sync_${suffix}`;
  const integrationId = "int_zendesk";
  const providerConfigKey = "zendesk";
  const connectionId = `connection_${suffix}`;
  const stream = {
    orgId,
    integrationId,
    providerConfigKey,
    connectionId,
    nangoEnvironment: "DEV",
    syncName: "zendesk-tickets",
    syncVariant: "",
    model: "Ticket",
  };

  function payloadHash(label: string): string {
    return createHash("sha256").update(`${suffix}:${label}`).digest("hex");
  }

  async function insertWebhookEvent(hash: string) {
    await databasePool().query(
      `INSERT INTO nango_webhook_events(
         payload_hash,event_type,operation,org_id,integration_id,
         provider_config_key,connection_id,processed_at,outcome
       ) VALUES ($1,'sync',$2,$3,$4,$5,$6,now(),'Processed')`,
      [
        hash,
        stream.syncName,
        orgId,
        integrationId,
        providerConfigKey,
        connectionId,
      ],
    );
  }

  beforeAll(async () => {
    await databasePool().query(
      "INSERT INTO organizations(id,name) VALUES ($1,$2)",
      [orgId, "Nango sync integration test"],
    );
    await databasePool().query(
      `INSERT INTO integrations(
         id,org_id,provider,category,connection_state,data_scope,
         permissions,display_order
       ) VALUES ($1,$2,'Zendesk','Feedback','Connected','Test records','[]',1)`,
      [integrationId, orgId],
    );
  });

  afterAll(async () => {
    await databasePool().query("DELETE FROM organizations WHERE id=$1", [orgId]);
  });

  it("commits a cursor, upserts feedback, and applies a later deletion", async () => {
    const firstHash = payloadHash("first");
    await insertWebhookEvent(firstHash);
    await enqueueNangoSyncJob({ ...stream, payloadHash: firstHash });
    const queued = await databasePool().query<{
      status: string;
      attempts: number;
      database_ready: boolean;
    }>(
      `SELECT status,attempts,available_at <= now() AS database_ready
         FROM nango_sync_jobs WHERE org_id=$1`,
      [orgId],
    );
    expect(queued.rows).toEqual([
      {
        status: "Queued",
        attempts: 0,
        database_ready: true,
      },
    ]);
    const firstJob = await claimNextNangoSyncJob({ workerId: suffix });
    expect(firstJob).not.toBeNull();

    const firstClient: NangoRecordsClient = {
      listRecords: vi.fn().mockResolvedValue({
        records: [
          {
            id: "ticket-42",
            ticket: { description: "CSV export fails for large reports" },
            requester: { name: "Ada Customer" },
            priority: "high",
            _nango_metadata: {
              last_action: "ADDED",
              cursor: "cursor-one",
              last_modified_at: "2026-07-20T10:00:00.000Z",
            },
          },
        ],
        next_cursor: null,
      }),
    };
    const firstOutcome = await runNangoSyncJob({
      job: firstJob!,
      workerId: suffix,
      nango: firstClient,
    });
    expect(firstOutcome).toEqual({
      status: "Succeeded",
      recordsProcessed: 1,
    });

    const imported = await databasePool().query<{
      external_id: string;
      source_namespace: string;
      source: string;
      quote: string;
    }>(
      `SELECT external_id,source_namespace,source,quote FROM feedback_items
        WHERE org_id=$1 AND integration_id=$2`,
      [orgId, integrationId],
    );
    expect(imported.rows).toEqual([
      {
        external_id: "ticket-42",
        source_namespace: `nango:${firstJob!.cursorId}`,
        source: "Zendesk",
        quote: "CSV export fails for large reports",
      },
    ]);
    expect(await getNangoSyncStatus(orgId, integrationId)).toEqual(
      expect.objectContaining({
        status: "Succeeded",
        recordsProcessed: 1,
        pagesProcessed: 1,
      }),
    );

    const commentStream = {
      ...stream,
      syncName: "zendesk-comments",
      model: "Comment",
    };
    const commentHash = payloadHash("comment");
    await insertWebhookEvent(commentHash);
    await enqueueNangoSyncJob({ ...commentStream, payloadHash: commentHash });
    const commentJob = await claimNextNangoSyncJob({ workerId: suffix });
    await runNangoSyncJob({
      job: commentJob!,
      workerId: suffix,
      nango: {
        listRecords: vi.fn().mockResolvedValue({
          records: [
            {
              id: "ticket-42",
              body: "A comment with an ID reused by the Ticket model",
              _nango_metadata: {
                last_action: "ADDED",
                cursor: "comment-cursor-one",
              },
            },
          ],
          next_cursor: null,
        }),
      },
    });
    const namespaced = await databasePool().query<{
      source_namespace: string;
    }>(
      `SELECT source_namespace FROM feedback_items
        WHERE org_id=$1 AND integration_id=$2 AND external_id='ticket-42'
        ORDER BY source_namespace`,
      [orgId, integrationId],
    );
    expect(namespaced.rows.map((row) => row.source_namespace)).toEqual(
      [firstJob, commentJob]
        .map((job) => `nango:${job!.cursorId}`)
        .sort(),
    );

    const deleteHash = payloadHash("delete");
    await insertWebhookEvent(deleteHash);
    await enqueueNangoSyncJob({ ...stream, payloadHash: deleteHash });
    const deleteJob = await claimNextNangoSyncJob({ workerId: suffix });
    expect(deleteJob?.cursor).toBe("cursor-one");
    const deleteRecords = vi.fn<NangoRecordsClient["listRecords"]>().mockResolvedValue({
      records: [
        {
          id: "ticket-42",
          _nango_metadata: {
            last_action: "DELETED",
            cursor: "cursor-two",
          },
        },
      ],
      next_cursor: null,
    });
    await runNangoSyncJob({
      job: deleteJob!,
      workerId: suffix,
      nango: { listRecords: deleteRecords },
    });
    expect(deleteRecords).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "cursor-one" }),
    );
    const remaining = await databasePool().query<{ count: number }>(
      `SELECT count(*)::int count FROM feedback_items
        WHERE org_id=$1 AND integration_id=$2`,
      [orgId, integrationId],
    );
    expect(remaining.rows[0]?.count).toBe(1);
  });
});
