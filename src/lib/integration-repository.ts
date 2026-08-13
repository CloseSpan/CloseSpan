import {
  createHash,
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
import { databasePool } from "./db";
import { integrationCatalog } from "./integration-catalog";
import { getAiPublicConfiguration } from "./ai-config";
import { GITHUB_INSTALL_STATE_TTL_SECONDS } from "./github-installation-state";
import { listPipedreamConnections } from "./pipedream-repository";
import { feedback as seedFeedback } from "./seed";
import {
  requirePostgresWorkspace,
  workspacePersistenceMode,
} from "./workspace-persistence";
import { resolveOrCreateExternalAccount } from "./customer-account-repository";

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
  github?: {
    installationCount: number;
    repositoryCount: number;
  };
}

export interface WebhookCreationResult {
  integrationId: string;
  webhookUrl: string;
  signingSecret: string;
}

const WEBHOOK_PROVIDER = "Custom webhook";
const GITHUB_PROVIDER = "GitHub";

const githubSetupFailureMessages: Readonly<Record<string, string>> = {
  authentication_required:
    "The GitHub connection returned without an active CloseSpan session. Sign in and try again.",
  administrator_required:
    "A workspace administrator must finish the GitHub repository connection.",
  install_request_expired:
    "GitHub repository selection expired before CloseSpan could finish the connection.",
  installation_unavailable:
    "CloseSpan could not use the selected GitHub installation. Review its repository access and try again.",
  invalid_callback:
    "GitHub returned without valid connection state. Start repository selection again.",
  connection_failed:
    "CloseSpan could not finish the GitHub repository connection. Try again.",
};

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
  if (workspacePersistenceMode(orgId) !== "postgres") return;
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
  if (workspacePersistenceMode(orgId) !== "postgres") {
    const [connections, aiConfig] = await Promise.all([
      listPipedreamConnections(orgId),
      getAiPublicConfiguration(orgId),
    ]);
    const connectedIntegrationIds: string[] = connections
      .filter((connection) => connection.state === "Connected")
      .map((connection) => connection.integrationId);
    const feedbackSourceIds = new Set(
      integrationCatalog
        .filter((entry) => entry.feedbackSource)
        .map((entry) => entry.id),
    );
    const feedbackCount = seedFeedback.length;
    const feedbackConnected =
      feedbackCount > 0 ||
      connectedIntegrationIds.some((id) => feedbackSourceIds.has(id));
    const githubConnected = connectedIntegrationIds.includes("int_github");
    const aiConfigured =
      aiConfig.configured &&
      (aiConfig.connectionStatus === "ready" ||
        aiConfig.connectionStatus === "Environment");
    return {
      feedbackConnected,
      aiConfigured,
      githubConnected,
      feedbackCount,
      setupComplete: feedbackConnected && aiConfigured && githubConnected,
      connectedIntegrationIds,
    };
  }
  await ensureIntegrationCatalog(orgId);
  await reconcileExpiredGithubSetup(orgId);
  const pool = databasePool();
  const [feedbackResult, integrationsResult, aiConfig, githubResult] =
    await Promise.all([
      pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM feedback_items WHERE org_id=$1",
        [orgId],
      ),
      queryWorkspaceSetupIntegrations(pool, orgId),
      getAiPublicConfiguration(orgId),
      pool.query<{ installation_count: number; repository_count: number }>(
        `SELECT
           (SELECT count(*)::int FROM github_app_installations
             WHERE org_id=$1 AND active=true) AS installation_count,
           (SELECT count(*)::int FROM github_repository_allowlists
             WHERE org_id=$1 AND active=true) AS repository_count`,
        [orgId],
      ),
    ]);

  const feedbackCount = feedbackResult.rows[0]?.count ?? 0;
  const rawConnectedIntegrationIds = integrationsResult.rows
    .filter((row) => row.connection_state === "Connected")
    .map((row) => row.id);
  const githubInstallationCount =
    githubResult.rows[0]?.installation_count ?? 0;
  const githubRepositoryCount = githubResult.rows[0]?.repository_count ?? 0;
  const githubConnected =
    githubInstallationCount > 0 && githubRepositoryCount > 0;
  const connectedIntegrationIds = [
    ...rawConnectedIntegrationIds.filter((id) => id !== "int_github"),
    ...(githubConnected ? ["int_github"] : []),
  ];
  const webhookRow = integrationsResult.rows.find(
    (row) => row.provider === WEBHOOK_PROVIDER,
  );
  const webhookConnected = webhookRow?.connection_state === "Connected";
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
    github: githubConnected
      ? {
          installationCount: githubInstallationCount,
          repositoryCount: githubRepositoryCount,
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
  if (workspacePersistenceMode(orgId) !== "postgres") {
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
): Promise<{ installUrl: string; attemptId: string; expiresAt: Date }> {
  requirePostgresWorkspace(orgId, "GitHub setup");
  await ensureIntegrationCatalog(orgId);
  const pool = databasePool();
  const attemptId = randomUUID();
  const expiresAt = new Date(Date.now() + GITHUB_INSTALL_STATE_TTL_SECONDS * 1000);
  const installUrl = new URL(
    process.env.GITHUB_APP_INSTALL_URL ??
      "https://github.com/apps/closespan/installations/new",
  );
  if (
    installUrl.protocol !== "https:" ||
    installUrl.hostname !== "github.com" ||
    !/^\/apps\/[A-Za-z0-9-]+\/installations\/new$/.test(installUrl.pathname)
  ) {
    throw new Error("GITHUB_APP_INSTALL_URL must be a GitHub App installation URL");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE integrations
          SET connection_state='Pending setup',
              data_scope='Repository contents for approval-bound draft pull requests',
              permissions='["metadata:read","contents:write","pull_requests:write:draft"]'::jsonb,
              error_message=NULL
        WHERE org_id=$1 AND provider=$2`,
      [orgId, GITHUB_PROVIDER],
    );
    await client.query(
      `INSERT INTO github_app_install_attempts(id,org_id,actor_id,expires_at)
       VALUES($1,$2,$3,$4)`,
      [attemptId, orgId, actorId, expiresAt],
    );
    await client.query(
      `INSERT INTO audit_events(id, org_id, actor_id, actor_name, action, entity_type, entity_id, trace_id)
       VALUES ($1,$2,$3,'Workspace admin','Started GitHub integration setup','Integration','int_github',$4)`,
      [randomUUID(), orgId, actorId, `setup_github_${Date.now()}_${randomUUID()}`],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return { installUrl: installUrl.toString(), attemptId, expiresAt };
}

export async function markGithubSetupFailed(
  orgId: string,
  reason: string,
): Promise<void> {
  requirePostgresWorkspace(orgId, "GitHub setup");
  const message =
    githubSetupFailureMessages[reason] ??
    githubSetupFailureMessages.connection_failed;
  await databasePool().query(
    `UPDATE integrations
        SET connection_state='Connection failed', error_message=$2
      WHERE org_id=$1 AND id='int_github'
        AND NOT EXISTS (
          SELECT 1
            FROM github_app_installations installation
           WHERE installation.org_id=$1
             AND installation.active=true
             AND installation.workspace_connected=true
        )`,
    [orgId, message],
  );
}

export async function reconcileExpiredGithubSetup(
  orgId: string,
): Promise<boolean> {
  requirePostgresWorkspace(orgId, "GitHub setup");
  const result = await databasePool().query(
    `UPDATE integrations
        SET connection_state='Connection failed',
            error_message=$2
      WHERE org_id=$1 AND id='int_github'
        AND connection_state='Pending setup'
        AND NOT EXISTS (
          SELECT 1
            FROM github_app_install_attempts attempt
           WHERE attempt.org_id=$1
             AND attempt.consumed_at IS NULL
             AND attempt.expires_at>now()
        )
        AND NOT EXISTS (
          SELECT 1
            FROM github_app_installations installation
           WHERE installation.org_id=$1
             AND installation.active=true
             AND installation.workspace_connected=true
        )
      RETURNING id`,
    [
      orgId,
      "GitHub repository selection expired before CloseSpan could finish the connection.",
    ],
  );
  return result.rowCount === 1;
}

export interface WebhookFeedbackPayload {
  id?: string;
  customerId?: string;
  customer?: string;
  customerDomain?: string;
  customerSince?: number;
  churnRisk?: string;
  sourceUpdatedAt?: string;
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
  options: { materializeCustomer?: boolean } = {},
): Promise<{ feedbackId: string; created: boolean; accountId: string | null }> {
  requirePostgresWorkspace(orgId, "Webhook feedback ingestion");
  const customerId = payload.customerId?.trim() || null;
  const customerName = payload.customer?.trim() || null;
  if (customerId && !customerName) {
    throw new Error("customer is required when customerId is provided");
  }
  if (
    !customerId &&
    (payload.customerDomain !== undefined ||
      payload.customerSince !== undefined ||
      payload.churnRisk !== undefined ||
      payload.sourceUpdatedAt !== undefined)
  ) {
    throw new Error("customerId is required for customer account metadata");
  }
  if (
    options.materializeCustomer !== false &&
    customerId &&
    !payload.sourceUpdatedAt
  ) {
    throw new Error("sourceUpdatedAt is required for customer account updates");
  }
  const pool = databasePool();
  const externalId = payload.id?.trim() || deliveryId;
  const feedbackId = `fb_webhook_${createHash("sha256")
    .update(JSON.stringify([orgId, integrationId, "direct", externalId]))
    .digest("hex")
    .slice(0, 32)}`;
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
      const recordedDelivery = await client.query<{ payload_hash: string }>(
        `SELECT payload_hash FROM webhook_deliveries
          WHERE org_id=$1 AND integration_id=$2 AND provider_delivery_id=$3
          LIMIT 1`,
        [orgId, integrationId, deliveryId],
      );
      if (recordedDelivery.rows[0]?.payload_hash !== payloadHash) {
        throw new Error(
          "Webhook delivery identifier was reused with a different payload",
        );
      }
      const existing = await client.query<{
        id: string;
        account_id: string | null;
      }>(
        `SELECT id,account_id FROM feedback_items
          WHERE org_id=$1 AND integration_id=$2
            AND source_namespace='direct' AND external_id=$3
          LIMIT 1`,
        [orgId, integrationId, externalId],
      );
      if (!existing.rows[0]) {
        throw new Error(
          "Webhook delivery was already recorded for a different external event",
        );
      }
      await client.query("ROLLBACK");
      return {
        feedbackId: existing.rows[0].id,
        created: false,
        accountId: existing.rows[0].account_id,
      };
    }
    let accountId: string | null = null;
    if (
      options.materializeCustomer !== false &&
      customerId &&
      customerName
    ) {
      const sourceUpdatedAt = new Date(payload.sourceUpdatedAt!);
      if (!Number.isFinite(sourceUpdatedAt.getTime())) {
        throw new Error("sourceUpdatedAt must be a valid timestamp");
      }
      const resolved = await resolveOrCreateExternalAccount(client, {
        orgId,
        integrationId,
        sourceNamespace: "direct",
        externalAccountId: customerId,
        name: customerName,
        domain: payload.customerDomain,
        tier: payload.accountTier,
        arr: payload.arr,
        sourceAuthority: "webhook",
        revenueAuthority: payload.arr === undefined ? undefined : "webhook",
        customerSince: payload.customerSince,
        churnRisk: payload.churnRisk,
        sourceUpdatedAt,
      });
      accountId = resolved.accountId;
    }
    const existingFeedback = await client.query<{
      id: string;
      account_id: string | null;
    }>(
      `SELECT id,account_id FROM feedback_items
        WHERE org_id=$1 AND integration_id=$2
          AND source_namespace='direct' AND external_id=$3
        FOR UPDATE`,
      [orgId, integrationId, externalId],
    );
    if (existingFeedback.rows[0]) {
      const updated = await client.query<{ account_id: string | null }>(
        `UPDATE feedback_items SET
           customer_name=COALESCE($4,customer_name),
           account_tier=COALESCE($5,account_tier),
           arr=COALESCE($6,arr),type=COALESCE($7,type),
           severity=COALESCE($8,severity),
           environment=COALESCE($9,environment),quote=$10,
           account_id=COALESCE($11,account_id),updated_at=now()
         WHERE org_id=$1 AND integration_id=$2
           AND source_namespace='direct' AND external_id=$3
         RETURNING account_id`,
        [
          orgId,
          integrationId,
          externalId,
          customerName,
          payload.accountTier?.trim() || null,
          payload.arr ?? null,
          payload.type?.trim() || null,
          payload.severity?.trim() || null,
          payload.environment?.trim() || null,
          payload.quote.trim(),
          accountId,
        ],
      );
      await client.query(
        `UPDATE integrations
            SET last_sync_at=now(), connection_state='Connected'
          WHERE org_id=$1 AND id=$2`,
        [orgId, integrationId],
      );
      await client.query("COMMIT");
      return {
        feedbackId: existingFeedback.rows[0].id,
        created: false,
        accountId: updated.rows[0]?.account_id ??
          accountId ??
          existingFeedback.rows[0].account_id,
      };
    }
    const inserted = await client.query<{ account_id: string | null }>(
      `INSERT INTO feedback_items(
         id, org_id, source, customer_name, account_tier, arr, type, severity,
         redacted, environment, confidence, observed_at, quote,
         integration_id, external_id, account_id
       ) VALUES ($1,$2,'Webhook',$3,$4,$5,$6,$7,false,$8,0.75,$9,$10,$11,$12,$13)
       ON CONFLICT (org_id, integration_id, source_namespace, external_id)
         WHERE external_id IS NOT NULL
       DO NOTHING
       RETURNING account_id`,
      [
        feedbackId,
        orgId,
        payload.customer?.trim() || "Unknown customer",
        payload.accountTier ?? "Unknown",
        payload.arr ?? 0,
        payload.type ?? "Bug",
        payload.severity ?? "Medium",
        payload.environment?.trim() || "Unspecified",
        new Date().toISOString(),
        payload.quote.trim(),
        integrationId,
        externalId,
        accountId,
      ],
    );
    let response = {
      feedbackId,
      created: true,
      accountId: inserted.rows[0]?.account_id ?? accountId,
    };
    if (inserted.rowCount === 0) {
      const concurrent = await client.query<{
        id: string;
        account_id: string | null;
      }>(
        `SELECT id,account_id FROM feedback_items
          WHERE org_id=$1 AND integration_id=$2
            AND source_namespace='direct' AND external_id=$3
          LIMIT 1`,
        [orgId, integrationId, externalId],
      );
      if (!concurrent.rows[0]) {
        throw new Error(
          "Webhook feedback external identity conflict could not be resolved",
        );
      }
      response = {
        feedbackId: concurrent.rows[0].id,
        created: false,
        accountId: concurrent.rows[0].account_id ?? accountId,
      };
    }
    await client.query(
      `UPDATE integrations
          SET last_sync_at=now(), connection_state='Connected'
        WHERE org_id=$1 AND id=$2`,
      [orgId, integrationId],
    );
    await client.query("COMMIT");
    return response;
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
  requirePostgresWorkspace(orgId, "Webhook credential access");
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
  requirePostgresWorkspace(orgId, "Webhook configuration access");
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
