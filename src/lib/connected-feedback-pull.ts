import {
  integrationCatalog,
  isFeedbackSourceIntegration,
} from "./integration-catalog";
import {
  pullPipedreamFeedback,
  supportsManualFeedbackImport,
} from "./pipedream-feedback-import";
import {
  listPipedreamConnections,
  type PipedreamConnection,
} from "./pipedream-repository";
import {
  PIPEDREAM_CONNECTOR_IDS,
  type PipedreamConnectorId,
} from "./pipedream-connectors";
import {
  analyzeAndClusterSlackSignals,
  deliverSlackNotifications,
  ensureSlackIntakeChannel,
  reconcileSlackNotifications,
  syncSlackIntake,
} from "./slack-intake";
import { runProblemAutomationTick } from "./problem-automation-repository";
import {
  N8nConfigurationError,
  triggerN8nFeedbackPull,
} from "./n8n-client";
import { getOrchestrationProviderRuntimeConfiguration } from "./orchestration-provider-repository";

export type ConnectedFeedbackPullStatus =
  | "succeeded"
  | "failed"
  | "unsupported";

export const CONNECTED_FEEDBACK_SOURCE_IDS = [
  ...PIPEDREAM_CONNECTOR_IDS,
  "int_discord",
] as const;

export type ConnectedFeedbackSourceId =
  (typeof CONNECTED_FEEDBACK_SOURCE_IDS)[number];

export interface ConnectedFeedbackPullResult {
  integrationId: string;
  provider: string;
  accountId: string;
  accountName: string | null;
  status: ConnectedFeedbackPullStatus;
  fetched: number;
  created: number;
  updated: number;
  analyzed: number;
  clustered: number;
  message?: string;
}

export interface ConnectedFeedbackPullSummary {
  results: ConnectedFeedbackPullResult[];
  connectedSources: number;
  succeeded: number;
  failed: number;
  unsupported: number;
  orchestrationProvider: "pipedream" | "n8n";
  routed: boolean;
  message?: string;
  executionId?: string | null;
  runUrl?: string | null;
}

export interface ConnectedFeedbackSourceOption {
  integrationId: ConnectedFeedbackSourceId;
  provider: string;
  accountCount: number;
  manualPullAvailable: boolean;
}

export interface ConnectedFeedbackPullContext {
  orgId: string;
  actorId: string;
  actorName: string;
  traceId: string;
}

function providerName(integrationId: string): string {
  return integrationCatalog.find((entry) => entry.id === integrationId)?.provider
    ?? "Connected source";
}

function connectedFeedbackConnections(
  connections: PipedreamConnection[],
): PipedreamConnection[] {
  return connections.filter(
    (connection) =>
      connection.state === "Connected"
      && isFeedbackSourceIntegration(connection.integrationId),
  );
}

export async function listConnectedFeedbackSources(
  orgId: string,
): Promise<ConnectedFeedbackSourceOption[]> {
  const connected = connectedFeedbackConnections(
    await listPipedreamConnections(orgId),
  );
  const counts = new Map<PipedreamConnectorId, number>();
  for (const connection of connected) {
    counts.set(
      connection.integrationId,
      (counts.get(connection.integrationId) ?? 0) + 1,
    );
  }
  return [...counts.entries()].map(([integrationId, accountCount]) => ({
    integrationId,
    provider: providerName(integrationId),
    accountCount,
    manualPullAvailable:
      integrationId === "int_slack"
      || supportsManualFeedbackImport(integrationId),
  }));
}

function emptyResult(
  connection: PipedreamConnection,
  status: ConnectedFeedbackPullStatus,
  message?: string,
): ConnectedFeedbackPullResult {
  return {
    integrationId: connection.integrationId,
    provider: providerName(connection.integrationId),
    accountId: connection.accountId,
    accountName: connection.accountName,
    status,
    fetched: 0,
    created: 0,
    updated: 0,
    analyzed: 0,
    clustered: 0,
    ...(message ? { message } : {}),
  };
}

async function pullSlack(
  context: ConnectedFeedbackPullContext,
  connection: PipedreamConnection,
): Promise<ConnectedFeedbackPullResult> {
  try {
    await ensureSlackIntakeChannel({
      orgId: context.orgId,
      accountId: connection.accountId,
      actorId: context.actorId,
      actorName: context.actorName,
      traceId: `${context.traceId}:slack-intake`,
    });
    const sync = await syncSlackIntake(context.orgId);
    const intelligence = await analyzeAndClusterSlackSignals(context.orgId);
    await reconcileSlackNotifications(context.orgId);
    await deliverSlackNotifications(context.orgId);
    return {
      ...emptyResult(connection, "succeeded"),
      ...sync,
      ...intelligence,
    };
  } catch {
    return emptyResult(
      connection,
      "failed",
      "Slack could not be pulled. Retry shortly or reconnect the account.",
    );
  }
}

