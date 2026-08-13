import { isSimulatedConnectedState } from "./integration-ui";

export type IntegrationActivitySection =
  | "Suggested"
  | "Working"
  | "Review"
  | "Done";

export type IntegrationInspectionMode = "details" | "progress";

export type IntegrationActivityActionKind =
  | "connect"
  | "reconnect"
  | "pull"
  | "retry_import"
  | "review_details";

export interface IntegrationSuggestionConnector {
  id: string;
  name: string;
  available: boolean;
  connected: boolean;
  feedbackSource: boolean;
  state: string;
  lastSync: string | null;
  filter: string;
  summary: string;
}

export interface IntegrationSuggestionRecommendation {
  integrationId: string;
  reason: string;
  priority?: "required" | "recommended" | "optional";
}

export interface IntegrationSuggestionPipedreamActivity {
  integrationId: string;
  connectionState: "Connected" | "Needs reconnect" | "Disconnected" | null;
  lastImportStatus: "Running" | "Succeeded" | "Failed" | null;
  lastImportAt: string | null;
  lastImportCount: number;
}

export interface IntegrationActivityAction {
  kind: IntegrationActivityActionKind;
  label: string;
}

/**
 * Serializable, tenant-scoped view model for the integration activity list.
 * Every item is derived from data already scoped to one organization.
 */
export interface IntegrationActivityItem {
  id: string;
  orgId: string;
  section: IntegrationActivitySection;
  integrationId: string;
  connectorName: string;
  filter: string;
  title: string;
  description: string;
  at: string | null;
  count: number | null;
  primaryAction: IntegrationActivityAction;
  secondaryAction: IntegrationActivityAction | null;
}

export function inspectionModeForActivity(
  item: IntegrationActivityItem,
): IntegrationInspectionMode {
  return item.section === "Working" ? "progress" : "details";
}

export interface IntegrationSuggestionsInput {
  orgId: string;
  connectors: readonly IntegrationSuggestionConnector[];
  recommendations: readonly IntegrationSuggestionRecommendation[];
  pipedreamActivity: readonly IntegrationSuggestionPipedreamActivity[];
}

const sectionOrder: Readonly<Record<IntegrationActivitySection, number>> = {
  Suggested: 0,
  Working: 1,
  Review: 2,
  Done: 3,
};

const recommendationPriority: Readonly<Record<NonNullable<IntegrationSuggestionRecommendation["priority"]>, number>> = {
  required: 0,
  recommended: 1,
  optional: 2,
};

function action(
  kind: IntegrationActivityActionKind,
  label: string,
): IntegrationActivityAction {
  return { kind, label };
}

function baseItem(input: {
  orgId: string;
  connector: IntegrationSuggestionConnector;
  section: IntegrationActivitySection;
  suffix: string;
  title: string;
  description: string;
  at?: string | null;
  count?: number | null;
  primaryAction: IntegrationActivityAction;
  secondaryAction?: IntegrationActivityAction | null;
}): IntegrationActivityItem {
  return {
    id: `${input.orgId}:${input.connector.id}:${input.suffix}`,
    orgId: input.orgId,
    section: input.section,
    integrationId: input.connector.id,
    connectorName: input.connector.name,
    filter: input.connector.filter,
    title: input.title,
    description: input.description,
    at: input.at ?? null,
    count: input.count ?? null,
    primaryAction: input.primaryAction,
    secondaryAction: input.secondaryAction ?? null,
  };
}

function isConnected(
  connector: IntegrationSuggestionConnector,
  activity: IntegrationSuggestionPipedreamActivity | undefined,
): boolean {
  if (activity?.connectionState === "Connected") return true;
  if (
    activity?.connectionState === "Needs reconnect" ||
    activity?.connectionState === "Disconnected"
  ) {
    return false;
  }
  return connector.connected || connector.state === "Connected";
}

function hasConnection(
  connector: IntegrationSuggestionConnector,
  activity: IntegrationSuggestionPipedreamActivity | undefined,
): boolean {
  return (
    activity?.connectionState === "Connected" ||
    activity?.connectionState === "Needs reconnect" ||
    connector.connected ||
    connector.state === "Connected" ||
    connector.state === "Needs reconnect"
  );
}

function normalizedConnectorState(
  connector: IntegrationSuggestionConnector,
): string {
  return connector.state.trim().toLowerCase();
}

function setupIsWorking(connector: IntegrationSuggestionConnector): boolean {
  return /pending|connecting|authoriz|opening|waiting/.test(
    normalizedConnectorState(connector),
  );
}

function setupHasFailed(connector: IntegrationSuggestionConnector): boolean {
  return /fail|error/.test(normalizedConnectorState(connector));
}

function hasConnectorActivity(
  connector: IntegrationSuggestionConnector,
  activity: IntegrationSuggestionPipedreamActivity | undefined,
): boolean {
  return (
    hasConnection(connector, activity) ||
    setupIsWorking(connector) ||
    setupHasFailed(connector)
  );
}

