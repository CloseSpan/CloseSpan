import { describe, expect, it } from "vitest";
import {
  buildIntegrationSuggestions,
  inspectionModeForActivity,
  type IntegrationSuggestionConnector,
  type IntegrationSuggestionPipedreamActivity,
} from "./integration-suggestions";

const connector = (
  input: Partial<IntegrationSuggestionConnector> &
    Pick<IntegrationSuggestionConnector, "id" | "name">,
): IntegrationSuggestionConnector => ({
  available: true,
  connected: false,
  feedbackSource: true,
  state: "Not connected",
  lastSync: null,
  filter: "Feedback",
  summary: `Connect ${input.name}.`,
  ...input,
});

const activity = (
  input: Partial<IntegrationSuggestionPipedreamActivity> &
    Pick<IntegrationSuggestionPipedreamActivity, "integrationId">,
): IntegrationSuggestionPipedreamActivity => ({
  connectionState: "Connected",
  lastImportStatus: null,
  lastImportAt: null,
  lastImportCount: 0,
  ...input,
});

describe("integration suggestions", () => {
  it("puts persisted recommendations first and fills at most three suggestions", () => {
    const items = buildIntegrationSuggestions({
      orgId: "org_one",
      connectors: [
        connector({ id: "int_webhook", name: "Custom webhook" }),
        connector({ id: "int_zendesk", name: "Zendesk" }),
        connector({ id: "int_slack", name: "Slack" }),
        connector({ id: "int_intercom", name: "Intercom" }),
      ],
      recommendations: [
        {
          integrationId: "int_slack",
          reason: "Customers discuss the product in Slack.",
          priority: "recommended",
        },
        {
          integrationId: "int_zendesk",
          reason: "Support tickets contain the clearest customer language.",
          priority: "required",
        },
      ],
      pipedreamActivity: [],
    });

    expect(items.map((item) => item.integrationId)).toEqual([
      "int_zendesk",
      "int_slack",
      "int_webhook",
    ]);
    expect(items.every((item) => item.section === "Suggested")).toBe(true);
    expect(items[0]?.description).toContain("Support tickets");
  });

  it("omits unavailable and already-connected connectors from suggestions", () => {
    const items = buildIntegrationSuggestions({
      orgId: "org_two",
      connectors: [
        connector({ id: "int_zendesk", name: "Zendesk", connected: true }),
        connector({ id: "int_future", name: "Future", available: false }),
      ],
      recommendations: [
        { integrationId: "int_zendesk", reason: "Recommended." },
        { integrationId: "int_future", reason: "Unavailable." },
      ],
      pipedreamActivity: [activity({ integrationId: "int_zendesk" })],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      orgId: "org_two",
      integrationId: "int_zendesk",
      section: "Review",
      primaryAction: { kind: "pull" },
    });
    expect(JSON.parse(JSON.stringify(items))).toEqual(items);
  });

  it("maps a running Zendesk pull to Working", () => {
    const items = buildIntegrationSuggestions({
      orgId: "org_one",
      connectors: [
        connector({ id: "int_zendesk", name: "Zendesk", connected: true }),
      ],
      recommendations: [],
      pipedreamActivity: [
        activity({
          integrationId: "int_zendesk",
          lastImportStatus: "Running",
        }),
      ],
    });

    expect(items[0]).toMatchObject({
      section: "Working",
      title: "Pulling feedback from Zendesk",
      primaryAction: { kind: "review_details", label: "View progress" },
    });
    expect(inspectionModeForActivity(items[0]!)).toBe("progress");
  });

  it("keeps non-working suggestions in the connector details view", () => {
    const items = buildIntegrationSuggestions({
      orgId: "org_one",
      connectors: [connector({ id: "int_slack", name: "Slack" })],
      recommendations: [
        { integrationId: "int_slack", reason: "Read customer channels." },
      ],
      pipedreamActivity: [],
    });

    expect(inspectionModeForActivity(items[0]!)).toBe("details");
  });

  it("aggregates multiple accounts deterministically with attention precedence", () => {
    const baseInput = {
      orgId: "org_one",
      connectors: [
        connector({ id: "int_zendesk", name: "Zendesk", connected: true }),
      ],
      recommendations: [],
    } as const;

    const needsReconnect = buildIntegrationSuggestions({
      ...baseInput,
      pipedreamActivity: [
        activity({
          integrationId: "int_zendesk",
          lastImportStatus: "Running",
        }),
        activity({
          integrationId: "int_zendesk",
          connectionState: "Needs reconnect",
          lastImportStatus: "Succeeded",
          lastImportAt: "2026-07-21T11:00:00.000Z",
          lastImportCount: 4,
        }),
      ],
    });
    expect(needsReconnect[0]).toMatchObject({
      section: "Review",
      primaryAction: { kind: "reconnect" },
    });

    const failed = buildIntegrationSuggestions({
      ...baseInput,
      pipedreamActivity: [
        activity({
          integrationId: "int_zendesk",
          lastImportStatus: "Succeeded",
          lastImportAt: "2026-07-21T13:00:00.000Z",
          lastImportCount: 12,
        }),
        activity({
          integrationId: "int_zendesk",
          lastImportStatus: "Failed",
          lastImportAt: "2026-07-21T10:00:00.000Z",
          lastImportCount: 2,
        }),
        activity({
          integrationId: "int_zendesk",
          lastImportStatus: "Failed",
          lastImportAt: "2026-07-21T12:00:00.000Z",
          lastImportCount: 5,
        }),
      ],
    });
    expect(failed[0]).toMatchObject({
      section: "Review",
      at: "2026-07-21T12:00:00.000Z",
      count: 5,
      primaryAction: { kind: "retry_import" },
    });
  });

  it("maps pending setup to Working and connection failures to Review", () => {
    const items = buildIntegrationSuggestions({
      orgId: "org_one",
      connectors: [
        connector({
          id: "int_github",
          name: "GitHub",
          feedbackSource: false,
          state: "Pending setup",
        }),
        connector({
          id: "int_slack",
          name: "Slack",
          state: "Connection failed",
        }),
      ],
      recommendations: [
        { integrationId: "int_github", reason: "Ship approved work." },
        { integrationId: "int_slack", reason: "Read customer channels." },
      ],
      pipedreamActivity: [],
    });

    expect(items).toEqual([
      expect.objectContaining({
        integrationId: "int_github",
        section: "Working",
        title: "Connecting GitHub",
      }),
      expect.objectContaining({
        integrationId: "int_slack",
        section: "Review",
        primaryAction: { kind: "connect", label: "Try again" },
      }),
    ]);
  });

  it("gives reconnect and failed imports precedence as Review work", () => {
    const items = buildIntegrationSuggestions({
      orgId: "org_one",
      connectors: [
        connector({ id: "int_zendesk", name: "Zendesk", connected: true }),
        connector({ id: "int_slack", name: "Slack", connected: true }),
      ],
      recommendations: [],
      pipedreamActivity: [
        activity({
          integrationId: "int_zendesk",
          connectionState: "Needs reconnect",
          lastImportStatus: "Running",
        }),
        activity({
          integrationId: "int_slack",
          lastImportStatus: "Failed",
        }),
      ],
    });

    expect(items).toEqual([
      expect.objectContaining({
        integrationId: "int_zendesk",
        section: "Review",
        primaryAction: { kind: "reconnect", label: "Reconnect" },
      }),
      expect.objectContaining({
        integrationId: "int_slack",
        section: "Review",
        primaryAction: { kind: "review_details", label: "Review details" },
      }),
    ]);
    expect(items[1]?.title.toLowerCase()).not.toContain("import");
    expect(items[1]?.description.toLowerCase()).not.toContain("import");
  });

  it("explains that repository context never started after GitHub setup expires", () => {
    const items = buildIntegrationSuggestions({
      orgId: "org_one",
      connectors: [
        connector({
          id: "int_github",
          name: "GitHub",
          feedbackSource: false,
          state: "Connection failed",
        }),
      ],
      recommendations: [],
      pipedreamActivity: [],
    });

    expect(items).toEqual([
      expect.objectContaining({
        section: "Review",
        title: "GitHub repository connection expired",
        description: expect.stringContaining("Repository context has not started"),
        primaryAction: {
          kind: "connect",
          label: "Retry GitHub connection",
        },
      }),
    ]);
  });

  it("offers the first pull for connected Zendesk and records successful pulls as Done", () => {
    const baseInput = {
      orgId: "org_one",
      connectors: [
        connector({ id: "int_zendesk", name: "Zendesk", connected: true }),
      ],
      recommendations: [],
    } as const;

    const firstPull = buildIntegrationSuggestions({
      ...baseInput,
      pipedreamActivity: [activity({ integrationId: "int_zendesk" })],
    });
    expect(firstPull[0]).toMatchObject({
      section: "Review",
      primaryAction: { kind: "pull", label: "Pull feedback" },
    });

    const completed = buildIntegrationSuggestions({
      ...baseInput,
      pipedreamActivity: [
        activity({
          integrationId: "int_zendesk",
          lastImportStatus: "Succeeded",
          lastImportAt: "2026-07-21T12:00:00.000Z",
          lastImportCount: 3,
        }),
      ],
    });
    expect(completed[0]).toMatchObject({
      section: "Done",
      at: "2026-07-21T12:00:00.000Z",
      count: 3,
    });
    expect(completed[0]?.description).toContain("3 feedback records were processed");
  });

  it("marks simulated Zendesk data done instead of asking for a live pull", () => {
    const items = buildIntegrationSuggestions({
      orgId: "org_demo",
      connectors: [
        connector({
          id: "int_zendesk",
          name: "Zendesk",
          connected: true,
          state: "Demo connected",
          lastSync: "2026-07-21T12:00:00.000Z",
        }),
      ],
      recommendations: [],
      pipedreamActivity: [],
    });

    expect(items[0]).toMatchObject({
      section: "Done",
      title: "Zendesk demo data is ready",
      primaryAction: { kind: "review_details", label: "View demo details" },
    });
    expect(items[0]?.description).toContain("No live account");
  });

  it("marks webhook and action destinations Done without claiming unsupported imports", () => {
    const items = buildIntegrationSuggestions({
      orgId: "org_one",
      connectors: [
        connector({
          id: "int_webhook",
          name: "Custom webhook",
          connected: true,
          lastSync: "2026-07-21T11:00:00.000Z",
        }),
        connector({
          id: "int_github",
          name: "GitHub",
          connected: true,
          feedbackSource: false,
          filter: "Engineering",
        }),
        connector({
          id: "int_intercom",
          name: "Intercom",
          connected: true,
          filter: "Support",
        }),
      ],
      recommendations: [],
      pipedreamActivity: [
        activity({ integrationId: "int_github" }),
        activity({ integrationId: "int_intercom" }),
      ],
    });

    expect(items.every((item) => item.section === "Done")).toBe(true);
    expect(items.find((item) => item.integrationId === "int_webhook")).toMatchObject({
      at: "2026-07-21T11:00:00.000Z",
    });
    const unsupported = items.find(
      (item) => item.integrationId === "int_intercom",
    );
    expect(unsupported?.description.toLowerCase()).not.toContain("import");
    expect(unsupported?.description.toLowerCase()).not.toContain("sync");
  });

  it("orders sections as Suggested, Working, Review, and Done", () => {
    const items = buildIntegrationSuggestions({
      orgId: "org_one",
      connectors: [
        connector({ id: "int_github", name: "GitHub", connected: true, feedbackSource: false }),
        connector({ id: "int_zendesk", name: "Zendesk", connected: true }),
        connector({ id: "int_slack", name: "Slack", connected: true }),
        connector({ id: "int_webhook", name: "Custom webhook" }),
      ],
      recommendations: [
        { integrationId: "int_webhook", reason: "Capture first-party feedback." },
      ],
      pipedreamActivity: [
        activity({ integrationId: "int_github" }),
        activity({ integrationId: "int_zendesk", lastImportStatus: "Running" }),
        activity({ integrationId: "int_slack", connectionState: "Needs reconnect" }),
      ],
    });

    expect(items.map((item) => item.section)).toEqual([
      "Suggested",
      "Working",
      "Review",
      "Done",
    ]);
  });
});
