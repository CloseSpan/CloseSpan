import { createHash, randomUUID } from "node:crypto";
import { credentialVaultConfigured, decryptCredential, encryptCredential } from "./credential-crypto";
import { databasePool, transaction } from "./db";
import { requirePostgresWorkspace, workspacePersistenceMode } from "./workspace-persistence";
import { HttpError } from "./request-security";
import { retellFeedback, type RetellCall } from "./retell-api";

type ConnectionRow = {
  org_id: string; public_id: string; secret_hint: string; secret_fingerprint: string;
  encrypted_secret: string; secret_iv: string; secret_auth_tag: string; last_sync_at: Date | null;
};
const connectionQuery = `SELECT secret.*,integration.last_sync_at
  FROM integration_webhook_secrets secret JOIN integrations integration
    ON integration.org_id=secret.org_id AND integration.id=secret.integration_id
  WHERE secret.integration_id='int_retell' AND integration.connection_state='Connected'`;

function webhookUrl(publicId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || "http://localhost:3000";
  return new URL(`/api/webhooks/retell/${publicId}`, base).toString();
}

export async function retellStatus(orgId: string) {
  const configured = workspacePersistenceMode(orgId) === "postgres" && credentialVaultConfigured();
  if (workspacePersistenceMode(orgId) !== "postgres") return { configured, connected: false, keyHint: null, webhookUrl: null, lastImportAt: null };
  const result = await databasePool().query<ConnectionRow>(`${connectionQuery} AND secret.org_id=$1`, [orgId]);
  const row = result.rows[0];
  return { configured, connected: Boolean(row), keyHint: row?.secret_hint ?? null, webhookUrl: row ? webhookUrl(row.public_id) : null, lastImportAt: row?.last_sync_at?.toISOString() ?? null };
}

export async function connectRetell(orgId: string, actorId: string, apiKey: string) {
  requirePostgresWorkspace(orgId, "Retell connection");
  const encrypted = encryptCredential(apiKey, orgId, "int_retell");
  await transaction(async (client) => {
    await client.query(`INSERT INTO integrations(id,org_id,provider,category,connection_state,data_scope,permissions,display_order)
      VALUES('int_retell',$1,'Retell AI','Feedback','Connected','Call transcripts and summaries','["calls:read"]',14)
      ON CONFLICT(org_id,id) DO UPDATE SET connection_state='Connected',data_scope=excluded.data_scope,
        permissions=excluded.permissions,error_message=NULL`, [orgId]);
    await client.query(`INSERT INTO integration_webhook_secrets(org_id,integration_id,public_id,secret_hint,secret_fingerprint,encrypted_secret,secret_iv,secret_auth_tag)
      VALUES($1,'int_retell',$2,$3,$4,$5,$6,$7)
      ON CONFLICT(org_id,integration_id) DO UPDATE SET public_id=excluded.public_id,secret_hint=excluded.secret_hint,
        secret_fingerprint=excluded.secret_fingerprint,encrypted_secret=excluded.encrypted_secret,
        secret_iv=excluded.secret_iv,secret_auth_tag=excluded.secret_auth_tag`,
    [orgId, `retell_${randomUUID().replaceAll("-", "")}`, encrypted.hint, encrypted.fingerprint, encrypted.ciphertext, encrypted.iv, encrypted.authTag]);
    await client.query(`INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id)
      VALUES($1,$2,$3,'Workspace admin','Connected Retell call import','Integration','int_retell',$4)`, [randomUUID(), orgId, actorId, randomUUID()]);
  });
  return retellStatus(orgId);
}

export async function disconnectRetell(orgId: string, actorId: string) {
  requirePostgresWorkspace(orgId, "Retell disconnection");
  await transaction(async (client) => {
    // Lock in the same order as ingestion. An in-flight import cannot re-enable a disconnected integration.
    await client.query(`SELECT id FROM integrations WHERE org_id=$1 AND id='int_retell' FOR UPDATE`, [orgId]);
    await client.query(`DELETE FROM integration_webhook_secrets WHERE org_id=$1 AND integration_id='int_retell'`, [orgId]);
    await client.query(`UPDATE integrations SET connection_state='Disconnected',error_message=NULL WHERE org_id=$1 AND id='int_retell'`, [orgId]);
    await client.query(`INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id)
      VALUES($1,$2,$3,'Workspace admin','Disconnected Retell; imported feedback retained','Integration','int_retell',$4)`, [randomUUID(), orgId, actorId, randomUUID()]);
  });
}

export async function loadRetellConnection(scope: { orgId: string } | { publicId: string }) {
  if ("orgId" in scope) requirePostgresWorkspace(scope.orgId, "Retell call access");
  const result = await databasePool().query<ConnectionRow>(`${connectionQuery} AND ${"orgId" in scope ? "secret.org_id" : "secret.public_id"}=$1`, ["orgId" in scope ? scope.orgId : scope.publicId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    orgId: row.org_id, publicId: row.public_id,
    apiKey: decryptCredential({ ciphertext: row.encrypted_secret, iv: row.secret_iv, authTag: row.secret_auth_tag }, row.org_id, "int_retell"),
  };
}

export async function ingestRetellCalls(connection: { orgId: string; publicId: string }, calls: RetellCall[]) {
  requirePostgresWorkspace(connection.orgId, "Retell call import");
  if (calls.length > 25) throw new HttpError(400, "Import up to 25 calls at a time.");
  return transaction(async (client) => {
    const active = await client.query(`SELECT integration.id FROM integrations integration
      JOIN integration_webhook_secrets secret ON secret.org_id=integration.org_id AND secret.integration_id=integration.id
      WHERE integration.org_id=$1 AND integration.id='int_retell' AND integration.connection_state='Connected'
        AND secret.public_id=$2 FOR UPDATE OF integration,secret`, [connection.orgId, connection.publicId]);
    if (!active.rowCount) throw new HttpError(409, "Retell was disconnected or reconnected. Refresh and try again.");
    let imported = 0; let skipped = 0;
    for (const call of calls) {
      const feedback = retellFeedback(call);
      if (!feedback) { skipped++; continue; }
      const id = `fb_retell_${createHash("sha256").update(JSON.stringify([connection.orgId, call.call_id])).digest("hex").slice(0, 32)}`;
      const inserted = await client.query(`INSERT INTO feedback_items(id,org_id,source,customer_name,account_tier,arr,type,severity,
        redacted,environment,confidence,observed_at,quote,integration_id,source_namespace,external_id)
        VALUES($1,$2,'Retell AI','Call participant','Unknown',0,'Question','Low',true,'Voice call',0,$3,$4,'int_retell','retell',$5)
        ON CONFLICT(org_id,integration_id,source_namespace,external_id) WHERE external_id IS NOT NULL DO NOTHING`,
      [id, connection.orgId, feedback.observedAt, feedback.quote, call.call_id]);
      imported += inserted.rowCount ?? 0;
    }
    await client.query(`UPDATE integrations SET last_sync_at=now() WHERE org_id=$1 AND id='int_retell'`, [connection.orgId]);
    return { imported, skipped, existing: calls.length - skipped - imported, checked: calls.length };
  });
}
