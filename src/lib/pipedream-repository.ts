import type { Account } from "@pipedream/sdk";
import type { PoolClient } from "pg";
import { databasePool, transaction } from "./db";
import type { PipedreamConnectorId } from "./pipedream-connectors";
import { workspacePersistenceMode } from "./workspace-persistence";

export type PipedreamConnectionState =
  | "Connected"
  | "Needs reconnect"
  | "Disconnected";

export interface PipedreamConnection {
  integrationId: PipedreamConnectorId;
  accountId: string;
  appSlug: string;
  accountName: string | null;
  state: PipedreamConnectionState;
  healthy: boolean | null;
  authorizedScopes: string[];
  lastImportAt: string | null;
  lastImportStatus: "Running" | "Succeeded" | "Failed" | null;
  lastImportCount: number;
  lastImportError: string | null;
  importCursor: string | null;
}

export interface PipedreamImportClaim {
  importCursor: string | null;
  leaseToken: string;
}

const memory = new Map<string, PipedreamConnection[]>();
const memoryImportGenerations = new Map<string, bigint>();

function memoryImportKey(input: {
  orgId: string;
  integrationId: PipedreamConnectorId;
  accountId: string;
}): string {
  return `${input.orgId}\u0000${input.integrationId}\u0000${input.accountId}`;
}

async function refreshIntegrationConnectionState(
  client: PoolClient,
  orgId: string,
  integrationId: PipedreamConnectorId,
): Promise<void> {
  const remaining = await client.query<{ state: PipedreamConnectionState }>(
    `SELECT state FROM pipedream_connections
      WHERE org_id=$1 AND integration_id=$2 AND state<>'Disconnected'`,
    [orgId, integrationId],
  );
  const connectionState = remaining.rows.some(
    (connection) => connection.state === "Connected",
  )
    ? "Connected"
    : remaining.rows.some(
          (connection) => connection.state === "Needs reconnect",
        )
      ? "Needs reconnect"
      : "Not connected";
  await client.query(
    `UPDATE integrations
        SET connection_state=$3,
            data_scope=CASE WHEN $3='Not connected' THEN 'None' ELSE data_scope END,
            permissions=CASE WHEN $3='Not connected' THEN '[]'::jsonb ELSE permissions END,
            error_message=CASE WHEN $3='Not connected' THEN NULL ELSE error_message END
      WHERE org_id=$1 AND id=$2`,
    [orgId, integrationId, connectionState],
  );
}

