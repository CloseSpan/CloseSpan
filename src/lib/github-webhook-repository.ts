import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { databasePool, transaction } from "./db";
import { verifyGithubInstallation, type VerifiedGithubInstallation } from "./github-app-auth";
import { syncGithubInstallationRecords } from "./github-installation-repository";

interface GithubWebhookPayload {
  action?: unknown;
  installation?: { id?: unknown };
  repository?: { full_name?: unknown };
  pull_request?: {
    number?: unknown;
    html_url?: unknown;
    merged?: unknown;
    draft?: unknown;
  };
}

export interface GithubWebhookInput {
  deliveryId: string;
  event: string;
  rawBody: string;
  payload: GithubWebhookPayload;
}

export interface GithubWebhookResult {
  accepted: true;
  duplicate: boolean;
  outcome: string;
}

const synchronizationActions = new Set([
  "created",
  "new_permissions_accepted",
  "target_renamed",
  "unsuspend",
]);
const pullRequestActions = new Set([
  "opened",
  "reopened",
  "synchronize",
  "ready_for_review",
  "converted_to_draft",
  "closed",
]);

let schemaInitialization: Promise<void> | undefined;

async function ensureGithubWebhookSchema(): Promise<void> {
  schemaInitialization ??= databasePool()
    .query(`
      CREATE TABLE IF NOT EXISTS github_webhook_deliveries (
        delivery_id uuid PRIMARY KEY,
        event text NOT NULL,
        action text,
        installation_id bigint,
        org_id text REFERENCES organizations(id) ON DELETE SET NULL,
        payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
        outcome text NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now(),
        processed_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS github_webhook_deliveries_org_time_idx
        ON github_webhook_deliveries(org_id,received_at DESC);
      CREATE INDEX IF NOT EXISTS github_webhook_deliveries_installation_time_idx
        ON github_webhook_deliveries(installation_id,received_at DESC)
        WHERE installation_id IS NOT NULL;
    `)
    .then(() => undefined)
    .catch((error: unknown) => {
      schemaInitialization = undefined;
      throw error;
    });
  await schemaInitialization;
}

function stringAction(payload: GithubWebhookPayload): string | null {
  return typeof payload.action === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(payload.action)
    ? payload.action
    : null;
}

function installationId(payload: GithubWebhookPayload): string | null {
  const value = payload.installation?.id;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return null;
  return String(value);
}

async function installationOrganization(id: string | null): Promise<string | null> {
  if (!id) return null;
  const result = await databasePool().query<{ org_id: string }>(
    "SELECT org_id FROM github_app_installations WHERE installation_id=$1",
    [id],
  );
  return result.rows[0]?.org_id ?? null;
}

async function deactivateInstallation(
  client: PoolClient,
  orgId: string,
  id: string,
  action: string,
  deliveryId: string,
): Promise<string> {
  const changed = await client.query(
    `UPDATE github_app_installations
        SET active=false,updated_at=now()
      WHERE org_id=$1 AND installation_id=$2 AND active=true
      RETURNING id`,
    [orgId, id],
  );
  await client.query(
    `UPDATE github_repository_allowlists
        SET active=false,updated_at=now()
      WHERE org_id=$1 AND installation_id=$2 AND active=true`,
    [orgId, id],
  );
  await client.query(
    `UPDATE integrations
        SET connection_state='Not connected',last_sync_at=now(),
            data_scope='None',permissions='[]'::jsonb,
            error_message=$2
      WHERE org_id=$1 AND id='int_github'
        AND NOT EXISTS (
          SELECT 1 FROM github_app_installations
           WHERE org_id=$1 AND active=true
        )`,
    [orgId, action === "suspend" ? "GitHub App installation suspended" : null],
  );
  if (changed.rowCount) {
    await client.query(
      `INSERT INTO audit_events(
         id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
       ) VALUES($1,$2,'github','GitHub',$3,'Integration','int_github',$4)`,
      [
        randomUUID(),
        orgId,
        action === "suspend"
          ? `GitHub App installation ${id} was suspended`
          : `GitHub App installation ${id} was removed`,
        `github-webhook-${deliveryId}`,
      ],
    );
  }
  return changed.rowCount ? `installation_${action}` : "installation_already_inactive";
}

