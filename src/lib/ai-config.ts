import { databasePool } from "./db";
import {
  credentialVaultConfigured,
  decryptCredential,
} from "./credential-crypto";
import { workspacePersistenceMode } from "./workspace-persistence";

export const aiProviders = [
  "openai",
  "xai",
  "anthropic",
  "openrouter",
] as const;
export type AiProvider = (typeof aiProviders)[number];

export interface AiProviderDefinition {
  id: AiProvider;
  label: string;
  description: string;
  defaultModel: string;
  baseUrl: string;
}

export const aiProviderDefinitions: Record<AiProvider, AiProviderDefinition> = {
  xai: {
    id: "xai",
    label: "xAI Grok",
    description: "Direct xAI inference with Grok models.",
    defaultModel: "grok-4.5",
    baseUrl: "https://api.x.ai/v1",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    description: "Direct OpenAI Responses API access.",
    defaultModel: "gpt-5.6-sol",
    baseUrl: "https://api.openai.com/v1",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic Claude",
    description: "Direct Claude Messages API access.",
    defaultModel: "claude-sonnet-4-6",
    baseUrl: "https://api.anthropic.com",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    description: "A unified gateway to supported structured-output models.",
    defaultModel: "openai/gpt-5.6",
    baseUrl: "https://openrouter.ai/api/v1",
  },
};

export interface AiPublicConfiguration {
  provider: AiProvider;
  providerLabel: string;
  model: string;
  configured: boolean;
  credentialStored: boolean;
  vaultConfigured: boolean;
  keyHint: string | null;
  keySource: "database" | "environment" | "none";
  connectionStatus: string;
  updatedAt: string | null;
}

export interface AiRuntimeConfiguration extends AiPublicConfiguration {
  apiKey: string | null;
  baseUrl: string;
  timeoutMs: number;
  maxOutputTokens: number;
}

interface StoredConfigurationRow {
  provider: AiProvider;
  model: string;
  encrypted_api_key: string | null;
  key_iv: string | null;
  key_auth_tag: string | null;
  key_hint: string | null;
  connection_status: string;
  updated_at: Date;
}

export function isAiProvider(
  value: string | undefined | null,
): value is AiProvider {
  return Boolean(value && aiProviders.includes(value as AiProvider));
}

function environmentKey(provider: AiProvider): string | null {
  const key = (
    {
      xai: process.env.XAI_API_KEY,
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      openrouter: process.env.OPENROUTER_API_KEY,
    } satisfies Record<AiProvider, string | undefined>
  )[provider]?.trim();
  return key || null;
}

function environmentProvider(): AiProvider {
  if (isAiProvider(process.env.AI_PROVIDER?.trim().toLowerCase()))
    return process.env.AI_PROVIDER.trim().toLowerCase() as AiProvider;
  return aiProviders.find((provider) => environmentKey(provider)) ?? "openai";
}

function environmentModel(provider: AiProvider): string {
  const providerModel = (
    {
      xai: process.env.XAI_MODEL,
      openai: process.env.OPENAI_MODEL,
      anthropic: process.env.ANTHROPIC_MODEL,
      openrouter: process.env.OPENROUTER_MODEL,
    } satisfies Record<AiProvider, string | undefined>
  )[provider];
  return (
    process.env.AI_MODEL?.trim() ||
    providerModel?.trim() ||
    aiProviderDefinitions[provider].defaultModel
  );
}

function baseUrl(provider: AiProvider): string {
  const override = (
    {
      xai: process.env.XAI_BASE_URL,
      openai: process.env.OPENAI_BASE_URL,
      anthropic: process.env.ANTHROPIC_BASE_URL,
      openrouter: process.env.OPENROUTER_BASE_URL,
    } satisfies Record<AiProvider, string | undefined>
  )[provider]?.trim();
  return override || aiProviderDefinitions[provider].baseUrl;
}

export interface EnvironmentAiHealthConfiguration {
  provider: AiProvider;
  model: string;
  apiKey: string;
  baseUrl: string;
}

