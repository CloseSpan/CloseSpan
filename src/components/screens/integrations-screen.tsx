"use client";

import { Button, ButtonLink, StatusBadge } from "@/components/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useRouter } from "next/navigation";
import { AlertTriangle, Activity, Check, Clock3, Copy, Database, GitBranch, LoaderCircle, ShieldCheck, Sparkles, X } from "lucide-react";
import { FitText } from "../fit-text";
import { IntegrationSyncStatus } from "../integration-sync-status";
import { PipedreamAccountManager } from "../pipedream-account-manager";
import { DiscordConnectionManager } from "../discord-connection-manager";
import { RetellConnectionManager } from "../retell-connection-manager";
import { DisconnectIntegrationButton } from "../disconnect-integration-button";
import { IntegrationProviderIcon } from "../integration-provider-icon";
import { IntegrationCopilot } from "../integration-copilot";
import { IntegrationSuggestionsView } from "../integration-suggestions-view";
import { isPipedreamConnectorId } from "@/lib/pipedream-connectors";
import { startGithubInstallationPopup } from "@/lib/github-installation-client";
import { isFeedbackSourceIntegration, isIntegrationAvailable } from "@/lib/integration-catalog";
import { getIntegrationExperience, getIntegrationGroup, isSimulatedConnectedState, type IntegrationFilter, type IntegrationGroup } from "@/lib/integration-ui";
import type { IntegrationConnectionState } from "@/lib/integration-client";
import type { GithubRepositoryAuthorization } from "@/lib/github-repository-allowlist";
import type { PipedreamConnectState } from "../pipedream-connect-button";
import type { RecommendedConnector } from "@/lib/onboarding-repository";
import { buildIntegrationSuggestions, type IntegrationActivityItem, type IntegrationInspectionMode, type IntegrationSuggestionPipedreamActivity } from "@/lib/integration-suggestions";
import type { IntegrationView } from "@/lib/workspace-repository";
import { EmptyWorkspaceState, PageTitle, containModalFocus, getModalFocusableElements } from "./shared";

function IntegrationProgressDrawer({
  activity,
  connected,
  githubBusy,
  integrationId,
  onConnectGithub,
  onViewDetails,
}: {
  activity: IntegrationActivityItem | null;
  connected: boolean;
  githubBusy: boolean;
  integrationId: string;
  onConnectGithub: () => void;
  onViewDetails: () => void;
}) {
  const github = integrationId === "int_github";
  const title = activity?.title ?? (github ? "Connecting GitHub" : "Connection in progress");
  const description = activity?.description ??
    "CloseSpan is checking the connection. You can keep working while it finishes.";

  return (
    <div className="integration-progress-view">
      <section className="integration-progress-current" aria-live="polite">
        <span className="integration-progress-current-icon" aria-hidden="true">
          <LoaderCircle className="spin" size={18} />
        </span>
        <div>
          <span>In progress</span>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </section>

      {github && (
        <ol className="integration-progress-steps" aria-label="GitHub connection progress">
          <li className={connected ? "complete" : "current"}>
            <span aria-hidden="true">{connected ? <Check size={15} /> : "1"}</span>
            <div>
              <strong>Select repository access</strong>
              <p>
                {connected
                  ? "GitHub returned the repositories approved for this workspace."
                  : "Choose the repositories CloseSpan may inspect, test, and use for approved pull requests."}
              </p>
            </div>
          </li>
          <li className={connected ? "current" : "upcoming"}>
            <span aria-hidden="true">2</span>
            <div>
              <strong>Build repository context</strong>
            </div>
          </li>
          <li className="upcoming">
            <span aria-hidden="true">3</span>
            <div>
              <strong>Prepare runtime verification</strong>
            </div>
          </li>
        </ol>
      )}

      <div className="integration-progress-actions">
        {github && (
          <Button
            variant="primary"
            type="button"
            disabled={githubBusy}
            onClick={onConnectGithub}
          >
            {githubBusy
              ? "Opening GitHub…"
              : connected
                ? "Manage repositories"
                : "Finish repository selection"}
          </Button>
        )}
        <Button type="button" onClick={onViewDetails}>
          View connection details
        </Button>
      </div>
    </div>
  );
}

