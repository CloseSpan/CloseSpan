import { describe, expect, it } from "vitest";
import {
  isNangoConnectorId,
  NANGO_CONNECTOR_IDS,
} from "./nango-connectors";

describe("Nango connector allowlist", () => {
  it("contains only the supported tenant connector IDs", () => {
    expect(NANGO_CONNECTOR_IDS).toEqual([
      "int_zendesk",
      "int_intercom",
      "int_slack",
      "int_app_store",
      "int_play_store",
      "int_github",
    ]);
    expect(new Set(NANGO_CONNECTOR_IDS).size).toBe(NANGO_CONNECTOR_IDS.length);
  });

  it.each(NANGO_CONNECTOR_IDS)("accepts %s", (connectorId) => {
    expect(isNangoConnectorId(connectorId)).toBe(true);
  });

  it.each([
    "",
    "zendesk",
    "int_appstore",
    "int_play",
    "int_custom_webhook",
    "INT_GITHUB",
    "int_github ",
  ])("rejects non-allowlisted value %j", (connectorId) => {
    expect(isNangoConnectorId(connectorId)).toBe(false);
  });
});
