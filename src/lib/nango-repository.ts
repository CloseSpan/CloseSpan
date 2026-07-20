import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { databasePool, persistenceMode, transaction } from "./db";
import {
  enqueueNangoSyncJob,
  resetNangoSyncMemoryState,
} from "./nango-sync-repository";

export const NANGO_TAGS = {
  attemptId: "feelow_attempt_id",
  integrationId: "feelow_integration_id",
  organizationId: "organization_id",
  endUserId: "end_user_id",
  endUserEmail: "end_user_email",
  endUserDisplayName: "end_user_display_name",
} as const;

type AttemptState = "Pending" | "Connected" | "Failed" | "Expired";
export type NangoConnectionState =
  | "Connected"
  | "Needs reconnect"
  | "Disconnected";
export type NangoWebhookResult = "processed" | "duplicate" | "ignored";

export class NangoConnectionInProgressError extends Error {
  constructor() {
    super("A connection is already in progress.");
    this.name = "NangoConnectionInProgressError";
  }
}

export interface NangoConnectionAttempt {
  id: string;
  orgId: string;
  integrationId: string;
  providerConfigKey: string;
  nangoEnvironment: string;
  actorId: string;
  actorName: string;
  actorEmail: string;
  idempotencyKey: string;
  state: AttemptState;
  expiresAt: Date;
  traceId: string;
  reused: boolean;
}

export interface NangoConnectionStatus {
  integrationId: string;
  state: NangoConnectionState;
  providerConfigKey: string;
  lastSyncStatus: "Never" | "Running" | "Success" | "Failed";
  lastSyncAt: string | null;
  lastErrorCode: string | null;
}

interface MemoryConnection extends NangoConnectionStatus {
  orgId: string;
  attemptId: string;
  connectionId: string;
  provider: string;
  nangoEnvironment: string;
}

const memoryAttempts = new Map<string, NangoConnectionAttempt>();
const memoryConnections = new Map<string, MemoryConnection>();
const memoryWebhookEvents = new Set<string>();

function memoryConnectionKey(orgId: string, integrationId: string): string {
  return `${orgId}\0${integrationId}`;
}

function safeErrorCode(value: string | undefined): string {
  const normalized = (value ?? "nango_error")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return normalized || "nango_error";
}

function tag(tags: Record<string, string>, key: string): string | null {
  const value = tags[key]?.trim();
  return value ? value : null;
}

function tagsMatchAttempt(
  attempt: NangoConnectionAttempt,
  tags: Record<string, string>,
): boolean {
  return (
    tag(tags, NANGO_TAGS.attemptId) === attempt.id &&
    tag(tags, NANGO_TAGS.integrationId) === attempt.integrationId &&
    tag(tags, NANGO_TAGS.organizationId) === attempt.orgId &&
    tag(tags, NANGO_TAGS.endUserId) ===
      `${attempt.orgId}:${attempt.actorId}` &&
    tag(tags, NANGO_TAGS.endUserEmail) === attempt.actorEmail &&
    tag(tags, NANGO_TAGS.endUserDisplayName) === attempt.actorName
  );
}

