import { Nango } from "@nangohq/node";
import {
  isNangoConnectorId,
  type NangoConnectorId,
} from "./nango-connectors";

type Environment = NodeJS.ProcessEnv;

export class NangoConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NangoConfigurationError";
  }
}

const providerConfig = {
  int_zendesk: {
    environmentVariable: "NANGO_ZENDESK_INTEGRATION_ID",
    defaultValue: "zendesk",
  },
  int_intercom: {
    environmentVariable: "NANGO_INTERCOM_INTEGRATION_ID",
    defaultValue: "intercom",
  },
  int_slack: {
    environmentVariable: "NANGO_SLACK_INTEGRATION_ID",
    defaultValue: "slack",
  },
  int_app_store: {
    environmentVariable: "NANGO_APP_STORE_INTEGRATION_ID",
    defaultValue: "apple-app-store",
  },
  int_play_store: {
    environmentVariable: "NANGO_GOOGLE_PLAY_INTEGRATION_ID",
    defaultValue: "google-play",
  },
  int_github: {
    environmentVariable: "NANGO_GITHUB_INTEGRATION_ID",
    defaultValue: "github-getting-started",
  },
} as const satisfies Record<
  NangoConnectorId,
  { environmentVariable: string; defaultValue: string }
>;

function configuredValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isProductionEnvironment(environment: Environment): boolean {
  return (
    environment.APP_MODE === "production" ||
    (environment.APP_MODE !== "demo" && environment.NODE_ENV === "production")
  );
}

export function getNangoApiKey(
  environment: Environment = process.env,
): string | null {
  const preferred = configuredValue(environment.NANGO_API_KEY);
  if (preferred) return preferred;
  const environmentName = getNangoEnvironmentName(environment);
  return configuredValue(environment[`NANGO_SECRET_KEY_${environmentName}`]);
}

export function getNangoWebhookSigningKey(
  environment: Environment = process.env,
): string | null {
  return configuredValue(environment.NANGO_WEBHOOK_SIGNING_KEY);
}

export function getNangoEnvironmentName(
  environment: Environment = process.env,
): string {
  const explicit = configuredValue(environment.NANGO_ENVIRONMENT)?.toUpperCase();
  const value =
    explicit ?? (isProductionEnvironment(environment) ? "PROD" : "DEV");
  if (!/^[A-Z0-9][A-Z0-9_-]{0,79}$/.test(value))
    throw new NangoConfigurationError("Nango is not configured correctly.");
  return value;
}

export function getNangoHost(
  environment: Environment = process.env,
): string | undefined {
  const configured = configuredValue(environment.NANGO_HOST);
  if (!configured) return undefined;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new NangoConfigurationError("Nango is not configured correctly.");
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new NangoConfigurationError("Nango is not configured correctly.");
  return url.toString().replace(/\/$/, "");
}

export function resolveNangoProviderConfigKey(
  integrationId: string,
  environment: Environment = process.env,
): string {
  if (!isNangoConnectorId(integrationId))
    throw new NangoConfigurationError(
      "This integration is not available through Nango.",
    );
  const definition = providerConfig[integrationId];
  const value =
    configuredValue(environment[definition.environmentVariable]) ??
    definition.defaultValue;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value))
    throw new NangoConfigurationError("Nango is not configured correctly.");
  return value;
}

let cachedClient:
  | {
      fingerprint: string;
      client: Nango;
    }
  | undefined;

function buildNangoClient(requireWebhookSigningKey: boolean): Nango {
  const apiKey = getNangoApiKey();
  if (!apiKey)
    throw new NangoConfigurationError(
      "Nango is not configured for this environment.",
    );
  const webhookSigningKey = getNangoWebhookSigningKey();
  if (requireWebhookSigningKey && !webhookSigningKey)
    throw new NangoConfigurationError(
      "Nango webhook verification is not configured.",
    );
  const host = getNangoHost();
  const fingerprint = [apiKey, webhookSigningKey ?? "", host ?? ""].join("\0");
  if (cachedClient?.fingerprint === fingerprint) return cachedClient.client;
  const client = new Nango({
    apiKey,
    ...(webhookSigningKey ? { webhookSigningKey } : {}),
    ...(host ? { host } : {}),
  });
  cachedClient = { fingerprint, client };
  return client;
}

export function getNangoClient(): Nango {
  return buildNangoClient(false);
}

export function getNangoWebhookClient(): Nango {
  return buildNangoClient(true);
}