function timestamp(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function representativeActivity(
  rows: readonly IntegrationSuggestionPipedreamActivity[],
  status: IntegrationSuggestionPipedreamActivity["lastImportStatus"],
): IntegrationSuggestionPipedreamActivity | undefined {
  return rows
    .filter((row) => row.lastImportStatus === status)
    .sort((left, right) => {
      const timeDifference =
        timestamp(right.lastImportAt) - timestamp(left.lastImportAt);
      if (timeDifference !== 0) return timeDifference;
      return right.lastImportCount - left.lastImportCount;
    })[0];
}

function aggregatePipedreamActivity(
  rows: readonly IntegrationSuggestionPipedreamActivity[],
): IntegrationSuggestionPipedreamActivity | undefined {
  const first = rows[0];
  if (!first) return undefined;
  const connectionState = rows.some(
    (row) => row.connectionState === "Needs reconnect",
  )
    ? "Needs reconnect"
    : rows.some((row) => row.connectionState === "Connected")
      ? "Connected"
      : rows.some((row) => row.connectionState === "Disconnected")
        ? "Disconnected"
        : null;
  const lastImportStatus = rows.some(
    (row) => row.lastImportStatus === "Running",
  )
    ? "Running"
    : rows.some((row) => row.lastImportStatus === "Failed")
      ? "Failed"
      : rows.some((row) => row.lastImportStatus === "Succeeded")
        ? "Succeeded"
        : null;
  const representative = representativeActivity(rows, lastImportStatus);
  return {
    integrationId: first.integrationId,
    connectionState,
    lastImportStatus,
    lastImportAt: representative?.lastImportAt ?? null,
    lastImportCount: representative?.lastImportCount ?? 0,
  };
}

function connectedActivityItem(input: {
  orgId: string;
  connector: IntegrationSuggestionConnector;
  activity: IntegrationSuggestionPipedreamActivity | undefined;
}): IntegrationActivityItem | null {
  const { orgId, connector, activity } = input;
  const connectionState = activity?.connectionState ??
    (connector.state === "Needs reconnect" ? "Needs reconnect" : null);

  if (connectionState === "Needs reconnect") {
    return baseItem({
      orgId,
      connector,
      section: "Review",
      suffix: "reconnect",
      title: `Reconnect ${connector.name}`,
      description:
        "The connected account needs authorization before CloseSpan can continue.",
      primaryAction: action("reconnect", "Reconnect"),
      secondaryAction: action("review_details", "Review details"),
    });
  }

  if (activity?.lastImportStatus === "Failed") {
    const zendesk = connector.id === "int_zendesk";
    return baseItem({
      orgId,
      connector,
      section: "Review",
      suffix: "failed",
      title: zendesk
        ? `${connector.name} feedback pull needs attention`
        : `${connector.name} needs attention`,
      description: zendesk
        ? "The last feedback pull failed. Retry it, or review the connection details."
        : "The last account operation did not finish. Review the connection details before trying again.",
      at: activity.lastImportAt,
      count: activity.lastImportCount,
      primaryAction: zendesk
        ? action("retry_import", "Retry feedback pull")
        : action("review_details", "Review details"),
      secondaryAction: zendesk
        ? action("review_details", "Review details")
        : null,
    });
  }

  if (setupHasFailed(connector)) {
    return baseItem({
      orgId,
      connector,
      section: "Review",
      suffix: "connection-failed",
      title: `${connector.name} connection needs attention`,
      description:
        "The secure connection did not finish. Try again, or review the connector details.",
      primaryAction: action("connect", "Try again"),
      secondaryAction: action("review_details", "Review details"),
    });
  }

  if (activity?.lastImportStatus === "Running") {
    const zendesk = connector.id === "int_zendesk";
    return baseItem({
      orgId,
      connector,
      section: "Working",
      suffix: "working",
      title: zendesk
        ? `Pulling feedback from ${connector.name}`
        : `Checking ${connector.name}`,
      description: zendesk
        ? "CloseSpan is fetching and normalizing feedback. You can keep working while it finishes."
        : "CloseSpan is checking the connected account. You can keep working while it finishes.",
      at: activity.lastImportAt,
      count: activity.lastImportCount,
      primaryAction: action("review_details", "View progress"),
    });
  }

  if (setupIsWorking(connector)) {
    return baseItem({
      orgId,
      connector,
      section: "Working",
      suffix: "connecting",
      title: `Connecting ${connector.name}`,
      description:
        "CloseSpan is waiting for the secure account connection to finish.",
      primaryAction: action("review_details", "View progress"),
    });
  }

  if (!isConnected(connector, activity)) return null;

  if (isSimulatedConnectedState(connector.state)) {
    return baseItem({
      orgId,
      connector,
      section: "Done",
      suffix: "demo-ready",
      title: `${connector.name} demo data is ready`,
      description: connector.feedbackSource
        ? "Seeded feedback is available for the guided demo. No live account or external import is used."
        : "The simulated action destination is ready for the guided demo. No external request is made.",
      at: connector.lastSync,
      primaryAction: action("review_details", "View demo details"),
    });
  }

  if (
    connector.id === "int_zendesk" &&
    activity?.lastImportStatus !== "Succeeded" &&
    !activity?.lastImportAt
  ) {
    return baseItem({
      orgId,
      connector,
      section: "Review",
      suffix: "first-pull",
      title: "Pull your first Zendesk feedback",
      description:
        "Zendesk is connected. Pull feedback now to populate the Feedback inbox.",
      primaryAction: action("pull", "Pull feedback"),
      secondaryAction: action("review_details", "Review details"),
    });
  }

  if (
    connector.id === "int_zendesk" &&
    activity?.lastImportStatus === "Succeeded"
  ) {
    const count = Math.max(0, activity.lastImportCount);
    return baseItem({
      orgId,
      connector,
      section: "Done",
      suffix: "imported",
      title: "Zendesk feedback pull completed",
      description:
        count > 0
          ? `${count.toLocaleString()} feedback record${count === 1 ? " was" : "s were"} processed in the last pull.`
          : "The last feedback pull completed with no new or updated records.",
      at: activity.lastImportAt,
      count,
      primaryAction: action("review_details", "View details"),
    });
  }

  if (connector.id === "int_webhook") {
    return baseItem({
      orgId,
      connector,
      section: "Done",
      suffix: "connected",
      title: "Custom webhook is connected",
      description: connector.lastSync
        ? "The webhook has received a signed feedback event."
        : "The webhook is ready to receive signed feedback events.",
      at: connector.lastSync,
      primaryAction: action("review_details", "View details"),
    });
  }

  return baseItem({
    orgId,
    connector,
    section: "Done",
    suffix: "connected",
    title: `${connector.name} is connected`,
    description: connector.feedbackSource
      ? "Account authentication is complete. Review details for the capabilities currently available."
      : "Account authentication is complete. Review details before routing approved work.",
    at: activity?.lastImportAt ?? connector.lastSync,
    primaryAction: action("review_details", "View details"),
  });
}

/**
 * Builds a deterministic activity snapshot from one organization's connector
 * metadata, persisted onboarding recommendations, and Pipedream state.
 */
export function buildIntegrationSuggestions(
  input: IntegrationSuggestionsInput,
): IntegrationActivityItem[] {
  const connectors = input.connectors.filter((connector) => connector.available);
  const connectorById = new Map(
    connectors.map((connector) => [connector.id, connector]),
  );
  const activityRowsById = new Map<
    string,
    IntegrationSuggestionPipedreamActivity[]
  >();
  for (const activity of input.pipedreamActivity) {
    const current = activityRowsById.get(activity.integrationId) ?? [];
    current.push(activity);
    activityRowsById.set(activity.integrationId, current);
  }
  const activityById = new Map(
    [...activityRowsById].map(([integrationId, rows]) => [
      integrationId,
      aggregatePipedreamActivity(rows),
    ]),
  );

  const connectedItems = connectors
    .map((connector) =>
      connectedActivityItem({
        orgId: input.orgId,
        connector,
        activity: activityById.get(connector.id),
      }),
    )
    .filter((item): item is IntegrationActivityItem => item !== null);

  const connectedIds = new Set(
    connectors
      .filter((connector) =>
        hasConnectorActivity(connector, activityById.get(connector.id)),
      )
      .map((connector) => connector.id),
  );
  const recommendationById = new Map<
    string,
    IntegrationSuggestionRecommendation
  >();
  for (const recommendation of [...input.recommendations].sort((left, right) => {
    const leftPriority = recommendationPriority[left.priority ?? "recommended"];
    const rightPriority = recommendationPriority[right.priority ?? "recommended"];
    return leftPriority - rightPriority;
  })) {
    if (
      connectorById.has(recommendation.integrationId) &&
      !connectedIds.has(recommendation.integrationId) &&
      !recommendationById.has(recommendation.integrationId)
    ) {
      recommendationById.set(recommendation.integrationId, recommendation);
    }
  }

  const suggestedConnectors = [
    ...recommendationById.keys(),
    ...connectors
      .filter(
        (connector) =>
          !connectedIds.has(connector.id) &&
          !recommendationById.has(connector.id),
      )
      .map((connector) => connector.id),
  ]
    .slice(0, 3)
    .map((integrationId) => connectorById.get(integrationId))
    .filter(
      (connector): connector is IntegrationSuggestionConnector =>
        connector !== undefined,
    );

  const suggestedItems = suggestedConnectors.map((connector) => {
    const recommendation = recommendationById.get(connector.id);
    return baseItem({
      orgId: input.orgId,
      connector,
      section: "Suggested",
      suffix: "suggested",
      title: `Connect ${connector.name}`,
      description: recommendation?.reason || connector.summary,
      primaryAction: action("connect", "Connect"),
      secondaryAction: action("review_details", "Review details"),
    });
  });

  return [...suggestedItems, ...connectedItems].sort((left, right) => {
    return sectionOrder[left.section] - sectionOrder[right.section];
  });
}
