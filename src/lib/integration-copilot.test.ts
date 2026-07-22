import { describe, expect, it } from "vitest";
import {
  deterministicIntegrationCopilot,
  runIntegrationCopilot,
} from "./integration-copilot";

const base = {
  history: [],
  connectedIntegrationIds: [],
  productProfile: null,
};

describe("integration copilot", () => {
  it("resolves a direct Zendesk request to the supported connector", () => {
    const result = deterministicIntegrationCopilot({
      ...base,
      message: "Connect Zendesk",
    });
    expect(result?.connectors).toEqual([
      expect.objectContaining({
        integrationId: "int_zendesk",
        mode: "connect",
      }),
    ]);
    expect(result?.connectors[0]?.reason).toContain("manual feedback pull");
  });

  it("uses authoritative connection state to offer management", () => {
    const result = deterministicIntegrationCopilot({
      ...base,
      message: "Connect Zendesk",
      connectedIntegrationIds: ["int_zendesk"],
    });
    expect(result?.connectors[0]).toEqual(
      expect.objectContaining({ integrationId: "int_zendesk", mode: "manage" }),
    );
    expect(result?.assistantMessage).toContain("already connected");
  });

  it("does not claim Intercom feedback import is active", () => {
    const result = deterministicIntegrationCopilot({
      ...base,
      message: "Add Intercom",
    });
    expect(result?.connectors[0]?.reason).toContain(
      "feedback import for this source is not active yet",
    );
  });

  it("offers webhook explicitly for an unsupported source", () => {
    const result = deterministicIntegrationCopilot({
      ...base,
      message: "Connect Salesforce",
    });
    expect(result?.assistantMessage).toContain("not in the native catalog");
    expect(result?.connectors).toEqual([
      expect.objectContaining({ integrationId: "int_webhook" }),
    ]);
  });

  it("returns safe catalog recommendations when no model is configured", async () => {
    const result = await runIntegrationCopilot({
      ...base,
      message: "What sources should I use?",
      configuration: null,
    });
    expect(result.source).toBe("catalog");
    expect(result.connectors.length).toBeGreaterThan(0);
    expect(result.connectors.every((connector) => connector.integrationId.startsWith("int_"))).toBe(true);
  });
});