export async function createNangoConnectionAttempt(input: {
  orgId: string;
  integrationId: string;
  providerConfigKey: string;
  nangoEnvironment: string;
  actorId: string;
  actorName: string;
  actorEmail: string;
  idempotencyKey: string;
  traceId: string;
  expiresAt: Date;
}): Promise<NangoConnectionAttempt> {
  const attempt: NangoConnectionAttempt = {
    id: randomUUID(),
    ...input,
    state: "Pending",
    reused: false,
  };
  if (persistenceMode() !== "postgres") {
    for (const current of memoryAttempts.values()) {
      if (
        current.orgId === input.orgId &&
        current.integrationId === input.integrationId &&
        current.state === "Pending"
      ) {
        if (current.expiresAt.getTime() <= Date.now()) {
          current.state = "Expired";
          continue;
        }
        if (
          current.idempotencyKey === input.idempotencyKey &&
          current.providerConfigKey === input.providerConfigKey &&
          current.nangoEnvironment === input.nangoEnvironment &&
          current.actorId === input.actorId
        ) {
          return { ...current, reused: true };
        }
        throw new NangoConnectionInProgressError();
      }
    }
    memoryAttempts.set(attempt.id, attempt);
    return attempt;
  }

  return transaction(async (client) => {
    await client.query(
      `SELECT 1 FROM integrations
        WHERE org_id=$1 AND id=$2
        FOR UPDATE`,
      [input.orgId, input.integrationId],
    );
    await client.query(
      `UPDATE integration_connection_attempts
          SET state='Expired', updated_at=now()
        WHERE org_id=$1 AND integration_id=$2 AND state='Pending'
          AND expires_at <= now()`,
      [input.orgId, input.integrationId],
    );
    const pending = await client.query<{
      id: string;
      org_id: string;
      integration_id: string;
      provider_config_key: string;
      nango_environment: string;
      actor_id: string;
      actor_name: string;
      actor_email: string;
      idempotency_key: string;
      state: AttemptState;
      expires_at: Date;
    }>(
      `SELECT id, org_id, integration_id, provider_config_key,
              nango_environment, actor_id, actor_name, actor_email,
              idempotency_key, state, expires_at
         FROM integration_connection_attempts
        WHERE org_id=$1 AND integration_id=$2 AND state='Pending'
        FOR UPDATE`,
      [input.orgId, input.integrationId],
    );
    const current = pending.rows[0];
    if (current) {
      if (
        current.idempotency_key === input.idempotencyKey &&
        current.provider_config_key === input.providerConfigKey &&
        current.nango_environment === input.nangoEnvironment &&
        current.actor_id === input.actorId
      ) {
        return {
          ...attemptFromRow(current),
          idempotencyKey: current.idempotency_key,
          reused: true,
        };
      }
      throw new NangoConnectionInProgressError();
    }
    await client.query(
      `INSERT INTO integration_connection_attempts(
         id, org_id, integration_id, provider_config_key, nango_environment,
         actor_id, actor_name, actor_email, idempotency_key, state, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Pending',$10)`,
      [
        attempt.id,
        input.orgId,
        input.integrationId,
        input.providerConfigKey,
        input.nangoEnvironment,
        input.actorId,
        input.actorName,
        input.actorEmail,
        input.idempotencyKey,
        input.expiresAt,
      ],
    );
    await client.query(
      `INSERT INTO audit_events(
         id, org_id, actor_id, actor_name, action, entity_type, entity_id, trace_id
       ) VALUES ($1,$2,$3,$4,$5,'Integration',$6,$7)
       ON CONFLICT (org_id,trace_id,action) DO NOTHING`,
      [
        randomUUID(),
        input.orgId,
        input.actorId,
        input.actorName,
        `Started ${input.integrationId} connection through Nango`,
        input.integrationId,
        input.traceId,
      ],
    );
    return attempt;
  });
}

export async function failNangoConnectionAttempt(input: {
  attemptId: string;
  orgId: string;
  errorCode: string;
}): Promise<void> {
  const code = safeErrorCode(input.errorCode);
  if (persistenceMode() !== "postgres") {
    const attempt = memoryAttempts.get(input.attemptId);
    if (attempt?.orgId === input.orgId && attempt.state === "Pending")
      attempt.state = "Failed";
    return;
  }
  await databasePool().query(
    `UPDATE integration_connection_attempts
        SET state='Failed', error_code=$3, updated_at=now()
      WHERE id=$1 AND org_id=$2 AND state='Pending'`,
    [input.attemptId, input.orgId, code],
  );
}

function attemptFromRow(row: {
  id: string;
  org_id: string;
  integration_id: string;
  provider_config_key: string;
  nango_environment: string;
  actor_id: string;
  actor_name: string;
  actor_email: string;
  idempotency_key?: string;
  state: AttemptState;
  expires_at: Date;
}): NangoConnectionAttempt {
  return {
    id: row.id,
    orgId: row.org_id,
    integrationId: row.integration_id,
    providerConfigKey: row.provider_config_key,
    nangoEnvironment: row.nango_environment,
    actorId: row.actor_id,
    actorName: row.actor_name,
    actorEmail: row.actor_email,
    idempotencyKey: row.idempotency_key ?? "",
    state: row.state,
    expiresAt: row.expires_at,
    traceId: "",
    reused: false,
  };
}