async function synchronizeInstallation(
  client: PoolClient,
  orgId: string,
  verified: VerifiedGithubInstallation,
  deliveryId: string,
): Promise<string> {
  const binding = await client.query<{ org_id: string }>(
    `SELECT org_id FROM github_app_installations
      WHERE installation_id=$1 FOR UPDATE`,
    [verified.installationId],
  );
  if (binding.rows[0]?.org_id !== orgId) return "ignored_unbound_installation";
  await syncGithubInstallationRecords(client, orgId, verified);
  await client.query(
    `INSERT INTO audit_events(
       id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
     ) VALUES($1,$2,'github','GitHub',$3,'Integration','int_github',$4)`,
    [
      randomUUID(),
      orgId,
      `Synchronized GitHub App installation ${verified.installationId} with ${verified.repositories.length} repositories`,
      `github-webhook-${deliveryId}`,
    ],
  );
  return "installation_synchronized";
}

async function auditPullRequest(
  client: PoolClient,
  orgId: string,
  id: string,
  action: string | null,
  payload: GithubWebhookPayload,
  deliveryId: string,
): Promise<string> {
  if (!action || !pullRequestActions.has(action)) return "ignored_pull_request_action";
  const repository = payload.repository?.full_name;
  const number = payload.pull_request?.number;
  if (typeof repository !== "string" || typeof number !== "number" || !Number.isSafeInteger(number))
    return "ignored_malformed_pull_request";
  const run = await client.query<{ id: string }>(
    `SELECT run.id
       FROM agent_runs run
       JOIN github_repository_allowlists allowlist
         ON allowlist.org_id=run.org_id
        AND allowlist.repository=run.repository
        AND allowlist.installation_id=$2
        AND allowlist.active=true
      WHERE run.org_id=$1 AND run.repository=$3
        AND run.pull_request_number=$4
      ORDER BY run.queued_at DESC LIMIT 1`,
    [orgId, id, repository, number],
  );
  const runId = run.rows[0]?.id;
  if (!runId) return "ignored_untracked_pull_request";
  const merged = action === "closed" && payload.pull_request?.merged === true;
  const description = merged ? "merged" : action === "closed" ? "closed without merge" : action.replaceAll("_", " ");
  await client.query(
    `INSERT INTO audit_events(
       id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
     ) VALUES($1,$2,'github','GitHub',$3,'Agent run',$4,$5)`,
    [
      randomUUID(),
      orgId,
      `GitHub draft PR ${repository}#${number} ${description}`,
      runId,
      `github-webhook-${deliveryId}`,
    ],
  );
  return merged ? "tracked_pull_request_merged" : `tracked_pull_request_${action}`;
}

export async function processGithubWebhook(
  input: GithubWebhookInput,
): Promise<GithubWebhookResult> {
  await ensureGithubWebhookSchema();
  const existingDelivery = await databasePool().query(
    "SELECT 1 FROM github_webhook_deliveries WHERE delivery_id=$1",
    [input.deliveryId],
  );
  if (existingDelivery.rowCount)
    return { accepted: true, duplicate: true, outcome: "duplicate" };

  const action = stringAction(input.payload);
  const id = installationId(input.payload);
  const orgId = await installationOrganization(id);

  let verified: VerifiedGithubInstallation | null = null;
  const shouldSynchronize = Boolean(
    orgId && id && (
      input.event === "installation_repositories" ||
      (input.event === "installation" && action && synchronizationActions.has(action))
    ),
  );
  if (shouldSynchronize && id) verified = await verifyGithubInstallation(id);

  return transaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO github_webhook_deliveries(
         delivery_id,event,action,installation_id,org_id,payload_sha256,outcome
       ) VALUES($1,$2,$3,$4,$5,$6,'processing')
       ON CONFLICT(delivery_id) DO NOTHING
       RETURNING delivery_id`,
      [
        input.deliveryId,
        input.event,
        action,
        id,
        orgId,
        createHash("sha256").update(input.rawBody, "utf8").digest("hex"),
      ],
    );
    if (!inserted.rowCount)
      return { accepted: true, duplicate: true, outcome: "duplicate" };

    let outcome = "ignored_unhandled_event";
    if (input.event === "ping") outcome = "ping_acknowledged";
    else if (!id) outcome = "ignored_missing_installation";
    else if (!orgId) outcome = "ignored_unbound_installation";
    else if (input.event === "installation" && (action === "deleted" || action === "suspend"))
      outcome = await deactivateInstallation(client, orgId, id, action, input.deliveryId);
    else if (verified)
      outcome = await synchronizeInstallation(client, orgId, verified, input.deliveryId);
    else if (input.event === "pull_request")
      outcome = await auditPullRequest(client, orgId, id, action, input.payload, input.deliveryId);

    await client.query(
      `UPDATE github_webhook_deliveries
          SET outcome=$2,processed_at=now()
        WHERE delivery_id=$1`,
      [input.deliveryId, outcome],
    );
    return { accepted: true, duplicate: false, outcome };
  });
}
