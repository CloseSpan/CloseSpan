export const NANGO_CONNECTOR_IDS = [
  "int_zendesk",
  "int_intercom",
  "int_slack",
  "int_app_store",
  "int_play_store",
  "int_github",
] as const;

export type NangoConnectorId = (typeof NANGO_CONNECTOR_IDS)[number];

const nangoConnectorIds = new Set<string>(NANGO_CONNECTOR_IDS);

export function isNangoConnectorId(value: string): value is NangoConnectorId {
  return nangoConnectorIds.has(value);
}
