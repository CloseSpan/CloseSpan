export const PIPEDREAM_CONNECTORS = {
  int_zendesk: "zendesk",
  int_intercom: "intercom",
  int_slack: "slack",
  int_app_store: "app-store-connect",
  int_play_store: "google-play",
  int_github: "github",
  int_linear: "linear",
  int_jira: "jira",
  int_sentry: "sentry",
  int_posthog: "posthog",
} as const;

export type PipedreamConnectorId = keyof typeof PIPEDREAM_CONNECTORS;
export const PIPEDREAM_CONNECTOR_IDS = Object.keys(
  PIPEDREAM_CONNECTORS,
) as PipedreamConnectorId[];

const connectorIds = new Set<string>(PIPEDREAM_CONNECTOR_IDS);

export function isPipedreamConnectorId(
  value: string,
): value is PipedreamConnectorId {
  return connectorIds.has(value);
}

export function pipedreamAppSlug(
  integrationId: PipedreamConnectorId,
): string {
  const envKey = `PIPEDREAM_APP_${integrationId.replace(/^int_/, "").toUpperCase()}`;
  return process.env[envKey]?.trim() || PIPEDREAM_CONNECTORS[integrationId];
}
