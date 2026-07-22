export type IntegrationFilter =
  | "All"
  | "Feedback"
  | "Engineering"
  | "Analytics"
  | "Support";

export type IntegrationGroup = "Connected" | "Recommended" | "Coming soon";

export function isSimulatedConnectedState(state: string): boolean {
  return /^(?:demo connected|demo configured|seeded sample|simulated connected)$/i
    .test(state.trim());
}

export interface IntegrationExperience {
  filter: Exclude<IntegrationFilter, "All">;
  summary: string;
  importedData: readonly string[];
  requestedPermissions: readonly string[];
}

const experiences: Record<string, IntegrationExperience> = {
  int_webhook: {
    filter: "Feedback",
    summary: "Send feedback from your product or any unsupported system.",
    importedData: ["Feedback text", "Customer reference", "Source metadata", "Event timestamp"],
    requestedPermissions: ["Signed inbound requests only"],
  },
  int_zendesk: {
    filter: "Support",
    summary: "Turn support tickets and conversations into product signals.",
    importedData: ["Tickets", "Comments", "Tags", "Customer and organization references"],
    requestedPermissions: ["Read tickets", "Read users", "Read organizations"],
  },
  int_intercom: {
    filter: "Support",
    summary: "Import customer conversations and support context from Intercom.",
    importedData: ["Conversations", "Messages", "Tags", "Contact references"],
    requestedPermissions: ["Read conversations", "Read contacts", "Read tags"],
  },
  int_slack: {
    filter: "Feedback",
    summary: "Capture high-signal feedback from selected Slack channels.",
    importedData: ["Messages", "Threads", "Reactions", "Channel references"],
    requestedPermissions: ["Read selected channels", "Read message history", "Read basic profiles"],
  },
  int_app_store: {
    filter: "Feedback",
    summary: "Continuously import reviews submitted through Apple’s App Store.",
    importedData: ["Reviews", "Ratings", "App version", "Region and timestamp"],
    requestedPermissions: ["Read app information", "Read customer reviews"],
  },
  int_play_store: {
    filter: "Feedback",
    summary: "Continuously import reviews from your Google Play listings.",
    importedData: ["Reviews", "Ratings", "App version", "Device and timestamp"],
    requestedPermissions: ["Read app information", "Read customer reviews"],
  },
  int_github: {
    filter: "Engineering",
    summary: "Route approved product work into GitHub issues and pull requests.",
    importedData: ["Repository metadata", "Issue status", "Pull request status"],
    requestedPermissions: ["Read repository metadata", "Create approved issues", "Read pull request status"],
  },
  int_jira: {
    filter: "Engineering",
    summary: "Create and track approved delivery work in Jira projects.",
    importedData: ["Project metadata", "Issue status", "Assignee references"],
    requestedPermissions: ["Read projects", "Create approved issues", "Read issue status"],
  },
  int_linear: {
    filter: "Engineering",
    summary: "Create approved product issues and follow delivery progress in Linear.",
    importedData: ["Team metadata", "Issue status", "Cycle references"],
    requestedPermissions: ["Read teams", "Create approved issues", "Read issue status"],
  },
  int_sentry: {
    filter: "Analytics",
    summary: "Pair customer feedback with crashes and production errors.",
    importedData: ["Issues", "Error frequency", "Release", "Environment metadata"],
    requestedPermissions: ["Read projects", "Read issues", "Read releases"],
  },
  int_posthog: {
    filter: "Analytics",
    summary: "Add product usage context to customer-reported problems.",
    importedData: ["Events", "Feature flags", "Session references", "Cohort metadata"],
    requestedPermissions: ["Read project data", "Read events", "Read feature flags"],
  },
};

export function getIntegrationExperience(
  integration: { id: string; category: string; provider: string },
): IntegrationExperience {
  return experiences[integration.id] ?? {
    filter:
      integration.category === "Engineering"
        ? "Engineering"
        : integration.category === "Analytics" || integration.category === "Observability"
          ? "Analytics"
          : "Feedback",
    summary: `Connect ${integration.provider} to your CloseSpan workspace.`,
    importedData: ["Relevant workspace records", "Source metadata", "Timestamps"],
    requestedPermissions: ["Least-privilege read access"],
  };
}

export function getIntegrationGroup({
  connected,
  available,
}: {
  connected: boolean;
  available: boolean;
}): IntegrationGroup {
  if (connected) return "Connected";
  return available ? "Recommended" : "Coming soon";
}
