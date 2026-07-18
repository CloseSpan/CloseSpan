import { randomUUID } from "node:crypto";
import {
  aiProviderDefinitions,
  getAiPublicConfiguration,
  type AiProvider,
  type AiPublicConfiguration,
} from "./ai-config";
import { encryptCredential } from "./credential-crypto";
import { databasePool, persistenceMode, transaction } from "./db";
import type { RequestContext } from "./request-security";

export class AiConfigurationPersistenceError extends Error {}

export async function saveAiConfiguration(input: {
  orgId: string;
  provider: AiProvider;
  model: string;
  apiKey?: string;
  context: RequestContext;
}): Promise<AiPublicConfiguration> {
  if (persistenceMode() !== "postgres")
    throw new AiConfigurationPersistenceError(
      "PostgreSQL persistence is required to store AI credentials",
    );
  const existing = await databasePool().query<{
    provider: AiProvider;
    encrypted_api_key: string | null;
    key_iv: string | null;
    key_auth_tag: string | null;
    key_hint: string | null;
  }>(
    "SELECT provider,encrypted_api_key,key_iv,key_auth_tag,key_hint FROM ai_provider_configs WHERE org_id=$1",
    [input.orgId],
  );
  const current = existing.rows[0];
  const replacingProvider = Boolean(
    current && current.provider !== input.provider,
  );
  if ((!current?.encrypted_api_key || replacingProvider) && !input.apiKey) {
    throw new AiConfigurationPersistenceError(
      "Enter an API key when configuring a provider for the first time or changing providers",
    );
  }
  const encrypted = input.apiKey
    ? encryptCredential(input.apiKey, input.orgId, input.provider)
    : null;
  const ciphertext =
    encrypted?.ciphertext ?? current?.encrypted_api_key ?? null;
  const iv = encrypted?.iv ?? current?.key_iv ?? null;
  const authTag = encrypted?.authTag ?? current?.key_auth_tag ?? null;
  const hint = encrypted?.hint ?? current?.key_hint ?? null;
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO ai_provider_configs(org_id,provider,model,encrypted_api_key,key_iv,key_auth_tag,key_hint,connection_status,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,'Stored',$8)
       ON CONFLICT(org_id) DO UPDATE SET provider=excluded.provider,model=excluded.model,
         encrypted_api_key=excluded.encrypted_api_key,key_iv=excluded.key_iv,key_auth_tag=excluded.key_auth_tag,key_hint=excluded.key_hint,
         connection_status='Stored',last_verified_at=NULL,last_error_code=NULL,updated_by=excluded.updated_by,updated_at=now()`,
      [
        input.orgId,
        input.provider,
        input.model,
        ciphertext,
        iv,
        authTag,
        hint,
        input.context.actorId,
      ],
    );
    const action = `${current ? "Updated" : "Configured"} AI provider ${aiProviderDefinitions[input.provider].label}${input.apiKey ? " and replaced its encrypted credential" : ""}`;
    await client.query(
      `INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id)
       VALUES($1,$2,$3,$4,$5,'AiProviderConfig',$2,$6) ON CONFLICT(org_id,trace_id,action) DO NOTHING`,
      [
        randomUUID(),
        input.orgId,
        input.context.actorId,
        input.context.actorName,
        action,
        input.context.traceId,
      ],
    );
  });
  return getAiPublicConfiguration(input.orgId);
}

export async function removeStoredAiCredential(
  orgId: string,
  context: RequestContext,
): Promise<AiPublicConfiguration> {
  if (persistenceMode() !== "postgres")
    throw new AiConfigurationPersistenceError(
      "PostgreSQL persistence is required to store AI credentials",
    );
  await transaction(async (client) => {
    const result = await client.query(
      `UPDATE ai_provider_configs SET encrypted_api_key=NULL,key_iv=NULL,key_auth_tag=NULL,key_hint=NULL,
       connection_status='Not configured',last_verified_at=NULL,last_error_code=NULL,updated_by=$2,updated_at=now()
       WHERE org_id=$1`,
      [orgId, context.actorId],
    );
    if (!result.rowCount)
      throw new AiConfigurationPersistenceError(
        "No stored AI credential exists for this workspace",
      );
    await client.query(
      `INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id)
       VALUES($1,$2,$3,$4,'Removed the stored AI provider credential','AiProviderConfig',$2,$5)
       ON CONFLICT(org_id,trace_id,action) DO NOTHING`,
      [
        randomUUID(),
        orgId,
        context.actorId,
        context.actorName,
        context.traceId,
      ],
    );
  });
  return getAiPublicConfiguration(orgId);
}
