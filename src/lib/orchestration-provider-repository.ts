import { randomUUID } from "node:crypto";
import {
  credentialVaultConfigured,
  decryptCredential,
  encryptCredential,
} from "./credential-crypto";
import { databasePool, transaction } from "./db";
import {
  normalizeN8nConfiguration,
  testN8nConnection,
  testN8nWorkflowEndpoint,
} from "./n8n-client";
import type { RequestContext } from "./request-security";
import { workspacePersistenceMode } from "./workspace-persistence";

export const orchestrationProviders = ["pipedream", "n8n"] as const;
export type OrchestrationProvider = (typeof orchestrationProviders)[number];

export interface OrchestrationProviderPublicConfiguration {
  activeProvider: OrchestrationProvider;
  providerLabel: string;
  n8n: {
    baseUrl: string;
    triggerUrl: string;
    configured: boolean;
    apiKeyStored: boolean;
    apiKeyHint: string | null;
    apiKeySource: "database" | "environment" | "none";
    signingSecretStored: boolean;
    signingSecretHint: string | null;
    signingSecretSource: "database" | "environment" | "none";
    connectionStatus: "Not configured" | "Verified" | "Failed";
    lastVerifiedAt: string | null;
    lastErrorCode: string | null;
  };
  vaultConfigured: boolean;
  updatedAt: string | null;
}

export interface OrchestrationProviderRuntimeConfiguration
  extends OrchestrationProviderPublicConfiguration {
  n8nApiKey: string | null;
  n8nSigningSecret: string | null;
}

interface StoredConfigurationRow {
  active_provider: OrchestrationProvider;
  n8n_base_url: string | null;
  n8n_trigger_url: string | null;
  encrypted_n8n_api_key: string | null;
  n8n_api_key_iv: string | null;
  n8n_api_key_auth_tag: string | null;
  n8n_api_key_hint: string | null;
  encrypted_n8n_signing_secret: string | null;
  n8n_signing_secret_iv: string | null;
  n8n_signing_secret_auth_tag: string | null;
  n8n_signing_secret_hint: string | null;
  n8n_connection_status: "Not configured" | "Verified" | "Failed";
  n8n_last_verified_at: Date | null;
  n8n_last_error_code: string | null;
  updated_at: Date;
}

interface MemoryConfiguration {
  activeProvider: OrchestrationProvider;
  baseUrl: string;
  triggerUrl: string;
  apiKey: string | null;
  signingSecret: string | null;
  connectionStatus: "Not configured" | "Verified" | "Failed";
  lastVerifiedAt: string | null;
  lastErrorCode: string | null;
  updatedAt: string;
}

const memoryConfigurations = new Map<string, MemoryConfiguration>();

export class OrchestrationProviderPersistenceError extends Error {}

function providerLabel(provider: OrchestrationProvider): string {
  return provider === "n8n" ? "n8n" : "Pipedream";
}

function environmentProvider(): OrchestrationProvider {
  return process.env.ORCHESTRATION_PROVIDER?.trim().toLowerCase() === "n8n"
    ? "n8n"
    : "pipedream";
}

function environmentValue(name: string): string | null {
  return process.env[name]?.trim() || null;
}

function environmentRuntimeConfiguration(): OrchestrationProviderRuntimeConfiguration {
  const activeProvider = environmentProvider();
  const baseUrl = environmentValue("N8N_BASE_URL") ?? "";
  const triggerUrl = environmentValue("N8N_TRIGGER_URL") ?? "";
  const apiKey = environmentValue("N8N_API_KEY");
  const signingSecret = environmentValue("N8N_WEBHOOK_SIGNING_SECRET");
  const configured = Boolean(baseUrl && triggerUrl && apiKey && signingSecret);
  return {
    activeProvider,
    providerLabel: providerLabel(activeProvider),
    n8n: {
      baseUrl,
      triggerUrl,
      configured,
      apiKeyStored: false,
      apiKeyHint: apiKey ? "Environment secret" : null,
      apiKeySource: apiKey ? "environment" : "none",
      signingSecretStored: false,
      signingSecretHint: signingSecret ? "Environment secret" : null,
      signingSecretSource: signingSecret ? "environment" : "none",
      connectionStatus: configured ? "Verified" : "Not configured",
      lastVerifiedAt: null,
      lastErrorCode: null,
    },
    vaultConfigured: credentialVaultConfigured(),
    updatedAt: null,
    n8nApiKey: apiKey,
    n8nSigningSecret: signingSecret,
  };
}

