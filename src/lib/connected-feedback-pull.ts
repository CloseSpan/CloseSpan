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
import { retellStatus, loadRetellConnection, ingestRetellCalls } from "./retell-repository";
import { listRetellCalls } from "./retell-api";
import { analyzeRetellFeedback } from "./retell-intake";

export type ConnectedFeedbackPullStatus =
  | "succeeded"
  | "failed"
  | "unsupported";

export const CONNECTED_FEEDBACK_SOURCE_IDS = [
  ...PIPEDREAM_CONNECTOR_IDS,
  "int_discord",
  "int_retell",
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
  const [connections, retell] = await Promise.all([
    listPipedreamConnections(orgId),
    retellStatus(orgId),
  ]);
  const connected = connectedFeedbackConnections(connections);
  const counts = new Map<PipedreamConnectorId, number>();
  for (const connection of connected) {
    counts.set(
      connection.integrationId,
      (counts.get(connection.integrationId) ?? 0) + 1,
    );
  }
  const sources: ConnectedFeedbackSourceOption[] = [...counts.entries()].map(([integrationId, accountCount]) => ({
    integrationId,
    provider: providerName(integrationId),
    accountCount,
    manualPullAvailable:
      integrationId === "int_slack"
      || supportsManualFeedbackImport(integrationId),
  }));
  if (retell.connected) sources.push({
    integrationId: "int_retell",
    provider: providerName("int_retell"),
    accountCount: 1,
    manualPullAvailable: true,
  });
  return sources;
}

function emptyResult(
  connection: Pick<ConnectedFeedbackPullResult, "integrationId" | "accountId" | "accountName">,
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

async function pullRetell(orgId: string): Promise<ConnectedFeedbackPullResult> {
  const source = { integrationId: "int_retell", accountId: "int_retell", accountName: "Retell AI" };
  try {
    const connection = await loadRetellConnection({ orgId });
    if (!connection) return emptyResult(source, "failed", "Retell is no longer connected. Refresh and reconnect the source.");
    const calls = await listRetellCalls(connection.apiKey);
    const counts = await ingestRetellCalls(connection, calls);
    const intelligence = await analyzeRetellFeedback(orgId);
    return {
      ...emptyResult(source, "succeeded"),
      fetched: counts.checked,
      created: counts.imported,
      // Existing calls are deduplicated, never overwritten.
      ...intelligence,
    };
  } catch {
    return emptyResult(source, "failed", "Retell could not be pulled. Retry shortly or check the connection in Integrations.");
  }
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
  const selected = integrationIds?.length ? new Set(integrationIds) : null;
  const selectedAccounts = accountIds?.length ? new Set(accountIds) : null;
  const includeRetell = (!selected || selected.has("int_retell"))
    && (!selectedAccounts || selectedAccounts.has("int_retell"));
  const retellConnected = includeRetell && (await retellStatus(context.orgId)).connected;
  const orchestratedIds = integrationIds?.filter((id) => id !== "int_retell");
  const orchestratedAccounts = accountIds?.filter((id) => id !== "int_retell");
  const includeOrchestrated = (!selected || Boolean(orchestratedIds?.length))
    && (!selectedAccounts || Boolean(orchestratedAccounts?.length));

  if (orchestration.activeProvider === "n8n" && includeOrchestrated) {
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
      // Native Retell credentials and intake stay in CloseSpan, not n8n.
      integrationIds: orchestratedIds ?? CONNECTED_FEEDBACK_SOURCE_IDS.filter((id) => id !== "int_retell"),
      accountIds: orchestratedAccounts,
    });
    const results = retellConnected ? [await pullRetell(context.orgId)] : [];
    return {
      results,
      connectedSources: (orchestratedIds?.length ?? 0) + results.length,
      succeeded: results.filter((result) => result.status === "succeeded").length,
      failed: results.filter((result) => result.status === "failed").length,
      unsupported: 0,
      orchestrationProvider: "n8n",
      routed: true,
      message: [...results.map((result) => result.status === "succeeded"
        ? `Retell AI: ${result.created} new, ${result.updated} updated.`
        : result.message), triggered.message].filter(Boolean).join(" "),
      executionId: triggered.executionId,
      runUrl: triggered.runUrl,
    };
  }

  const connected = connectedFeedbackConnections(
    includeOrchestrated ? await listPipedreamConnections(context.orgId) : [],
  ).filter(
    (connection) =>
      (!selected || selected.has(connection.integrationId))
      && (!selectedAccounts || selectedAccounts.has(connection.accountId)),
  );

  const tasks: Array<Promise<ConnectedFeedbackPullResult>> = [];
  const represented = new Set<string>();
  if (retellConnected) {
    represented.add("int_retell");
    tasks.push(pullRetell(context.orgId));
  }
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
  // Retell intake classifies evidence only; it must not start engineering work.
  if (results.some((result) => result.integrationId !== "int_retell" && result.status === "succeeded" && result.clustered > 0)) {
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
    orchestrationProvider: orchestration.activeProvider,
    routed: false,
  };
}
