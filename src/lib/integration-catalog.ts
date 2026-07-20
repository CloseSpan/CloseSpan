export interface IntegrationCatalogEntry {
  id: string;
  provider: string;
  category: "Feedback" | "Engineering" | "CRM" | "Observability" | "Analytics" | "Reviews" | "Custom";
  displayOrder: number;
  connectionMethod: "webhook" | "oauth" | "settings";
  feedbackSource: boolean;
  agentKeywords: readonly string[];
}

export interface ConnectorCatalogEntry {
  id: string;
  provider: string;
  category: IntegrationCatalogEntry["category"];
  connectionMethod: IntegrationCatalogEntry["connectionMethod"];
  feedbackSource: boolean;
  description: string;
}

export const integrationCatalog: readonly IntegrationCatalogEntry[] = [
  {
    id: "int_webhook",
    provider: "Custom webhook",
    category: "Custom",
    displayOrder: 0,
    connectionMethod: "webhook",
    feedbackSource: true,
    agentKeywords: ["custom", "webhook", "api", "database", "in-app", "own app"],
  },
  {
    id: "int_zendesk",
    provider: "Zendesk",
    category: "Feedback",
    displayOrder: 1,
    connectionMethod: "oauth",
    feedbackSource: true,
    agentKeywords: ["zendesk", "support ticket", "help desk"],
  },
  {
    id: "int_intercom",
    provider: "Intercom",
    category: "Feedback",
    displayOrder: 2,
    connectionMethod: "oauth",
    feedbackSource: true,
    agentKeywords: ["intercom", "in-app chat", "messenger"],
  },
  {
    id: "int_slack",
    provider: "Slack",
    category: "Feedback",
    displayOrder: 3,
    connectionMethod: "oauth",
    feedbackSource: true,
    agentKeywords: ["slack", "channel"],
  },
  {
    id: "int_app_store",
    provider: "Apple App Store",
    category: "Reviews",
    displayOrder: 4,
    connectionMethod: "oauth",
    feedbackSource: true,
    agentKeywords: [
      "app store",
      "ios",
      "iphone",
      "apple review",
      "testflight",
    ],
  },
  {
    id: "int_play_store",
    provider: "Google Play Store",
    category: "Reviews",
    displayOrder: 5,
    connectionMethod: "oauth",
    feedbackSource: true,
    agentKeywords: [
      "play store",
      "google play",
      "android",
      "apk",
      "play review",
    ],
  },
  {
    id: "int_github",
    provider: "GitHub",
    category: "Engineering",
    displayOrder: 8,
    connectionMethod: "oauth",
    feedbackSource: false,
    agentKeywords: ["github", "repo", "pull request", "issue"],
  },
  {
    id: "int_linear",
    provider: "Linear",
    category: "Engineering",
    displayOrder: 7,
    connectionMethod: "oauth",
    feedbackSource: false,
    agentKeywords: ["linear"],
  },
  {
    id: "int_jira",
    provider: "Jira",
    category: "Engineering",
    displayOrder: 6,
    connectionMethod: "oauth",
    feedbackSource: false,
    agentKeywords: ["jira", "atlassian"],
  },
  {
    id: "int_sentry",
    provider: "Sentry",
    category: "Observability",
    displayOrder: 11,
    connectionMethod: "oauth",
    feedbackSource: true,
    agentKeywords: ["sentry", "error", "crash"],
  },
  {
    id: "int_posthog",
    provider: "PostHog",
    category: "Analytics",
    displayOrder: 13,
    connectionMethod: "oauth",
    feedbackSource: true,
    agentKeywords: ["posthog", "analytics", "session replay"],
  },
];

export const connectorCatalogForAgent: readonly ConnectorCatalogEntry[] =
  integrationCatalog.map((entry) => ({
    id: entry.id,
    provider: entry.provider,
    category: entry.category,
    connectionMethod: entry.connectionMethod,
    feedbackSource: entry.feedbackSource,
    description: entry.feedbackSource
      ? `${entry.provider} ingests customer feedback into Feelow.`
      : `${entry.provider} receives approved agent actions after human review.`,
  }));

export function inferConnectorsFromText(text: string): Array<{
  integrationId: string;
  provider: string;
  reason: string;
  priority: "required" | "recommended" | "optional";
  connectionMethod: IntegrationCatalogEntry["connectionMethod"];
}> {
  const lower = text.toLowerCase();
  const matches = integrationCatalog.filter((entry) =>
    entry.agentKeywords.some((keyword) => lower.includes(keyword)),
  );
  const selected =
    matches.length > 0
      ? matches
      : integrationCatalog.filter((entry) => entry.id === "int_webhook");

  const hasFeedback = selected.some((entry) => entry.feedbackSource);
  const withWebhook =
    hasFeedback || selected.some((entry) => entry.id === "int_webhook")
      ? selected
      : [integrationCatalog[0], ...selected];

  const unique = new Map(withWebhook.map((entry) => [entry.id, entry]));
  return [...unique.values()].map((entry, index) => ({
    integrationId: entry.id,
    provider: entry.provider,
    reason: entry.feedbackSource
      ? `Customer feedback likely flows through ${entry.provider}.`
      : `Approved work can land in ${entry.provider}.`,
    priority: index === 0 ? "required" : index < 3 ? "recommended" : "optional",
    connectionMethod: entry.connectionMethod,
  }));
}

export function catalogSqlValues(orgId: string): string {
  return integrationCatalog
    .map(
      (entry) =>
        `('${entry.id}','${orgId}','${entry.provider.replace(/'/g, "''")}','${entry.category}','Not connected','None','[]',${entry.displayOrder})`,
    )
    .join(",\n");
}