export async function savePipedreamAccount(input: {
  orgId: string;
  integrationId: PipedreamConnectorId;
  externalUserId: string;
  actorId: string;
  account: Account;
}): Promise<PipedreamConnection> {
  const connection: PipedreamConnection = {
    integrationId: input.integrationId,
    accountId: input.account.id,
    appSlug: input.account.app?.nameSlug ?? "unknown",
    accountName: input.account.name ?? input.account.externalId ?? null,
    state: input.account.dead || input.account.healthy === false
      ? "Needs reconnect"
      : "Connected",
    healthy: input.account.healthy ?? null,
    authorizedScopes: input.account.authorizedScopes ?? [],
    lastImportAt: null,
    lastImportStatus: null,
    lastImportCount: 0,
    lastImportError: null,
    importCursor: null,
  };
  if (workspacePersistenceMode(input.orgId) !== "postgres") {
    const items = memory.get(input.orgId) ?? [];
    const existing = items.find(
      (item) =>
        item.integrationId === connection.integrationId &&
        item.accountId === connection.accountId,
    );
    const saved = existing
      ? {
          ...connection,
          lastImportAt: existing.lastImportAt,
          lastImportStatus: existing.lastImportStatus,
          lastImportCount: existing.lastImportCount,
          lastImportError: existing.lastImportError,
          importCursor: existing.importCursor,
        }
      : connection;
    memory.set(input.orgId, [
      ...items.filter((item) => item.accountId !== connection.accountId),
      saved,
    ]);
    return saved;
  }
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO pipedream_connections(
         org_id,integration_id,external_user_id,account_id,app_slug,
         account_name,state,healthy,authorized_scopes,connected_by,last_verified_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,now())
       ON CONFLICT(org_id,integration_id,account_id) DO UPDATE SET
         account_name=excluded.account_name,state=excluded.state,
         healthy=excluded.healthy,authorized_scopes=excluded.authorized_scopes,
         last_verified_at=now(),updated_at=now()`,
      [input.orgId,input.integrationId,input.externalUserId,connection.accountId,
       connection.appSlug,connection.accountName,connection.state,connection.healthy,
       JSON.stringify(connection.authorizedScopes),input.actorId],
    );
    await client.query(
      `UPDATE integrations SET connection_state=$3,
          data_scope='Credentials managed by Pipedream Connect',
          permissions=$4::jsonb,error_message=NULL
        WHERE org_id=$1 AND id=$2`,
      [input.orgId,input.integrationId,connection.state,
       JSON.stringify(connection.authorizedScopes)],
    );
  });
  return connection;
}

export async function listPipedreamConnections(
  orgId: string,
): Promise<PipedreamConnection[]> {
  if (workspacePersistenceMode(orgId) !== "postgres")
    return memory.get(orgId) ?? [];
  const result = await databasePool().query<{
    integration_id: PipedreamConnectorId; account_id: string; app_slug: string;
    account_name: string | null; state: PipedreamConnectionState;
    healthy: boolean | null; authorized_scopes: string[];
    last_import_at: Date | null;
    last_import_status: PipedreamConnection["lastImportStatus"];
    last_import_count: number;
    last_import_error: string | null;
    import_cursor: string | null;
  }>(`SELECT integration_id,account_id,app_slug,account_name,state,healthy,
             authorized_scopes,last_import_at,last_import_status,
             last_import_count,last_import_error,import_cursor
        FROM pipedream_connections WHERE org_id=$1 AND state<>'Disconnected'
       ORDER BY updated_at DESC`,[orgId]);
  return result.rows.map((row) => ({
    integrationId: row.integration_id, accountId: row.account_id,
    appSlug: row.app_slug, accountName: row.account_name, state: row.state,
    healthy: row.healthy, authorizedScopes: row.authorized_scopes ?? [],
    lastImportAt: row.last_import_at?.toISOString() ?? null,
    lastImportStatus: row.last_import_status,
    lastImportCount: row.last_import_count ?? 0,
    lastImportError: row.last_import_error,
    importCursor: row.import_cursor,
  }));
}

export async function updatePipedreamImportCursor(
  client: PoolClient | null,
  input: {
    orgId: string;
    integrationId: PipedreamConnectorId;
    accountId: string;
    cursor: string;
    leaseToken: string;
  },
): Promise<void> {
  if (workspacePersistenceMode(input.orgId) !== "postgres") {
    const items = memory.get(input.orgId) ?? [];
    const target = items.find(
      (item) =>
        item.integrationId === input.integrationId &&
        item.accountId === input.accountId,
    );
    if (
      !target ||
      target.state === "Disconnected" ||
      target.lastImportStatus !== "Running" ||
      memoryImportGenerations.get(memoryImportKey(input))?.toString() !==
        input.leaseToken
    ) {
      throw new Error("stale_import_lease");
    }
    memory.set(
      input.orgId,
      items.map((item) => item === target
        ? { ...item, importCursor: input.cursor }
        : item),
    );
    return;
  }
  if (!client) {
    throw new Error("pipedream_cursor_transaction_required");
  }
  const updated = await client.query(
    `UPDATE pipedream_connections
        SET import_cursor=$4,updated_at=now()
      WHERE org_id=$1 AND integration_id=$2 AND account_id=$3
        AND state<>'Disconnected'
        AND last_import_status='Running'
        AND import_generation=$5::bigint
      RETURNING id`,
    [
      input.orgId,
      input.integrationId,
      input.accountId,
      input.cursor,
      input.leaseToken,
    ],
  );
  if (!updated.rowCount) {
    throw new Error("stale_import_lease");
  }
}

export async function reconcilePipedreamAccounts(input: {
  orgId: string;
  integrationId: PipedreamConnectorId;
  upstreamAccountIds: readonly string[];
  verifiedBefore: Date;
}): Promise<void> {
  const upstreamAccountIds = [...new Set(input.upstreamAccountIds)];
  if (workspacePersistenceMode(input.orgId) !== "postgres") {
    const upstream = new Set(upstreamAccountIds);
    const items = memory.get(input.orgId) ?? [];
    memory.set(
      input.orgId,
      items.filter(
        (item) =>
          item.integrationId !== input.integrationId ||
          upstream.has(item.accountId),
      ),
    );
    return;
  }
  await transaction(async (client) => {
    await client.query(
      `UPDATE pipedream_connections
          SET state='Disconnected',healthy=false,updated_at=now()
        WHERE org_id=$1 AND integration_id=$2 AND state<>'Disconnected'
          AND NOT (account_id=ANY($3::text[]))
          AND (last_verified_at IS NULL OR last_verified_at <= $4)`,
      [
        input.orgId,
        input.integrationId,
        upstreamAccountIds,
        input.verifiedBefore,
      ],
    );
    await refreshIntegrationConnectionState(
      client,
      input.orgId,
      input.integrationId,
    );
  });
}

export async function updatePipedreamImportState(input: {
  orgId: string;
  integrationId: PipedreamConnectorId;
  accountId: string;
  status: "Succeeded" | "Failed";
  leaseToken: string;
  count?: number;
  safeError?: string | null;
}): Promise<void> {
  if (workspacePersistenceMode(input.orgId) !== "postgres") {
    const items = memory.get(input.orgId) ?? [];
    const target = items.find(
      (item) =>
        item.integrationId === input.integrationId &&
        item.accountId === input.accountId,
    );
    if (
      !target ||
      target.lastImportStatus !== "Running" ||
      memoryImportGenerations.get(memoryImportKey(input))?.toString() !==
        input.leaseToken
    ) {
      throw new Error("stale_import_lease");
    }
    memory.set(
      input.orgId,
      items.map((item) => item === target
        ? {
            ...item,
            lastImportAt: new Date().toISOString(),
            lastImportStatus: input.status,
            lastImportCount: input.count ?? item.lastImportCount,
            lastImportError: input.safeError ?? null,
          }
        : item),
    );
    return;
  }
  const updated = await databasePool().query(
    `UPDATE pipedream_connections
        SET last_import_status=$4,
            last_import_at=now(),
            last_import_count=COALESCE($5,last_import_count),
            last_import_error=$6,import_claimed_at=NULL,updated_at=now()
      WHERE org_id=$1 AND integration_id=$2 AND account_id=$3
        AND state<>'Disconnected'
        AND last_import_status='Running'
        AND import_generation=$7::bigint
      RETURNING id`,
    [
      input.orgId,
      input.integrationId,
      input.accountId,
      input.status,
      input.count ?? null,
      input.safeError ?? null,
      input.leaseToken,
    ],
  );
  if (!updated.rowCount) {
    throw new Error("stale_import_lease");
  }
}

export async function claimPipedreamImport(input: {
  orgId: string;
  integrationId: PipedreamConnectorId;
  accountId: string;
}): Promise<PipedreamImportClaim | null> {
  if (workspacePersistenceMode(input.orgId) !== "postgres") {
    const items = memory.get(input.orgId) ?? [];
    const target = items.find((item) => item.integrationId === input.integrationId && item.accountId === input.accountId);
    if (!target || target.lastImportStatus === "Running") return null;
    const key = memoryImportKey(input);
    const generation = (memoryImportGenerations.get(key) ?? 0n) + 1n;
    const leaseToken = generation.toString();
    memoryImportGenerations.set(key, generation);
    memory.set(input.orgId, items.map((item) => item === target
      ? {
          ...item,
          lastImportStatus: "Running",
          lastImportError: null,
        }
      : item));
    return { importCursor: target.importCursor, leaseToken };
  }
  const result = await databasePool().query<{
    import_cursor: string | null;
    lease_token: string;
  }>(
    `UPDATE pipedream_connections
        SET last_import_status='Running',last_import_error=NULL,
            import_generation=import_generation + 1,
            import_claimed_at=now(),updated_at=now()
      WHERE org_id=$1 AND integration_id=$2 AND account_id=$3
        AND state='Connected'
        AND (last_import_status IS DISTINCT FROM 'Running'
             OR import_claimed_at IS NULL
             OR import_claimed_at < now() - interval '5 minutes')
      RETURNING import_cursor,import_generation::text AS lease_token`,
    [input.orgId,input.integrationId,input.accountId],
  );
  const claim = result.rows[0];
  return claim
    ? { importCursor: claim.import_cursor, leaseToken: claim.lease_token }
    : null;
}

export async function getPipedreamConnection(
  orgId: string,
  integrationId: PipedreamConnectorId,
  accountId?: string,
): Promise<PipedreamConnection | null> {
  return (
    (await listPipedreamConnections(orgId)).find(
      (item) =>
        item.integrationId === integrationId &&
        (!accountId || item.accountId === accountId),
    ) ?? null
  );
}

export async function disconnectPipedreamAccount(input: {
  orgId: string;
  integrationId: PipedreamConnectorId;
  accountId: string;
}): Promise<boolean> {
  if (workspacePersistenceMode(input.orgId) !== "postgres") {
    const items = memory.get(input.orgId) ?? [];
    const found = items.some((item) => item.accountId === input.accountId);
    memory.set(input.orgId, items.filter((item) => item.accountId !== input.accountId));
    return found;
  }
  return transaction(async (client) => {
    const changed = await client.query(
      `UPDATE pipedream_connections SET state='Disconnected',updated_at=now()
        WHERE org_id=$1 AND integration_id=$2 AND account_id=$3
          AND state<>'Disconnected' RETURNING id`,
      [input.orgId,input.integrationId,input.accountId],
    );
    await refreshIntegrationConnectionState(
      client,
      input.orgId,
      input.integrationId,
    );
    return Boolean(changed.rowCount);
  });
}

export function resetPipedreamMemoryState(): void {
  if (process.env.NODE_ENV === "test") {
    memory.clear();
    memoryImportGenerations.clear();
  }
}