async function pullSupportedAccount(
  context: ConnectedFeedbackPullContext,
  connection: PipedreamConnection,
): Promise<ConnectedFeedbackPullResult> {
  try {
    const result = await pullPipedreamFeedback({
      orgId: context.orgId,
      integrationId: connection.integrationId,
      accountId: connection.accountId,
    });
    return {
      ...emptyResult(connection, "succeeded"),
      accountName: result.accountName,
      fetched: result.fetched,
      created: result.created,
      updated: result.updated,
    };
  } catch {
    return emptyResult(
      connection,
      "failed",
      `${providerName(connection.integrationId)} could not be pulled. Retry shortly or reconnect the account.`,
    );
  }
}

export async function pullConnectedFeedbackSources(
  context: ConnectedFeedbackPullContext,
  integrationIds?: readonly ConnectedFeedbackSourceId[],
  accountIds?: readonly string[],
): Promise<ConnectedFeedbackPullSummary> {
  const orchestration = await getOrchestrationProviderRuntimeConfiguration(
    context.orgId,
  );
  if (orchestration.activeProvider === "n8n") {
    if (
      !orchestration.n8n.configured
      || !orchestration.n8nApiKey
      || !orchestration.n8nSigningSecret
    ) {
      throw new N8nConfigurationError(
        "n8n is active but its verified credentials are unavailable. Reconnect n8n in Settings → Workflow orchestration or switch back to Pipedream.",
      );
    }
    const triggered = await triggerN8nFeedbackPull({
      baseUrl: orchestration.n8n.baseUrl,
      triggerUrl: orchestration.n8n.triggerUrl,
      signingSecret: orchestration.n8nSigningSecret,
      orgId: context.orgId,
      actorId: context.actorId,
      actorName: context.actorName,
      traceId: context.traceId,
      integrationIds,
      accountIds,
    });
    return {
      results: [],
      connectedSources: integrationIds?.length ?? 0,
      succeeded: 0,
      failed: 0,
      unsupported: 0,
      orchestrationProvider: "n8n",
      routed: true,
      message: triggered.message,
      executionId: triggered.executionId,
      runUrl: triggered.runUrl,
    };
  }

  const selected = integrationIds?.length ? new Set(integrationIds) : null;
  const selectedAccounts = accountIds?.length ? new Set(accountIds) : null;
  const connected = connectedFeedbackConnections(
    await listPipedreamConnections(context.orgId),
  ).filter(
    (connection) =>
      (!selected || selected.has(connection.integrationId))
      && (!selectedAccounts || selectedAccounts.has(connection.accountId)),
  );

  const tasks: Array<Promise<ConnectedFeedbackPullResult>> = [];
  const represented = new Set<string>();
  for (const connection of connected) {
    if (connection.integrationId === "int_slack") {
      if (represented.has(connection.integrationId)) continue;
      represented.add(connection.integrationId);
      tasks.push(pullSlack(context, connection));
      continue;
    }
    if (supportsManualFeedbackImport(connection.integrationId)) {
      represented.add(connection.integrationId);
      tasks.push(pullSupportedAccount(context, connection));
      continue;
    }
    if (represented.has(connection.integrationId)) continue;
    represented.add(connection.integrationId);
    tasks.push(Promise.resolve(emptyResult(
      connection,
      "unsupported",
      `${providerName(connection.integrationId)} is connected, but manual pull is not available yet.`,
    )));
  }

  const results = await Promise.all(tasks);
  if (results.some((result) => result.status === "succeeded" && result.clustered > 0)) {
    // Manual pull is the recovery path when the scheduled coordinator is
    // unavailable. Complete the same investigation -> prompt handoff now so
    // a newly clustered problem does not remain permanently "Not ready".
    await runProblemAutomationTick(context.orgId);
  }
  return {
    results,
    connectedSources: represented.size,
    succeeded: results.filter((result) => result.status === "succeeded").length,
    failed: results.filter((result) => result.status === "failed").length,
    unsupported: results.filter((result) => result.status === "unsupported").length,
    orchestrationProvider: "pipedream",
    routed: false,
  };
}