async function storedConfiguration(
  orgId: string,
): Promise<StoredConfigurationRow | null> {
  if (workspacePersistenceMode(orgId) !== "postgres") return null;
  const result = await databasePool().query<StoredConfigurationRow>(
    `SELECT active_provider,n8n_base_url,n8n_trigger_url,
       encrypted_n8n_api_key,n8n_api_key_iv,n8n_api_key_auth_tag,n8n_api_key_hint,
       encrypted_n8n_signing_secret,n8n_signing_secret_iv,n8n_signing_secret_auth_tag,n8n_signing_secret_hint,
       n8n_connection_status,n8n_last_verified_at,n8n_last_error_code,updated_at
     FROM orchestration_provider_settings WHERE org_id=$1`,
    [orgId],
  );
  return result.rows[0] ?? null;
}

function storedSecret(
  row: StoredConfigurationRow,
  orgId: string,
  kind: "api" | "signing",
): string | null {
  const encrypted = kind === "api"
    ? row.encrypted_n8n_api_key
    : row.encrypted_n8n_signing_secret;
  const iv = kind === "api" ? row.n8n_api_key_iv : row.n8n_signing_secret_iv;
  const authTag = kind === "api"
    ? row.n8n_api_key_auth_tag
    : row.n8n_signing_secret_auth_tag;
  if (!encrypted || !iv || !authTag) return null;
  return decryptCredential(
    { ciphertext: encrypted, iv, authTag },
    orgId,
    kind === "api" ? "n8n-api" : "n8n-signing",
  );
}

function buildRuntimeFromMemory(
  value: MemoryConfiguration,
): OrchestrationProviderRuntimeConfiguration {
  const configured = Boolean(
    value.baseUrl && value.triggerUrl && value.apiKey && value.signingSecret,
  );
  return {
    activeProvider: value.activeProvider,
    providerLabel: providerLabel(value.activeProvider),
    n8n: {
      baseUrl: value.baseUrl,
      triggerUrl: value.triggerUrl,
      configured,
      apiKeyStored: Boolean(value.apiKey),
      apiKeyHint: value.apiKey ? `•••• ${value.apiKey.slice(-4)}` : null,
      apiKeySource: value.apiKey ? "database" : "none",
      signingSecretStored: Boolean(value.signingSecret),
      signingSecretHint: value.signingSecret
        ? `•••• ${value.signingSecret.slice(-4)}`
        : null,
      signingSecretSource: value.signingSecret ? "database" : "none",
      connectionStatus: value.connectionStatus,
      lastVerifiedAt: value.lastVerifiedAt,
      lastErrorCode: value.lastErrorCode,
    },
    vaultConfigured: credentialVaultConfigured(),
    updatedAt: value.updatedAt,
    n8nApiKey: value.apiKey,
    n8nSigningSecret: value.signingSecret,
  };
}

