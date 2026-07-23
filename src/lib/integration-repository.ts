import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  credentialVaultConfigured,
  decryptCredential,
  encryptCredential,
} from "./credential-crypto";
import { databasePool, persistenceMode } from "./db";
import { integrationCatalog } from "./integration-catalog";
import { getAiPublicConfiguration } from "./ai-config";
import { listPipedreamConnections } from "./pipedream-repository";

export interface WorkspaceSetupStatus {
  feedbackConnected: boolean;
  aiConfigured: boolean;
  githubConnected: boolean;
  feedbackCount: number;
  setupComplete: boolean;
  connectedIntegrationIds: string[];
  webhook?: {
    integrationId: string;
    webhookUrl: string;
    connectedAt: string | null;
  };
}

export interface WebhookCreationResult {
  integrationId: string;
  webhookUrl: string;
  signingSecret: string;
}

const WEBHOOK_PROVIDER = "Custom webhook";
const GITHUB_PROVIDER = "GitHub";

type WorkspaceIntegrationSetupRow = {
  id: string;
  provider: string;
  connection_state: string;
  last_sync_at: Date | null;
  webhook_public_id: string | null;
};

function isMissingWebhookPublicIdColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const postgresError = error as {
    code?: unknown;
    column?: unknown;
    message?: unknown;
  };
  if (postgresError.code !== "42703") return false;

  return (
    postgresError.column === "public_id" ||
    (typeof postgresError.message === "string" &&
      postgresError.message.includes("public_id"))
  );
}

async function queryWorkspaceSetupIntegrations(
  pool: ReturnType<typeof databasePool>,
  orgId: string,
) {
  try {
    return await pool.query<WorkspaceIntegrationSetupRow>(
      `SELECT integration.id, integration.provider,
              integration.connection_state, integration.last_sync_at,
              secret.public_id AS webhook_public_id
         FROM integrations integration
         LEFT JOIN integration_webhook_secrets secret
           ON secret.org_id=integration.org_id
          AND secret.integration_id=integration.id
        WHERE integration.org_id=$1`,
      [orgId],
    );
  } catch (error) {
    if (!isMissingWebhookPublicIdColumn(error)) throw error;

    // Older production schemas predate webhook public IDs. Keep the workspace
    // usable while that additive migration is applied; webhook creation still
    // requires the current schema.
    return pool.query<WorkspaceIntegrationSetupRow>(
      `SELECT integration.id, integration.provider,
              integration.connection_state, integration.last_sync_at,
              NULL::text AS webhook_public_id
         FROM integrations integration
        WHERE integration.org_id=$1`,
      [orgId],
    );
  }
}

function encryptWebhookSecret(
  secret: string,
  orgId: string,
  integrationId: string,
): {
  encryptedSecret: string;
  secretIv: string;
  secretAuthTag: string;
  secretHint: string;
  secretFingerprint: string;
} {
  const encrypted = encryptCredential(secret, orgId, integrationId);
  return {
    encryptedSecret: encrypted.ciphertext,
    secretIv: encrypted.iv,
    secretAuthTag: encrypted.authTag,
    secretHint: encrypted.hint,
    secretFingerprint: encrypted.fingerprint,
  };
}

function decryptWebhookSecret(
  orgId: string,
  integrationId: string,
  row: {
    encrypted_secret: string;
    secret_iv: string;
    secret_auth_tag: string;
  },
): string {
  return decryptCredential(
    {
      ciphertext: row.encrypted_secret,
      iv: row.secret_iv,
      authTag: row.secret_auth_tag,
    },
    orgId,
    integrationId,
  );
}

export function buildWebhookUrl(publicId: string): string {
  const base =
    process.env.AUTH_URL?.replace(/\/$/, "") ??
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "http://localhost:3000";
  return `${base}/api/webhooks/${publicId}`;
}