export function IntegrationsScreen({
  integrations,
  githubRepositories,
  orgId,
  focusedIntegrationId = null,
  productName,
  recommendedConnectors,
  initialIntegrationActivity,
  initialView,
  discordCallbackStatus = null,
  discordCallbackReason = null,
  mode = "catalog",
  githubInstalled = false,
  canManageConnections = false,
}: {
  mode?: "catalog" | "settings";
  githubInstalled?: boolean;
  canManageConnections?: boolean;
  integrations: IntegrationView[];
  githubRepositories: GithubRepositoryAuthorization[];
  orgId: string;
  focusedIntegrationId?: string | null;
  productName: string | null;
  recommendedConnectors: RecommendedConnector[];
  initialIntegrationActivity: Array<{
    integrationId: string;
    accountName: string | null;
    state: "Connected" | "Needs reconnect" | "Disconnected";
    healthy: boolean | null;
    lastImportAt: string | null;
    lastImportStatus: "Running" | "Succeeded" | "Failed" | null;
    lastImportCount: number;
  }>;
  initialView: "suggestions" | "connections";
  discordCallbackStatus?: string | null;
  discordCallbackReason?: string | null;
}) {
  const router = useRouter();
  const settingsConnections = mode === "settings";
  const reduceMotion = useReducedMotion();
  const focusedCardRef = useRef<HTMLElement | null>(null);
  const suggestionsTabRef = useRef<HTMLButtonElement | null>(null);
  const connectionsTabRef = useRef<HTMLButtonElement | null>(null);
  const integrationDrawerRef = useRef<HTMLElement | null>(null);
  const integrationDrawerCloseRef = useRef<HTMLButtonElement | null>(null);
  const integrationDrawerTriggerRef = useRef<HTMLElement | null>(null);
  const connectionsSectionRef = useRef<HTMLElement | null>(null);
  const [connectedIds, setConnectedIds] = useState(() =>
    integrations
      .filter(
        (integration) =>
          integration.state === "Connected" ||
          isSimulatedConnectedState(integration.state),
      )
      .map((integration) => integration.id),
  );
  const [connectionStates, setConnectionStates] = useState<
    Partial<Record<string, IntegrationConnectionState>>
  >(() =>
    Object.fromEntries(
      integrations
        .filter(
          (integration) =>
            isPipedreamConnectorId(integration.id) &&
            ["Connected", "Needs reconnect", "Disconnected"].includes(
              integration.state,
            ),
        )
        .map((integration) => [
          integration.id,
          integration.state as Exclude<IntegrationConnectionState, null>,
        ]),
    ),
  );
  const [activeView, setActiveView] = useState(initialView);
  const [connectionProgress, setConnectionProgress] = useState<
    Partial<Record<string, PipedreamConnectState>>
  >({});
  const [integrationActivity, setIntegrationActivity] = useState(
    initialIntegrationActivity,
  );
  const [lastSyncOverrides, setLastSyncOverrides] = useState<
    Partial<Record<string, string>>
  >({});
  const [webhookBusy, setWebhookBusy] = useState(false);
  const [webhookError, setWebhookError] = useState<string | null>(null);
  const [githubBusy, setGithubBusy] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const githubConnectionRef = useRef<AbortController | null>(null);
  const githubConnectionMounted = useRef(true);
  const [webhookCredentials, setWebhookCredentials] = useState<{
    webhookUrl: string;
    signingSecret: string;
  } | null>(null);
  const [webhookCopied, setWebhookCopied] = useState<"url" | "secret" | null>(
    null,
  );
  const [activeFilter, setActiveFilter] = useState<IntegrationFilter>("All");
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [selectedIntegrationId, setSelectedIntegrationId] = useState<
    string | null
  >(focusedIntegrationId);
  const [integrationDrawerMode, setIntegrationDrawerMode] =
    useState<IntegrationInspectionMode>("details");
  const connectedGithubRepositories = useMemo(
    () =>
      githubRepositories.filter(
        (repository) => repository.active && repository.workspaceSelected,
      ),
    [githubRepositories],
  );

  useEffect(() => {
    githubConnectionMounted.current = true;
    return () => {
      githubConnectionMounted.current = false;
      githubConnectionRef.current?.abort();
    };
  }, [orgId]);

  const connectorRows = integrations.map((item) => {
    const progress = connectionProgress[item.id];
    const itemWithLiveState = {
      ...item,
      state:
        progress === "opening" || progress === "waiting"
          ? "Pending setup"
          : progress === "error"
            ? "Connection failed"
            : progress === "connected"
              ? "Connected"
              : item.state,
      lastSync: lastSyncOverrides[item.id] ?? item.lastSync,
    };
    const observedConnectionState = connectionStates[item.id];
    const demonstration = isSimulatedConnectedState(itemWithLiveState.state);
    const connectedFromIntegration =
      observedConnectionState === undefined
        ? connectedIds.includes(item.id)
        : observedConnectionState === "Connected";
    const connected =
      item.id === "int_github" && !demonstration
        ? observedConnectionState === "Disconnected" ? false : connectedGithubRepositories.length > 0 || (settingsConnections && githubInstalled)
        : connectedFromIntegration;
    const available = isIntegrationAvailable(item.id);
    return {
      item: itemWithLiveState,
      observedConnectionState,
      demonstration,
      connected,
      available,
      experience: getIntegrationExperience({
        id: item.id,
        provider: item.name,
        category: item.category,
      }),
      group: getIntegrationGroup({ connected, available }),
    };
  });
  const connectedConnectionCount = connectorRows.filter(
    (row) => row.connected,
  ).length;
  // An expired authorization still belongs here so its owner can disconnect it.
  const managedConnections = connectorRows.filter((row) =>
    row.connected || (row.observedConnectionState ?? row.item.state) === "Needs reconnect",
  );
  const filterRows = settingsConnections ? managedConnections : connectorRows;
  const visibleRows = filterRows.filter(
    (row) => activeFilter === "All" || row.experience.filter === activeFilter,
  );
  const selectedRow = connectorRows.find(
    (row) => row.item.id === selectedIntegrationId,
  );
  const integrationDrawerOpen = Boolean(selectedRow);
  const connectedFeedbackSources = connectorRows.filter(
    (row) => row.connected && isFeedbackSourceIntegration(row.item.id),
  );
  const connectedActionDestinations = connectorRows.filter(
    (row) =>
      row.connected &&
      row.available &&
      !isFeedbackSourceIntegration(row.item.id),
  );
  const reconnectCount = connectorRows.filter(
    (row) => (row.observedConnectionState ?? row.item.state) === "Needs reconnect",
  ).length;
  const latestImport = filterRows
    .filter((row) => !settingsConnections || isFeedbackSourceIntegration(row.item.id))
    .map((row) => row.item.lastSync)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
  const connectionOverview = (
    <>
      <section className="integration-summary" aria-label="Integration health summary">
        <div className="integration-summary-card">
          <span><Database size={17} aria-hidden="true" /></span>
          <div><strong>{connectedFeedbackSources.length}</strong><small>Feedback sources</small></div>
        </div>
        <div className="integration-summary-card">
          <span><GitBranch size={17} aria-hidden="true" /></span>
          <div><strong>{connectedActionDestinations.length}</strong><small>Action destinations</small></div>
        </div>
        <div className="integration-summary-card">
          <span><Activity size={17} aria-hidden="true" /></span>
          <div>
            <strong>{reconnectCount > 0 ? `${reconnectCount} needs attention` : connectedConnectionCount === 0 ? "No connections" : managedConnections.every((row) => row.demonstration) ? "Simulated" : "Healthy"}</strong>
            <small>Synchronization health</small>
          </div>
        </div>
        <div className="integration-summary-card">
          <span><Clock3 size={17} aria-hidden="true" /></span>
          <div>
            <strong>{latestImport ? new Date(latestImport).toLocaleString() : "No imports yet"}</strong>
            <small>Last successful import</small>
          </div>
        </div>
      </section>
      <div className="integration-filterbar" role="group" aria-label={settingsConnections ? "Filter connections" : "Filter integrations"}>
        {(["All", "Feedback", "Engineering", "Analytics", "Support"] as const).map((filter) => {
          const count = filterRows.filter((row) => filter === "All" || row.experience.filter === filter).length;
          return (
            <button
              key={filter}
              type="button"
              className={activeFilter === filter ? "active" : ""}
              aria-label={`${filter} ${settingsConnections ? "connections" : "integrations"}, ${count}`}
              aria-pressed={activeFilter === filter}
              onClick={() => setActiveFilter(filter)}
            >
              {filter}<span aria-hidden="true">{count}</span>
            </button>
          );
        })}
      </div>
    </>
  );
  const pipedreamActivity: IntegrationSuggestionPipedreamActivity[] =
    integrationActivity.map((activity) => ({
      integrationId: activity.integrationId,
      connectionState: activity.state,
      lastImportStatus: activity.lastImportStatus,
      lastImportAt: activity.lastImportAt,
      lastImportCount: activity.lastImportCount,
    }));
  const suggestionItems = buildIntegrationSuggestions({
    orgId,
    connectors: connectorRows.map((row) => ({
      id: row.item.id,
      name: row.item.name,
      available: row.available,
      connected: row.connected,
      feedbackSource: isFeedbackSourceIntegration(row.item.id),
      state: row.item.state,
      lastSync: row.item.lastSync,
      filter: row.experience.filter,
      summary: row.experience.summary,
    })),
    recommendations: recommendedConnectors,
    pipedreamActivity,
  });
  const selectedProgressActivity = suggestionItems.find(
    (item) =>
      item.integrationId === selectedIntegrationId && item.section === "Working",
  ) ?? null;
  const attentionSuggestionCount = suggestionItems.filter(
    (item) => item.section === "Suggested" || item.section === "Review",
  ).length;

  function updateConnectionState(
    integrationId: string,
    nextState: IntegrationConnectionState,
  ): void {
    if (settingsConnections && nextState === "Disconnected") {
      setSelectedIntegrationId(null);
      const name = integrations.find((item) => item.id === integrationId)?.name ?? "Connection";
      setConnectionNotice(`${name} is disconnected. Previously imported feedback is kept.`);
    }
    setConnectionStates((previous) => ({
      ...previous,
      [integrationId]: nextState,
    }));
    setConnectedIds((previous) =>
      nextState === "Connected"
        ? previous.includes(integrationId)
          ? previous
          : [...previous, integrationId]
        : previous.filter((id) => id !== integrationId),
    );
    setIntegrationActivity((previous) => {
      if (!nextState) return previous;
      if (previous.some((activity) => activity.integrationId === integrationId)) {
        return previous.map((activity) =>
          activity.integrationId === integrationId
            ? { ...activity, state: nextState }
            : activity,
        );
      }
      return [
        ...previous,
        {
          integrationId,
          accountName: null,
          state: nextState,
          healthy: nextState === "Connected" ? true : null,
          lastImportAt: null,
          lastImportStatus: null,
          lastImportCount: 0,
        },
      ];
    });
  }

  function selectIntegrationView(nextView: "suggestions" | "connections") {
    setActiveView(nextView);
    const url = new URL(window.location.href);
    url.searchParams.set("view", nextView);
    if (nextView === "suggestions") url.searchParams.delete("focus");
    window.history.replaceState(window.history.state, "", url);
  }

  function handleViewTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
      return;
    event.preventDefault();
    const views = ["suggestions", "connections"] as const;
    const currentIndex = views.indexOf(activeView);
    const nextView =
      event.key === "Home"
        ? views[0]
        : event.key === "End"
          ? views[views.length - 1]
          : views[
              (currentIndex +
                (event.key === "ArrowRight" ? 1 : -1) +
                views.length) %
                views.length
            ];
    selectIntegrationView(nextView);
    window.requestAnimationFrame(() =>
      (nextView === "suggestions"
        ? suggestionsTabRef.current
        : connectionsTabRef.current
      )?.focus(),
    );
  }

  function openIntegrationDetails(
    integrationId: string,
    mode: IntegrationInspectionMode = "details",
  ) {
    if (!selectedIntegrationId) {
      integrationDrawerTriggerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    setIntegrationDrawerMode(mode);
    setSelectedIntegrationId(integrationId);
    if (integrationId === "int_github") setGithubError(null);
  }

  async function connectGithub() {
    if (githubBusy || githubConnectionRef.current) return;
    const controller = new AbortController();
    githubConnectionRef.current = controller;
    setGithubBusy(true);
    setGithubError(null);
    try {
      await startGithubInstallationPopup(orgId, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setSelectedIntegrationId(null);
      router.push("/integrations?view=connections&focus=int_github&select=repositories");
      router.refresh();
    } catch (caught) {
      if (!controller.signal.aborted) {
        setGithubError(
          caught instanceof Error
            ? caught.message
            : "GitHub connection could not be started",
        );
      }
    } finally {
      if (githubConnectionRef.current === controller) {
        githubConnectionRef.current = null;
        if (githubConnectionMounted.current) setGithubBusy(false);
      }
    }
  }

  async function createWebhook() {
    if (webhookBusy) return;
    setWebhookBusy(true);
    setWebhookError(null);
    try {
      const response = await fetch("/api/integrations/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-org-id": orgId,
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
      });
      const payload = (await response.json().catch(() => ({}))) as {
        webhookUrl?: unknown;
        signingSecret?: unknown;
      };
      if (
        !response.ok ||
        typeof payload.webhookUrl !== "string" ||
        typeof payload.signingSecret !== "string"
      ) {
        throw new Error("webhook_unavailable");
      }
      setWebhookCredentials({
        webhookUrl: payload.webhookUrl,
        signingSecret: payload.signingSecret,
      });
      updateConnectionState("int_webhook", "Connected");
    } catch {
      setWebhookError(
        "The webhook could not be created right now. Try again or connect another source.",
      );
    } finally {
      setWebhookBusy(false);
    }
  }

  async function copyWebhookValue(
    label: "url" | "secret",
    value: string,
  ) {
    await navigator.clipboard.writeText(value);
    setWebhookCopied(label);
    window.setTimeout(() => setWebhookCopied(null), 1500);
  }

  useEffect(() => {
    const card = focusedCardRef.current;
    if (!focusedIntegrationId || !card) return;

    const frame = window.requestAnimationFrame(() => {
      card.focus({ preventScroll: true });
      card.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "center",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedIntegrationId]);

  useEffect(() => {
    if (!integrationDrawerOpen) return;
    const drawer = integrationDrawerRef.current;
    if (!drawer) return;
    const previouslyFocused = integrationDrawerTriggerRef.current;
    const connectionsSection = connectionsSectionRef.current;
    const focusFrame = window.requestAnimationFrame(() => {
      (
        integrationDrawerCloseRef.current ??
        getModalFocusableElements(drawer)[0] ??
        drawer
      ).focus({ preventScroll: true });
    });
    const handleDrawerKeyDown = (event: KeyboardEvent) => {
      containModalFocus(event, drawer, () =>
        setSelectedIntegrationId(null),
      );
    };
    document.addEventListener("keydown", handleDrawerKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleDrawerKeyDown);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => {
        const target = previouslyFocused?.isConnected ? previouslyFocused : connectionsSection;
        target?.focus({ preventScroll: true });
      });
    };
  }, [integrationDrawerOpen]);

  return (
    <>
      <PageTitle
        title={settingsConnections ? "Connections" : "Integrations"}
        action={
          settingsConnections ? <ButtonLink href="/integrations">Browse integrations</ButtonLink> :
          <div
            className="integration-view-tabs"
            role="tablist"
            aria-label="Integration views"
          >
            <button
              id="integration-suggestions-tab"
              ref={suggestionsTabRef}
              type="button"
              role="tab"
              aria-selected={activeView === "suggestions"}
              aria-controls="integration-suggestions-panel"
              tabIndex={activeView === "suggestions" ? 0 : -1}
              className={activeView === "suggestions" ? "active" : ""}
              onClick={() => selectIntegrationView("suggestions")}
              onKeyDown={handleViewTabKeyDown}
            >
              <Sparkles size={15} aria-hidden="true" />
              Suggestions
              <span>{attentionSuggestionCount}</span>
            </button>
            <button
              id="integration-connections-tab"
              ref={connectionsTabRef}
              type="button"
              role="tab"
              aria-selected={activeView === "connections"}
              aria-controls="integration-connections-panel"
              tabIndex={activeView === "connections" ? 0 : -1}
              className={activeView === "connections" ? "active" : ""}
              onClick={() => selectIntegrationView("connections")}
              onKeyDown={handleViewTabKeyDown}
            >
              <Database size={15} aria-hidden="true" />
              Connections
              <span>{connectedConnectionCount}</span>
            </button>
          </div>
        }
      />
      {settingsConnections ? (
        <section ref={connectionsSectionRef} className="settings-connections" aria-label="Workspace connections" tabIndex={-1}>
          <p className="subtle">Connected tools in this workspace. View details to review access or disconnect.</p>
          {connectionNotice && <p className="toast success" role="status">{connectionNotice}</p>}
          {connectionOverview}
          {managedConnections.length === 0 ? (
            <div className="card settings-connections-empty">
              <h2>No connected tools</h2>
              <p>Tools you connect to this workspace will appear here.</p>
              <ButtonLink href="/integrations" prefetch={false}>Browse integrations</ButtonLink>
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="card settings-connections-empty" role="status">
              <h2>No {activeFilter.toLowerCase()} connections</h2>
              <p>Your connected tools in this category will appear here.</p>
              <Button type="button" onClick={() => setActiveFilter("All")}>Show all connections</Button>
            </div>
          ) : (
            <div className="integration-group">
              <div className="integration-group-heading"><div><h2>Connected</h2><p>Active tools in this workspace.</p></div><span>{visibleRows.length}</span></div>
              <div className="integrations-grid">
                {visibleRows.map(({ item, connected, experience, demonstration }) => (
                  <article className="card integration" key={item.id} aria-labelledby={`connection-name-${item.id}`}>
                    <div className="split">
                      <IntegrationProviderIcon integrationId={item.id} className="provider-icon" />
                      <span className={`badge ${demonstration ? "" : connected ? "success" : "warning"}`}>{demonstration ? "Demo connection" : connected ? "Connected" : "Needs reconnect"}</span>
                    </div>
                    <FitText as="h3" id={`connection-name-${item.id}`} minFontSize={13} maxLines={2}>{item.name}</FitText>
                    <p className="integration-card-summary">{experience.summary}</p>
                    <div className="integration-card-footer">
                      <span>{demonstration
                        ? "Simulated workspace connection"
                        : !connected
                          ? "Reconnect required"
                          : item.lastSync
                            ? `Synced ${new Date(item.lastSync).toLocaleDateString()}`
                            : "Connected to this workspace"}</span>
                      <Button type="button" aria-label={`View ${item.name} connection details`} onClick={() => openIntegrationDetails(item.id)}>View details</Button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>
      ) : integrations.length === 0 ? (
        <EmptyWorkspaceState
          title="No integrations are configured"
          description="No connector has completed authorization and a health check. Review governance settings before enabling an approved ingestion path."
          actionHref="/settings"
          actionLabel="Review data policy"
        />
      ) : (
        <div className="integration-experience">
          <section
            id="integration-suggestions-panel"
            className="integration-suggestions-panel"
            role="tabpanel"
            aria-labelledby="integration-suggestions-tab"
            tabIndex={0}
            hidden={activeView !== "suggestions"}
          >
            <div className="integration-suggestions-agent">
              <IntegrationCopilot
                orgId={orgId}
                connectors={connectorRows.map((row) => ({
                  id: row.item.id,
                  name: row.item.name,
                  connected: row.connected,
                  available: row.available,
                  summary: row.experience.summary,
                  importedData: row.experience.importedData,
                  requestedPermissions: row.experience.requestedPermissions,
                }))}
                onInspect={openIntegrationDetails}
                onConnected={(integrationId) =>
                  updateConnectionState(integrationId, "Connected")
                }
                onConnectionProgressChange={(integrationId, state) =>
                  setConnectionProgress((previous) => ({
                    ...previous,
                    [integrationId]: state,
                  }))
                }
              />
            </div>
            <IntegrationSuggestionsView
              items={suggestionItems}
              productName={productName}
              onInspect={openIntegrationDetails}
            />
          </section>

          <section
            id="integration-connections-panel"
            className="integration-catalog-shell"
            role="tabpanel"
            aria-labelledby="integration-connections-tab"
            tabIndex={0}
            hidden={activeView !== "connections"}
          >
          {connectionOverview}

          {(["Connected", "Recommended", "Coming soon"] as IntegrationGroup[]).map((group) => {
            const rows = visibleRows.filter((row) => row.group === group);
            if (rows.length === 0) return null;
            return (
              <section className="integration-group" key={group} aria-labelledby={`integration-group-${group.replace(" ", "-")}`}>
                <div className="integration-group-heading">
                  <div>
                    <h2 id={`integration-group-${group.replace(" ", "-")}`}>{group}</h2>
                    <p>{group === "Connected" ? "Active tools in this workspace." : group === "Recommended" ? "Available connectors selected for this workflow." : "More native connections planned for CloseSpan."}</p>
                  </div>
                  <span>{rows.length}</span>
                </div>
                <div className="integrations-grid">
                  {rows.map(({ item, connected, available, experience, observedConnectionState, demonstration }) => {
                    const focused = item.id === focusedIntegrationId;
                    const headingId = `integration-title-${item.id}`;
                    return (
                      <article
                        className={`card integration${focused ? " focused" : ""}`}
                        id={`integration-${item.id}`}
                        key={item.id}
                        ref={focused ? focusedCardRef : undefined}
                        tabIndex={focused ? -1 : undefined}
                        aria-labelledby={headingId}
                      >
                        <div className="split">
                          <IntegrationProviderIcon integrationId={item.id} className="provider-icon" />
                          <span className={`badge${connected ? " success" : ""}`}>
                            {connected ? "Connected" : available ? experience.filter : "Coming soon"}
                          </span>
                        </div>
                        <FitText as="h3" id={headingId} minFontSize={13} maxLines={2}>
                          {item.name}
                        </FitText>
                        <p className="integration-card-summary">{experience.summary}</p>
                        <div className="integration-card-footer">
                          {observedConnectionState === "Needs reconnect" ? (
                            <p className="integration-import failed"><AlertTriangle size={13} aria-hidden="true" />Reconnect required</p>
                          ) : connected && !demonstration && isPipedreamConnectorId(item.id) && isFeedbackSourceIntegration(item.id) ? (
                            <IntegrationSyncStatus
                              orgId={orgId}
                              integrationId={item.id}
                              active
                              onConnectionStateChange={(nextState) =>
                                updateConnectionState(item.id, nextState)
                              }
                            />
                          ) : null}
                          <span>
                            {connected && !isFeedbackSourceIntegration(item.id)
                              ? "Ready for approved actions"
                              : connected && item.lastSync
                                ? `Synced ${new Date(item.lastSync).toLocaleDateString()}`
                                : connected
                                  ? "Waiting for first import"
                                  : available
                                    ? "Ready to connect"
                                    : "Not yet available"}
                          </span>
                          <Button type="button" onClick={() => openIntegrationDetails(item.id)}>
                            {connected ? "View details" : available ? "Review & connect" : "View details"}
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {visibleRows.length === 0 && <p className="integration-filter-empty">No connectors match this filter.</p>}
          </section>
        </div>
      )}

      <AnimatePresence initial={false}>
      {selectedRow && (
        <motion.div
          key={`${selectedRow.item.id}-${integrationDrawerMode}`}
          className="integration-drawer-layer"
          role="presentation"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
          onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedIntegrationId(null);
        }}>
          <motion.aside
            ref={integrationDrawerRef}
            className="integration-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="integration-drawer-title"
            tabIndex={-1}
            initial={reduceMotion ? false : { x: 28, opacity: 0.72 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 28, opacity: 0.72 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="integration-drawer-head">
              <IntegrationProviderIcon integrationId={selectedRow.item.id} size={22} />
              <div>
                <span>{selectedRow.experience.filter}</span>
                <h2 id="integration-drawer-title">
                  {integrationDrawerMode === "progress"
                    ? `${selectedRow.item.name} progress`
                    : selectedRow.connected || settingsConnections
                      ? selectedRow.item.name
                      : `Connect ${selectedRow.item.name}`}
                </h2>
              </div>
              <button ref={integrationDrawerCloseRef} type="button" className="icon-button" aria-label="Close connector details" onClick={() => setSelectedIntegrationId(null)}><X size={18} /></button>
            </div>
            {githubBusy && selectedRow.item.id === "int_github" && (
              <Button type="button" onClick={() => githubConnectionRef.current?.abort()}>
                Cancel GitHub connection
              </Button>
            )}
            {githubError && selectedRow.item.id === "int_github" && integrationDrawerMode === "progress" && (
              <p className="github-connection-message error" role="alert">{githubError}</p>
            )}
            {integrationDrawerMode === "progress" ? (
              <IntegrationProgressDrawer
                activity={selectedProgressActivity}
                connected={selectedRow.connected}
                githubBusy={githubBusy}
                integrationId={selectedRow.item.id}
                onConnectGithub={() => void connectGithub()}
                onViewDetails={() => setIntegrationDrawerMode("details")}
              />
            ) : (
              <div className="integration-drawer-content">
                <p className="integration-drawer-summary">{selectedRow.experience.summary}</p>
                {settingsConnections && <section className="integration-drawer-section">
                  <h3>Connection details</h3>
                  <p>{selectedRow.item.dataScope}</p>
                  <p>{selectedRow.item.lastSync ? `Last synced ${new Date(selectedRow.item.lastSync).toLocaleString()}` : "No sync recorded yet."}</p>
                </section>}
                <section className="integration-drawer-section">
                  <h3>Data CloseSpan will use</h3>
                  <ul>{selectedRow.experience.importedData.map((value) => <li key={value}><Check size={14} aria-hidden="true" />{value}</li>)}</ul>
                </section>
                <section className="integration-drawer-section">
                  <h3>{selectedRow.item.id === "int_retell" ? "Access used" : "Permissions requested"}</h3>
                  <ul>{selectedRow.experience.requestedPermissions.map((value) => <li key={value}><ShieldCheck size={14} aria-hidden="true" />{value}</li>)}</ul>
                  <p>{selectedRow.item.id === "int_retell" ? "Only call-reading operations are enabled. Your API key’s permissions remain managed in Retell." : "CloseSpan requests least-privilege access. Agent actions still require your approval."}</p>
                </section>
                {selectedRow.connected && selectedRow.item.id !== "int_retell" && selectedRow.item.permissions.length > 0 && (
                  <section className="integration-drawer-section"><h3>Currently granted</h3><p>{selectedRow.item.permissions.join(", ")}</p></section>
                )}
                <div className="integration-drawer-actions">
              {selectedRow.demonstration ? (
                <div className="integration-demo-connection">
                  <StatusBadge tone="success">Demo connection</StatusBadge>
                  <p>This presentation account is simulated; no OAuth credential or external request is used.</p>
                </div>
              ) : settingsConnections && !canManageConnections ? (
                <p className="subtle">Only workspace administrators can change or disconnect connections.</p>
              ) : !selectedRow.available ? (
                <Button type="button" disabled>Coming soon</Button>
              ) : selectedRow.item.id === "int_github" ? (
                <div className="integration-github-access">
                  {selectedRow.connected ? (
                    <>
                      <div className="integration-github-repository-summary">
                        <div>
                          <strong>Connected repositories</strong>
                          <StatusBadge tone="success">
                            {connectedGithubRepositories.length}
                          </StatusBadge>
                        </div>
                        <p>
                          CloseSpan can use these repositories for testing and
                          approved pull requests.
                        </p>
                      </div>
                      <ul
                        className="integration-github-repository-list"
                        aria-label="Connected GitHub repositories"
                      >
                        {connectedGithubRepositories.map((repository) => (
                          <li key={repository.id}>
                            <GitBranch size={16} aria-hidden="true" />
                            <div>
                              <strong>{repository.repository}</strong>
                              <span>Default branch: {repository.defaultBranch}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <div className="integration-github-setup-copy">
                      <p>
                        CloseSpan uses its GitHub App so you choose the exact
                        repositories available for testing and approved pull requests.
                      </p>
                      <p>
                        Already installed? Keep the repository selected and click
                        <strong> Save</strong> in GitHub to sync it with this workspace.
                      </p>
                    </div>
                  )}
                  {settingsConnections ? (
                    <DisconnectIntegrationButton orgId={orgId} provider="GitHub" endpoint="/api/integrations/github" onDisconnected={() => updateConnectionState("int_github", "Disconnected")} />
                  ) : <Button
                    variant="primary"
                    type="button"
                    disabled={githubBusy}
                    onClick={() => void connectGithub()}
                  >
                    {githubBusy
                      ? "Opening GitHub…"
                      : selectedRow.connected
                        ? "Manage repositories"
                        : "Select repositories"}
                  </Button>}
                  {githubError && (
                    <div className="github-connection-message error" role="alert">
                      {githubError}
                    </div>
                  )}
                </div>
              ) : settingsConnections && (selectedRow.item.id === "int_discord" || selectedRow.item.id === "int_retell") ? (
                <DisconnectIntegrationButton
                  orgId={orgId}
                  provider={selectedRow.item.name}
                  endpoint={selectedRow.item.id === "int_retell" ? "/api/integrations/retell" : "/api/integrations/discord/status"}
                  onDisconnected={() => updateConnectionState(selectedRow.item.id, "Disconnected")}
                />
              ) : selectedRow.item.id === "int_discord" ? (
                <DiscordConnectionManager
                  orgId={orgId}
                  callbackStatus={discordCallbackStatus}
                  callbackReason={discordCallbackReason}
                  onConnectionStateChange={(nextState) =>
                    updateConnectionState(selectedRow.item.id, nextState)
                  }
                />
              ) : selectedRow.item.id === "int_retell" ? (
                <RetellConnectionManager
                  orgId={orgId}
                  onConnectionStateChange={(nextState) => updateConnectionState(selectedRow.item.id, nextState)}
                  onImportComplete={(completedAt) => setLastSyncOverrides((previous) => ({ ...previous, int_retell: completedAt }))}
                />
              ) : isPipedreamConnectorId(selectedRow.item.id) ? (
                <PipedreamAccountManager
                  orgId={orgId}
                  integrationId={selectedRow.item.id}
                  managementOnly={settingsConnections}
                  onConnectionStateChange={(nextState) =>
                    updateConnectionState(selectedRow.item.id, nextState)
                  }
                  onImportComplete={(completedAt, processed) => {
                    setLastSyncOverrides((previous) => ({
                      ...previous,
                      [selectedRow.item.id]: completedAt,
                    }));
                    setIntegrationActivity((previous) => [
                      {
                        integrationId: selectedRow.item.id,
                        accountName: null,
                        state: "Connected",
                        healthy: true,
                        lastImportAt: completedAt,
                        lastImportStatus: "Succeeded",
                        lastImportCount: processed,
                      },
                      ...previous,
                    ]);
                  }}
                />
              ) : selectedRow.item.id === "int_webhook" && settingsConnections ? (
                <DisconnectIntegrationButton orgId={orgId} provider="Custom webhook" endpoint="/api/integrations/webhook" onDisconnected={() => updateConnectionState("int_webhook", "Disconnected")} />
              ) : selectedRow.item.id === "int_webhook" && !selectedRow.connected ? (
                <Button variant="primary" type="button" disabled={webhookBusy} onClick={() => void createWebhook()}>{webhookBusy ? "Creating endpoint..." : "Create webhook"}</Button>
              ) : (
                <StatusBadge tone="success">Connected</StatusBadge>
              )}
              {webhookError && selectedRow.item.id === "int_webhook" && <p className="integration-import failed"><AlertTriangle size={13} />{webhookError}</p>}
                </div>
                {selectedRow.item.id === "int_webhook" && webhookCredentials && (
                  <div className="setup-credentials integration-webhook-credentials">
                    <label>Webhook URL</label><code className="credential-value">{webhookCredentials.webhookUrl}</code>
                    <Button type="button"  onClick={() => void copyWebhookValue("url", webhookCredentials.webhookUrl)}><Copy size={13} />{webhookCopied === "url" ? "Copied" : "Copy URL"}</Button>
                    <label>Signing secret (shown once)</label><code className="credential-value">{webhookCredentials.signingSecret}</code>
                    <Button type="button"  onClick={() => void copyWebhookValue("secret", webhookCredentials.signingSecret)}><Copy size={13} />{webhookCopied === "secret" ? "Copied" : "Copy secret"}</Button>
                  </div>
                )}
              </div>
            )}
          </motion.aside>
        </motion.div>
      )}
      </AnimatePresence>
    </>
  );
}