export async function getOrchestrationProviderRuntimeConfiguration(
  orgId: string,
): Promise<OrchestrationProviderRuntimeConfiguration> {
  if (workspacePersistenceMode(orgId) === "memory") {
    const memory = memoryConfigurations.get(orgId);
    return memory
      ? buildRuntimeFromMemory(memory)
      : environmentRuntimeConfiguration();
  }

  const row = await storedConfiguration(orgId);
  if (!row) return environmentRuntimeConfiguration();
  const environment = environmentRuntimeConfiguration();
  const storedApiKey = storedSecret(row, orgId, "api");
  const storedSigningSecret = storedSecret(row, orgId, "signing");
  const apiKey = storedApiKey ?? environment.n8nApiKey;
  const signingSecret = storedSigningSecret ?? environment.n8nSigningSecret;
  const baseUrl = row.n8n_base_url ?? environment.n8n.baseUrl;
  const triggerUrl = row.n8n_trigger_url ?? environment.n8n.triggerUrl;
  const configured = Boolean(baseUrl && triggerUrl && apiKey && signingSecret);
  return {
    activeProvider: row.active_provider,
    providerLabel: providerLabel(row.active_provider),
    n8n: {
      baseUrl,
      triggerUrl,
      configured,
      apiKeyStored: Boolean(storedApiKey),
      apiKeyHint: storedApiKey
        ? row.n8n_api_key_hint
        : apiKey
          ? "Environment secret"
          : null,
      apiKeySource: storedApiKey
        ? "database"
        : apiKey
          ? "environment"
          : "none",
      signingSecretStored: Boolean(storedSigningSecret),
      signingSecretHint: storedSigningSecret
        ? row.n8n_signing_secret_hint
        : signingSecret
          ? "Environment secret"
          : null,
      signingSecretSource: storedSigningSecret
        ? "database"
        : signingSecret
          ? "environment"
          : "none",
      connectionStatus: row.n8n_connection_status,
      lastVerifiedAt: row.n8n_last_verified_at?.toISOString() ?? null,
      lastErrorCode: row.n8n_last_error_code,
    },
    vaultConfigured: credentialVaultConfigured(),
    updatedAt: row.updated_at.toISOString(),
    n8nApiKey: apiKey,
    n8nSigningSecret: signingSecret,
  };
}

export async function getOrchestrationProviderPublicConfiguration(
  orgId: string,
): Promise<OrchestrationProviderPublicConfiguration> {
  const runtime = await getOrchestrationProviderRuntimeConfiguration(orgId);
  return {
    activeProvider: runtime.activeProvider,
    providerLabel: runtime.providerLabel,
    n8n: runtime.n8n,
    vaultConfigured: runtime.vaultConfigured,
    updatedAt: runtime.updatedAt,
  };
}