export function signWebhookPayload(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

export function verifyWebhookSignature(
  secret: string,
  body: string,
  signature: string | null,
): boolean {
  if (!signature) return false;
  const expected = signWebhookPayload(secret, body);
  const provided = signature.replace(/^sha256=/, "").trim();
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

export async function ensureIntegrationCatalog(orgId: string): Promise<void> {
  if (persistenceMode() !== "postgres") return;
  const pool = databasePool();
  for (const entry of integrationCatalog) {
    await pool.query(
      `INSERT INTO integrations(
         id, org_id, provider, category, connection_state, data_scope, permissions, display_order
       ) VALUES ($1,$2,$3,$4,'Not connected','None','[]',$5)
       ON CONFLICT (org_id, id) DO NOTHING`,
      [entry.id, orgId, entry.provider, entry.category, entry.displayOrder],
    );
  }
}

export async function getWorkspaceSetupStatus(
  orgId: string,
): Promise<WorkspaceSetupStatus> {
  if (persistenceMode() !== "postgres") {
    const [connections, aiConfig] = await Promise.all([
      listPipedreamConnections(orgId),
      getAiPublicConfiguration(orgId),
    ]);
    const connectedIntegrationIds = connections
      .filter((connection) => connection.state === "Connected")
      .map((connection) => connection.integrationId);
    const feedbackSourceIds = new Set(
      integrationCatalog
        .filter((entry) => entry.feedbackSource)
        .map((entry) => entry.id),
    );
    const feedbackConnected = connectedIntegrationIds.some((id) =>
      feedbackSourceIds.has(id),
    );
    const githubConnected = connectedIntegrationIds.includes("int_github");
    const aiConfigured =
      aiConfig.configured &&
      (aiConfig.connectionStatus === "ready" ||
        aiConfig.connectionStatus === "Environment");
    return {
      feedbackConnected,
      aiConfigured,
      githubConnected,
      feedbackCount: 0,
      setupComplete: feedbackConnected && aiConfigured && githubConnected,
      connectedIntegrationIds,
    };
  }
  await ensureIntegrationCatalog(orgId);
  const pool = databasePool();
  const [feedbackResult, integrationsResult, aiConfig] =
    await Promise.all([
      pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM feedback_items WHERE org_id=$1",
        [orgId],
      ),
      queryWorkspaceSetupIntegrations(pool, orgId),
      getAiPublicConfiguration(orgId),
    ]);

  const feedbackCount = feedbackResult.rows[0]?.count ?? 0;
  const connectedIntegrationIds = integrationsResult.rows
    .filter((row) => row.connection_state === "Connected")
    .map((row) => row.id);
  const webhookRow = integrationsResult.rows.find(
    (row) => row.provider === WEBHOOK_PROVIDER,
  );
  const webhookConnected = webhookRow?.connection_state === "Connected";
  const githubConnected = connectedIntegrationIds.includes("int_github");
  const aiConfigured =
    aiConfig.configured &&
    (aiConfig.connectionStatus === "ready" ||
      aiConfig.connectionStatus === "Environment");

  const feedbackSourceIds = new Set(
    integrationCatalog
      .filter((entry) => entry.feedbackSource)
      .map((entry) => entry.id),
  );
  const feedbackConnected =
    feedbackCount > 0 ||
    connectedIntegrationIds.some((id) => feedbackSourceIds.has(id));

  return {
    feedbackConnected,
    aiConfigured,
    githubConnected,
    feedbackCount,
    setupComplete: feedbackConnected && aiConfigured && githubConnected,
    connectedIntegrationIds,
    webhook: webhookConnected && webhookRow?.webhook_public_id
      ? {
          integrationId: webhookRow.id,
          webhookUrl: buildWebhookUrl(webhookRow.webhook_public_id),
          connectedAt: webhookRow.last_sync_at?.toISOString?.() ?? null,
        }
      : undefined,
  };
}

export async function createWebhookIntegration(
  orgId: string,
  actorId: string,
): Promise<WebhookCreationResult> {
  if (!credentialVaultConfigured()) {
    throw new Error(
      "Set AI_CREDENTIAL_ENCRYPTION_KEY in .env.local before creating webhook integrations.",
    );
  }
  if (persistenceMode() !== "postgres") {
    throw new Error("Webhook integrations require PostgreSQL persistence.");
  }
  await ensureIntegrationCatalog(orgId);
  const pool = databasePool();
  const integrationId = "int_webhook";
  let publicId = `whk_${randomBytes(18).toString("base64url")}`;
  const signingSecret = `whsec_${randomBytes(24).toString("base64url")}`;
  const encrypted = encryptWebhookSecret(signingSecret, orgId, integrationId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE integrations
          SET connection_state='Connected',
              data_scope='Live webhook events',
              permissions='["ingest:feedback"]'::jsonb,
              error_message=NULL
        WHERE org_id=$1 AND id=$2`,
      [orgId, integrationId],
    );
    const webhookSecret = await client.query<{ public_id: string }>(
      `INSERT INTO integration_webhook_secrets(
         org_id, integration_id, public_id, secret_hint, secret_fingerprint,
         encrypted_secret, secret_iv, secret_auth_tag
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (org_id, integration_id) DO UPDATE SET
         secret_hint=excluded.secret_hint,
         secret_fingerprint=excluded.secret_fingerprint,
         encrypted_secret=excluded.encrypted_secret,
         secret_iv=excluded.secret_iv,
         secret_auth_tag=excluded.secret_auth_tag
       RETURNING public_id`,
      [
        orgId,
        integrationId,
        publicId,
        encrypted.secretHint,
        encrypted.secretFingerprint,
        encrypted.encryptedSecret,
        encrypted.secretIv,
        encrypted.secretAuthTag,
      ],
    );
    publicId = webhookSecret.rows[0]?.public_id ?? publicId;
    await client.query(
      `INSERT INTO audit_events(id, org_id, actor_id, actor_name, action, entity_type, entity_id, trace_id)
       VALUES ($1,$2,$3,'Workspace admin','Connected custom webhook integration','Integration',$4,$5)`,
      [randomUUID(), orgId, actorId, integrationId, `setup_webhook_${Date.now()}`],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return {
    integrationId,
    webhookUrl: buildWebhookUrl(publicId),
    signingSecret,
  };
}

export async function markGithubPendingSetup(
  orgId: string,
  actorId: string,
): Promise<string> {
  await ensureIntegrationCatalog(orgId);
  const pool = databasePool();
  await pool.query(
    `UPDATE integrations
        SET connection_state='Pending setup',
            data_scope='Repository metadata and issue creation (approval required)',
            permissions='["metadata:read","issues:write"]'::jsonb,
            error_message=NULL
      WHERE org_id=$1 AND provider=$2`,
    [orgId, GITHUB_PROVIDER],
  );
  await pool.query(
    `INSERT INTO audit_events(id, org_id, actor_id, actor_name, action, entity_type, entity_id, trace_id)
     VALUES ($1,$2,$3,'Workspace admin','Started GitHub integration setup','Integration','int_github',$4)`,
    [randomUUID(), orgId, actorId, `setup_github_${Date.now()}`],
  );
  return (
    process.env.GITHUB_APP_INSTALL_URL ??
    "https://github.com/apps/feelow-ai/installations/new"
  );
}

export interface WebhookFeedbackPayload {
  id?: string;
  customer?: string;
  quote: string;
  type?: string;
  severity?: string;
  environment?: string;
  accountTier?: string;
  arr?: number;
}

export async function ingestWebhookFeedback(
  orgId: string,
  integrationId: string,
  deliveryId: string,
  payload: WebhookFeedbackPayload,
): Promise<{ feedbackId: string; created: boolean }> {
  const pool = databasePool();
  const feedbackId = payload.id?.trim() || `fb_${randomBytes(8).toString("hex")}`;
  const externalId = payload.id?.trim() || deliveryId;
  const payloadHash = createHmac("sha256", deliveryId)
    .update(JSON.stringify(payload))
    .digest("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const delivery = await client.query(
      `INSERT INTO webhook_deliveries(org_id, integration_id, provider_delivery_id, payload_hash)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (org_id, integration_id, provider_delivery_id) DO NOTHING
       RETURNING id`,
      [orgId, integrationId, deliveryId, payloadHash],
    );
    if (delivery.rowCount === 0) {
      await client.query("ROLLBACK");
      const existing = await pool.query<{ id: string }>(
        `SELECT id FROM feedback_items
          WHERE org_id=$1 AND integration_id=$2
            AND source_namespace='direct' AND external_id=$3
          LIMIT 1`,
        [orgId, integrationId, externalId],
      );
      return {
        feedbackId: existing.rows[0]?.id ?? feedbackId,
        created: false,
      };
    }
    await client.query(
      `INSERT INTO feedback_items(
         id, org_id, source, customer_name, account_tier, arr, type, severity,
         redacted, environment, confidence, observed_at, quote,
         integration_id, external_id
       ) VALUES ($1,$2,'Webhook',$3,$4,$5,$6,$7,false,$8,0.75,$9,$10,$11,$12)
       ON CONFLICT (org_id, id) DO NOTHING`,
      [
        feedbackId,
        orgId,
        payload.customer?.trim() || "Unknown customer",
        payload.accountTier ?? "Growth",
        payload.arr ?? 0,
        payload.type ?? "Bug",
        payload.severity ?? "Medium",
        payload.environment?.trim() || "Unspecified",
        new Date().toISOString(),
        payload.quote.trim(),
        integrationId,
        externalId,
      ],
    );
    await client.query(
      `UPDATE integrations
          SET last_sync_at=now(), connection_state='Connected'
        WHERE org_id=$1 AND id=$2`,
      [orgId, integrationId],
    );
    await client.query("COMMIT");
    return { feedbackId, created: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function loadWebhookSecret(
  orgId: string,
  integrationId: string,
): Promise<string | null> {
  const pool = databasePool();
  const result = await pool.query<{
    encrypted_secret: string;
    secret_iv: string;
    secret_auth_tag: string;
  }>(
    `SELECT encrypted_secret, secret_iv, secret_auth_tag
       FROM integration_webhook_secrets
      WHERE org_id=$1 AND integration_id=$2`,
    [orgId, integrationId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return decryptWebhookSecret(orgId, integrationId, row);
}

export async function loadWebhookPublicId(
  orgId: string,
  integrationId: string,
): Promise<string | null> {
  const result = await databasePool().query<{ public_id: string }>(
    `SELECT public_id
       FROM integration_webhook_secrets
      WHERE org_id=$1 AND integration_id=$2`,
    [orgId, integrationId],
  );
  return result.rows[0]?.public_id ?? null;
}

export async function resolveWebhookIntegration(
  publicId: string,
): Promise<{ orgId: string; integrationId: string } | null> {
  const pool = databasePool();
  const result = await pool.query<{ org_id: string; id: string }>(
    `SELECT integration.org_id, integration.id
       FROM integration_webhook_secrets secret
       JOIN integrations integration
         ON integration.org_id=secret.org_id
        AND integration.id=secret.integration_id
      WHERE secret.public_id=$1
        AND integration.provider=$2
        AND integration.connection_state IN ('Connected','Pending setup')`,
    [publicId, WEBHOOK_PROVIDER],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { orgId: row.org_id, integrationId: row.id };
}