export function getEnvironmentAiHealthConfiguration(): EnvironmentAiHealthConfiguration | null {
  const provider = environmentProvider();
  const apiKey = environmentKey(provider);
  if (!apiKey) return null;
  return {
    provider,
    model: environmentModel(provider),
    apiKey,
    baseUrl: baseUrl(provider),
  };
}

async function storedConfiguration(
  orgId: string,
): Promise<StoredConfigurationRow | null> {
  if (workspacePersistenceMode(orgId) !== "postgres") return null;
  const result = await databasePool().query<StoredConfigurationRow>(
    `SELECT provider,model,encrypted_api_key,key_iv,key_auth_tag,key_hint,connection_status,updated_at
     FROM ai_provider_configs WHERE org_id=$1`,
    [orgId],
  );
  return result.rows[0] ?? null;
}

function environmentPublicConfiguration(
  provider = environmentProvider(),
  model = environmentModel(provider),
): AiPublicConfiguration {
  const configured = Boolean(environmentKey(provider));
  return {
    provider,
    providerLabel: aiProviderDefinitions[provider].label,
    model,
    configured,
    credentialStored: false,
    vaultConfigured: credentialVaultConfigured(),
    keyHint: configured ? "Environment secret" : null,
    keySource: configured ? "environment" : "none",
    connectionStatus: configured ? "Environment" : "Not configured",
    updatedAt: null,
  };
}

export async function getAiPublicConfiguration(
  orgId: string,
): Promise<AiPublicConfiguration> {
  const stored = await storedConfiguration(orgId);
  if (!stored) return environmentPublicConfiguration();
  const vaultConfigured = credentialVaultConfigured();
  const storedCredential = Boolean(
    stored.encrypted_api_key && stored.key_iv && stored.key_auth_tag,
  );
  const fallbackKey = !storedCredential
    ? environmentKey(stored.provider)
    : null;
  return {
    provider: stored.provider,
    providerLabel: aiProviderDefinitions[stored.provider].label,
    model: stored.model,
    configured: storedCredential ? vaultConfigured : Boolean(fallbackKey),
    credentialStored: storedCredential,
    vaultConfigured,
    keyHint: storedCredential
      ? stored.key_hint
      : fallbackKey
        ? "Environment secret"
        : null,
    keySource: storedCredential
      ? "database"
      : fallbackKey
        ? "environment"
        : "none",
    connectionStatus:
      storedCredential && !vaultConfigured
        ? "Vault unavailable"
        : storedCredential
          ? stored.connection_status
          : fallbackKey
            ? "Environment"
            : "Not configured",
    updatedAt: stored.updated_at.toISOString(),
  };
}

export async function getAiRuntimeConfiguration(
  orgId: string,
): Promise<AiRuntimeConfiguration> {
  const stored = await storedConfiguration(orgId);
  if (!stored) {
    const publicConfiguration = environmentPublicConfiguration();
    return {
      ...publicConfiguration,
      apiKey: environmentKey(publicConfiguration.provider),
      baseUrl: baseUrl(publicConfiguration.provider),
      timeoutMs: Number(
        process.env.AI_TIMEOUT_MS ?? process.env.XAI_TIMEOUT_MS ?? 120_000,
      ),
      maxOutputTokens: Number(
        process.env.AI_MAX_OUTPUT_TOKENS ??
          process.env.XAI_MAX_OUTPUT_TOKENS ??
          3_000,
      ),
    };
  }
  const publicConfiguration = await getAiPublicConfiguration(orgId);
  let apiKey = environmentKey(stored.provider);
  if (stored.encrypted_api_key && stored.key_iv && stored.key_auth_tag) {
    apiKey = decryptCredential(
      {
        ciphertext: stored.encrypted_api_key,
        iv: stored.key_iv,
        authTag: stored.key_auth_tag,
      },
      orgId,
      stored.provider,
    );
  }
  return {
    ...publicConfiguration,
    apiKey,
    baseUrl: baseUrl(stored.provider),
    timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 120_000),
    maxOutputTokens: Number(process.env.AI_MAX_OUTPUT_TOKENS ?? 3_000),
  };
}