export async function saveOrchestrationProviderConfiguration(input: {
  orgId: string;
  activeProvider: OrchestrationProvider;
  baseUrl?: string;
  triggerUrl?: string;
  apiKey?: string;
  signingSecret?: string;
  context: RequestContext;
}): Promise<OrchestrationProviderPublicConfiguration> {
  const current = await getOrchestrationProviderRuntimeConfiguration(input.orgId);
  const baseUrl = input.baseUrl?.trim() || current.n8n.baseUrl;
  const triggerUrl = input.triggerUrl?.trim() || current.n8n.triggerUrl;
  const apiKey = input.apiKey?.trim() || current.n8nApiKey;
  const signingSecret = input.signingSecret?.trim() || current.n8nSigningSecret;
  let verifiedAt = current.n8n.lastVerifiedAt;
  let connectionStatus = current.n8n.connectionStatus;

  if (input.activeProvider === "n8n") {
    if (!baseUrl || !triggerUrl || !apiKey || !signingSecret) {
      throw new OrchestrationProviderPersistenceError(
        "Enter the n8n base URL, production trigger URL, API key, and signing secret before activating n8n.",
      );
    }
    const normalized = normalizeN8nConfiguration({ baseUrl, triggerUrl });
    await testN8nConnection({ baseUrl: normalized.baseUrl, apiKey });
    await testN8nWorkflowEndpoint({
      baseUrl: normalized.baseUrl,
      triggerUrl: normalized.triggerUrl,
      signingSecret,
    });
    verifiedAt = new Date().toISOString();
    connectionStatus = "Verified";
  }

  const now = new Date().toISOString();
  if (workspacePersistenceMode(input.orgId) === "memory") {
    memoryConfigurations.set(input.orgId, {
      activeProvider: input.activeProvider,
      baseUrl,
      triggerUrl,
      apiKey,
      signingSecret,
      connectionStatus,
      lastVerifiedAt: verifiedAt,
      lastErrorCode: null,
      updatedAt: now,
    });
    return getOrchestrationProviderPublicConfiguration(input.orgId);
  }

  const row = await storedConfiguration(input.orgId);
  const encryptedApiKey = input.apiKey
    ? encryptCredential(input.apiKey.trim(), input.orgId, "n8n-api")
    : null;
  const encryptedSigningSecret = input.signingSecret
    ? encryptCredential(input.signingSecret.trim(), input.orgId, "n8n-signing")
    : null;
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO orchestration_provider_settings(
         org_id,active_provider,n8n_base_url,n8n_trigger_url,
         encrypted_n8n_api_key,n8n_api_key_iv,n8n_api_key_auth_tag,n8n_api_key_hint,
         encrypted_n8n_signing_secret,n8n_signing_secret_iv,n8n_signing_secret_auth_tag,n8n_signing_secret_hint,
         n8n_connection_status,n8n_last_verified_at,n8n_last_error_code,updated_by
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULL,$15)
       ON CONFLICT(org_id) DO UPDATE SET
         active_provider=excluded.active_provider,
         n8n_base_url=excluded.n8n_base_url,
         n8n_trigger_url=excluded.n8n_trigger_url,
         encrypted_n8n_api_key=COALESCE(excluded.encrypted_n8n_api_key,orchestration_provider_settings.encrypted_n8n_api_key),
         n8n_api_key_iv=COALESCE(excluded.n8n_api_key_iv,orchestration_provider_settings.n8n_api_key_iv),
         n8n_api_key_auth_tag=COALESCE(excluded.n8n_api_key_auth_tag,orchestration_provider_settings.n8n_api_key_auth_tag),
         n8n_api_key_hint=COALESCE(excluded.n8n_api_key_hint,orchestration_provider_settings.n8n_api_key_hint),
         encrypted_n8n_signing_secret=COALESCE(excluded.encrypted_n8n_signing_secret,orchestration_provider_settings.encrypted_n8n_signing_secret),
         n8n_signing_secret_iv=COALESCE(excluded.n8n_signing_secret_iv,orchestration_provider_settings.n8n_signing_secret_iv),
         n8n_signing_secret_auth_tag=COALESCE(excluded.n8n_signing_secret_auth_tag,orchestration_provider_settings.n8n_signing_secret_auth_tag),
         n8n_signing_secret_hint=COALESCE(excluded.n8n_signing_secret_hint,orchestration_provider_settings.n8n_signing_secret_hint),
         n8n_connection_status=excluded.n8n_connection_status,
         n8n_last_verified_at=excluded.n8n_last_verified_at,
         n8n_last_error_code=NULL,
         updated_by=excluded.updated_by,
         updated_at=now()`,
      [
        input.orgId,
        input.activeProvider,
        baseUrl || null,
        triggerUrl || null,
        encryptedApiKey?.ciphertext ?? row?.encrypted_n8n_api_key ?? null,
        encryptedApiKey?.iv ?? row?.n8n_api_key_iv ?? null,
        encryptedApiKey?.authTag ?? row?.n8n_api_key_auth_tag ?? null,
        encryptedApiKey?.hint ?? row?.n8n_api_key_hint ?? null,
        encryptedSigningSecret?.ciphertext ?? row?.encrypted_n8n_signing_secret ?? null,
        encryptedSigningSecret?.iv ?? row?.n8n_signing_secret_iv ?? null,
        encryptedSigningSecret?.authTag ?? row?.n8n_signing_secret_auth_tag ?? null,
        encryptedSigningSecret?.hint ?? row?.n8n_signing_secret_hint ?? null,
        connectionStatus,
        verifiedAt,
        input.context.actorId,
      ],
    );
    await client.query(
      `INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id)
       VALUES($1,$2,$3,$4,$5,'OrchestrationProviderConfig',$2,$6)
       ON CONFLICT(org_id,trace_id,action) DO NOTHING`,
      [
        randomUUID(),
        input.orgId,
        input.context.actorId,
        input.context.actorName,
        `Activated ${providerLabel(input.activeProvider)} orchestration`,
        input.context.traceId,
      ],
    );
  });
  return getOrchestrationProviderPublicConfiguration(input.orgId);
}

export function resetOrchestrationProviderConfigurationsForTests(): void {
  memoryConfigurations.clear();
}