async function claimWebhookEvent(
  client: PoolClient,
  input: {
    payloadHash: string;
    eventType: string;
    operation?: string;
    orgId: string;
    integrationId: string;
    providerConfigKey: string;
    connectionId: string;
  },
): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO nango_webhook_events(
       payload_hash, event_type, operation, org_id, integration_id,
       provider_config_key, connection_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (payload_hash) DO NOTHING
     RETURNING payload_hash`,
    [
      input.payloadHash,
      input.eventType.slice(0, 80),
      input.operation?.slice(0, 80) ?? null,
      input.orgId,
      input.integrationId,
      input.providerConfigKey,
      input.connectionId,
    ],
  );
  return result.rowCount === 1;
}

async function completeWebhookEvent(
  client: PoolClient,
  payloadHash: string,
): Promise<void> {
  await client.query(
    `UPDATE nango_webhook_events
        SET processed_at=now(), outcome='Processed'
      WHERE payload_hash=$1`,
    [payloadHash],
  );
}

export async function reconcileNangoAuthEvent(input: {
  payloadHash: string;
  operation: "creation" | "override";
  providerConfigKey: string;
  connectionId: string;
  provider: string;
  nangoEnvironment: string;
  tags: Record<string, string>;
}): Promise<NangoWebhookResult> {
  const attemptId = tag(input.tags, NANGO_TAGS.attemptId);
  const orgId = tag(input.tags, NANGO_TAGS.organizationId);
  if (!attemptId || !orgId) return "ignored";

  if (persistenceMode() !== "postgres") {
    const attempt = memoryAttempts.get(attemptId);
    if (
      !attempt ||
      attempt.orgId !== orgId ||
      attempt.providerConfigKey !== input.providerConfigKey ||
      attempt.nangoEnvironment !== input.nangoEnvironment ||
      !tagsMatchAttempt(attempt, input.tags)
    ) {
      return "ignored";
    }
    if (memoryWebhookEvents.has(input.payloadHash)) return "duplicate";
    if (attempt.state !== "Pending") return "ignored";
    if (attempt.expiresAt.getTime() <= Date.now()) {
      attempt.state = "Expired";
      return "ignored";
    }
    const existingOwner = [...memoryConnections.values()].find(
      (connection) =>
        connection.nangoEnvironment === input.nangoEnvironment &&
        connection.providerConfigKey === input.providerConfigKey &&
        connection.connectionId === input.connectionId,
    );
    if (
      existingOwner &&
      (existingOwner.orgId !== orgId ||
        existingOwner.integrationId !== attempt.integrationId)
    ) {
      return "ignored";
    }
    memoryWebhookEvents.add(input.payloadHash);
    attempt.state = "Connected";
    memoryConnections.set(memoryConnectionKey(orgId, attempt.integrationId), {
      orgId,
      integrationId: attempt.integrationId,
      attemptId: attempt.id,
      providerConfigKey: input.providerConfigKey,
      connectionId: input.connectionId,
      provider: input.provider,
      nangoEnvironment: input.nangoEnvironment,
      state: "Connected",
      lastSyncStatus: "Never",
      lastSyncAt: null,
      lastErrorCode: null,
    });
    return "processed";
  }

  return transaction(async (client) => {
    const result = await client.query<{
      id: string;
      org_id: string;
      integration_id: string;
      provider_config_key: string;
      nango_environment: string;
      actor_id: string;
      actor_name: string;
      actor_email: string;
      state: AttemptState;
      expires_at: Date;
    }>(
      `SELECT id, org_id, integration_id, provider_config_key,
              nango_environment, actor_id, actor_name, actor_email,
              state, expires_at
         FROM integration_connection_attempts
        WHERE id=$1 AND org_id=$2
        FOR UPDATE`,
      [attemptId, orgId],
    );
    const row = result.rows[0];
    if (!row) return "ignored";
    const attempt = attemptFromRow(row);
    if (
      attempt.providerConfigKey !== input.providerConfigKey ||
      attempt.nangoEnvironment !== input.nangoEnvironment ||
      !tagsMatchAttempt(attempt, input.tags)
    ) {
      return "ignored";
    }
    const duplicate = await client.query(
      "SELECT 1 FROM nango_webhook_events WHERE payload_hash=$1",
      [input.payloadHash],
    );
    if (duplicate.rowCount) return "duplicate";
    if (attempt.state !== "Pending") return "ignored";
    if (attempt.expiresAt.getTime() <= Date.now()) {
      await client.query(
        `UPDATE integration_connection_attempts
            SET state='Expired', updated_at=now()
          WHERE id=$1`,
        [attempt.id],
      );
      return "ignored";
    }
    const ownerResult = await client.query<{
      org_id: string;
      integration_id: string;
    }>(
      `SELECT org_id, integration_id
         FROM integration_connections
        WHERE nango_environment=$1 AND provider_config_key=$2
          AND connection_id=$3
        FOR UPDATE`,
      [
        input.nangoEnvironment,
        input.providerConfigKey,
        input.connectionId,
      ],
    );
    const existingOwner = ownerResult.rows[0];
    if (
      existingOwner &&
      (existingOwner.org_id !== orgId ||
        existingOwner.integration_id !== attempt.integrationId)
    ) {
      return "ignored";
    }
    const claimed = await claimWebhookEvent(client, {
      payloadHash: input.payloadHash,
      eventType: "auth",
      operation: input.operation,
      orgId,
      integrationId: attempt.integrationId,
      providerConfigKey: input.providerConfigKey,
      connectionId: input.connectionId,
    });
    if (!claimed) return "duplicate";

    await client.query(
      `INSERT INTO integration_connections(
         org_id, integration_id, attempt_id, provider_config_key,
         connection_id, provider, nango_environment, state, connected_by,
         last_sync_status, last_error_code
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'Connected',$8,'Never',NULL)
       ON CONFLICT (org_id,integration_id) DO UPDATE SET
         attempt_id=excluded.attempt_id,
         provider_config_key=excluded.provider_config_key,
         connection_id=excluded.connection_id,
         provider=excluded.provider,
         nango_environment=excluded.nango_environment,
         state='Connected',
         connected_by=excluded.connected_by,
         last_error_code=NULL,
         updated_at=now()`,
      [
        orgId,
        attempt.integrationId,
        attempt.id,
        input.providerConfigKey,
        input.connectionId,
        input.provider,
        input.nangoEnvironment,
        attempt.actorId,
      ],
    );
    await client.query(
      `UPDATE integration_connection_attempts
          SET state='Connected', error_code=NULL, updated_at=now()
        WHERE id=$1`,
      [attempt.id],
    );
    await client.query(
      `UPDATE integrations
          SET connection_state='Connected',
              data_scope='Authorized through Nango; sync configured separately',
              permissions='["credentials:managed_by_nango"]'::jsonb,
              error_message=NULL
        WHERE org_id=$1 AND id=$2`,
      [orgId, attempt.integrationId],
    );
    await client.query(
      `INSERT INTO audit_events(
         id, org_id, actor_id, actor_name, action, entity_type, entity_id, trace_id
       ) VALUES ($1,$2,$3,$4,$5,'Integration',$6,$7)
       ON CONFLICT (org_id,trace_id,action) DO NOTHING`,
      [
        randomUUID(),
        orgId,
        attempt.actorId,
        attempt.actorName,
        `Connected ${attempt.integrationId} through Nango`,
        attempt.integrationId,
        `nango_auth_${input.providerConfigKey}_${input.connectionId}`.slice(0, 240),
      ],
    );
    await completeWebhookEvent(client, input.payloadHash);
    return "processed";
  });
}

export async function markNangoConnectionNeedsReconnect(input: {
  payloadHash: string;
  providerConfigKey: string;
  connectionId: string;
  nangoEnvironment: string;
  errorCode?: string;
}): Promise<NangoWebhookResult> {
  const code = safeErrorCode(input.errorCode ?? "credentials_refresh_failed");
  if (persistenceMode() !== "postgres") {
    const connection = [...memoryConnections.values()].find(
      (item) =>
        item.providerConfigKey === input.providerConfigKey &&
        item.connectionId === input.connectionId &&
        item.nangoEnvironment === input.nangoEnvironment,
    );
    if (!connection) return "ignored";
    if (memoryWebhookEvents.has(input.payloadHash)) return "duplicate";
    memoryWebhookEvents.add(input.payloadHash);
    connection.state = "Needs reconnect";
    connection.lastErrorCode = code;
    return "processed";
  }

  return transaction(async (client) => {
    const result = await client.query<{
      org_id: string;
      integration_id: string;
    }>(
      `SELECT org_id, integration_id
         FROM integration_connections
        WHERE provider_config_key=$1 AND connection_id=$2
          AND nango_environment=$3
        FOR UPDATE`,
      [input.providerConfigKey, input.connectionId, input.nangoEnvironment],
    );
    const connection = result.rows[0];
    if (!connection) return "ignored";
    const claimed = await claimWebhookEvent(client, {
      payloadHash: input.payloadHash,
      eventType: "auth",
      operation: "refresh",
      orgId: connection.org_id,
      integrationId: connection.integration_id,
      providerConfigKey: input.providerConfigKey,
      connectionId: input.connectionId,
    });
    if (!claimed) return "duplicate";
    await client.query(
      `UPDATE integration_connections
          SET state='Needs reconnect', last_error_code=$4, updated_at=now()
        WHERE provider_config_key=$1 AND connection_id=$2
          AND nango_environment=$3`,
      [
        input.providerConfigKey,
        input.connectionId,
        input.nangoEnvironment,
        code,
      ],
    );
    await client.query(
      `UPDATE integrations
          SET connection_state='Needs reconnect',
              error_message='Reconnect this integration to restore access.'
        WHERE org_id=$1 AND id=$2`,
      [connection.org_id, connection.integration_id],
    );
    await completeWebhookEvent(client, input.payloadHash);
    return "processed";
  });
}

export async function updateNangoSyncState(input: {
  payloadHash: string;
  providerConfigKey: string;
  connectionId: string;
  nangoEnvironment: string;
  syncName: string;
  syncVariant: string;
  model: string;
  modifiedAfter?: string;
  success: boolean;
  completedAt?: Date;
  errorCode?: string;
}): Promise<NangoWebhookResult> {
  const syncStatus = input.success ? "Success" : "Failed";
  const errorCode = input.success
    ? null
    : safeErrorCode(input.errorCode ?? "sync_failed");
  const completedAt = input.completedAt ?? new Date();
  if (persistenceMode() !== "postgres") {
    const connection = [...memoryConnections.values()].find(
      (item) =>
        item.providerConfigKey === input.providerConfigKey &&
        item.connectionId === input.connectionId &&
        item.nangoEnvironment === input.nangoEnvironment,
    );
    if (!connection) return "ignored";
    if (memoryWebhookEvents.has(input.payloadHash)) return "duplicate";
    memoryWebhookEvents.add(input.payloadHash);
    connection.lastSyncStatus = syncStatus;
    connection.lastSyncAt = input.success ? completedAt.toISOString() : null;
    connection.lastErrorCode = errorCode;
    if (input.success) {
      await enqueueNangoSyncJob({
        payloadHash: input.payloadHash,
        orgId: connection.orgId,
        integrationId: connection.integrationId,
        providerConfigKey: input.providerConfigKey,
        connectionId: input.connectionId,
        nangoEnvironment: input.nangoEnvironment,
        syncName: input.syncName,
        syncVariant: input.syncVariant,
        model: input.model,
        modifiedAfter: input.modifiedAfter,
      });
    }
    return "processed";
  }

  return transaction(async (client) => {
    const result = await client.query<{
      org_id: string;
      integration_id: string;
    }>(
      `SELECT org_id, integration_id
         FROM integration_connections
        WHERE provider_config_key=$1 AND connection_id=$2
          AND nango_environment=$3
        FOR UPDATE`,
      [input.providerConfigKey, input.connectionId, input.nangoEnvironment],
    );
    const connection = result.rows[0];
    if (!connection) return "ignored";
    const claimed = await claimWebhookEvent(client, {
      payloadHash: input.payloadHash,
      eventType: "sync",
      operation: input.syncName,
      orgId: connection.org_id,
      integrationId: connection.integration_id,
      providerConfigKey: input.providerConfigKey,
      connectionId: input.connectionId,
    });
    if (!claimed) return "duplicate";
    await client.query(
      `UPDATE integration_connections
          SET last_sync_status=$4,
              last_sync_at=CASE WHEN $5 THEN $6 ELSE last_sync_at END,
              last_error_code=$7,
              updated_at=now()
        WHERE provider_config_key=$1 AND connection_id=$2
          AND nango_environment=$3`,
      [
        input.providerConfigKey,
        input.connectionId,
        input.nangoEnvironment,
        syncStatus,
        input.success,
        completedAt,
        errorCode,
      ],
    );
    await client.query(
      `UPDATE integrations
          SET last_sync_at=CASE WHEN $3 THEN $4 ELSE last_sync_at END,
              error_message=CASE WHEN $3 THEN NULL ELSE 'The last Nango sync failed.' END
        WHERE org_id=$1 AND id=$2`,
      [
        connection.org_id,
        connection.integration_id,
        input.success,
        completedAt,
      ],
    );
    if (input.success) {
      await enqueueNangoSyncJob(
        {
          payloadHash: input.payloadHash,
          orgId: connection.org_id,
          integrationId: connection.integration_id,
          providerConfigKey: input.providerConfigKey,
          connectionId: input.connectionId,
          nangoEnvironment: input.nangoEnvironment,
          syncName: input.syncName,
          syncVariant: input.syncVariant,
          model: input.model,
          modifiedAfter: input.modifiedAfter,
        },
        client,
      );
    }
    await completeWebhookEvent(client, input.payloadHash);
    return "processed";
  });
}

export async function getNangoConnectionStatuses(
  orgId: string,
): Promise<NangoConnectionStatus[]> {
  if (persistenceMode() !== "postgres") {
    return [...memoryConnections.values()]
      .filter((connection) => connection.orgId === orgId)
      .map(
        ({
          integrationId,
          state,
          providerConfigKey,
          lastSyncStatus,
          lastSyncAt,
          lastErrorCode,
        }) => ({
          integrationId,
          state,
          providerConfigKey,
          lastSyncStatus,
          lastSyncAt,
          lastErrorCode,
        }),
      );
  }
  const result = await databasePool().query<{
    integration_id: string;
    state: NangoConnectionState;
    provider_config_key: string;
    last_sync_status: NangoConnectionStatus["lastSyncStatus"];
    last_sync_at: Date | null;
    last_error_code: string | null;
  }>(
    `SELECT integration_id, state, provider_config_key,
            last_sync_status, last_sync_at, last_error_code
       FROM integration_connections
      WHERE org_id=$1
      ORDER BY integration_id`,
    [orgId],
  );
  return result.rows.map((row) => ({
    integrationId: row.integration_id,
    state: row.state,
    providerConfigKey: row.provider_config_key,
    lastSyncStatus: row.last_sync_status,
    lastSyncAt: row.last_sync_at?.toISOString() ?? null,
    lastErrorCode: row.last_error_code,
  }));
}

export async function getNangoConnectionStatus(
  orgId: string,
  integrationId: string,
): Promise<NangoConnectionStatus | null> {
  return (
    (await getNangoConnectionStatuses(orgId)).find(
      (status) => status.integrationId === integrationId,
    ) ?? null
  );
}

export function resetNangoMemoryState(): void {
  if (process.env.NODE_ENV !== "test") return;
  memoryAttempts.clear();
  memoryConnections.clear();
  memoryWebhookEvents.clear();
  resetNangoSyncMemoryState();
}
